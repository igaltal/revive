import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { UNDERSTAND_LIMITS } from '@shared/scan'
import { redact } from '@shared/redact'
import understandPrompt from '../prompts/understand.md?raw'
import { exec } from '../exec'
import { claudeSignedIn } from '../prereq'
import type { AgentAdapter, AgentFailureCode, AgentUnderstandResult, UnderstandInput } from './agent-adapter'
import type { TurnLimitGuard } from './turn-limit-guard'

const AUTH_TEXT = /not logged in|please run \/login|\blog ?in\b|authenticat|invalid api key|oauth|\b401\b/i

type Classified = { ok: true; costUsd: number | null } | { ok: false; code: AgentFailureCode; costUsd: number | null; detail?: string[] }

/** What a finished `claude -p` run means: success, a limit, signed out, or something else (masked log). */
export function classifyResult(r: { isError: boolean; subtype: string; costUsd: number | null; text: string } | null, stderr: string): Classified {
  if (r && !r.isError && r.subtype === 'success') return { ok: true, costUsd: r.costUsd }
  const costUsd = r?.costUsd ?? null
  if (r && /max_turns|max_budget/.test(r.subtype)) return { ok: false, code: 'limit', costUsd }
  const text = `${r?.text ?? ''}\n${stderr}`
  if (AUTH_TEXT.test(text)) return { ok: false, code: 'auth', costUsd }
  return { ok: false, code: 'unknown', costUsd, detail: text.split('\n').filter(Boolean).slice(-20).map((l) => redact(l)) }
}

/** The answer's shape. Revive checks it; Claude never writes a file. */
export const UnderstandOutputSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(80),
      en: z.string().min(1).max(400),
      he: z.string().min(1).max(400),
      keys: z.array(z.object({ key: z.string().min(1), en: z.string().max(160), he: z.string().max(160) })).max(100),
      notes: z.array(z.string().max(200)).max(3)
    })
  )
})

/** The understanding call's environment on top of the user's: no extended thinking. */
export const UNDERSTAND_ENV = { MAX_THINKING_TOKENS: '0' }

export function buildUnderstandPrompt(projects: UnderstandInput[]): string {
  return `Projects (JSON):\n${JSON.stringify(projects, null, 1)}`
}

/**
 * No tools at all (`--tools ""`) and Revive's own short instructions instead
 * of Claude Code's (`--system-prompt`): this call can't read or change
 * anything, it only turns Revive's summary into plain words, and it costs a
 * fraction of an agent session.
 */
export function buildUnderstandArgs(projects: UnderstandInput[], model: string): string[] {
  const { $schema: _drop, ...schema } = z.toJSONSchema(UnderstandOutputSchema) as Record<string, unknown>
  void _drop
  return [
    '-p',
    buildUnderstandPrompt(projects),
    '--system-prompt',
    understandPrompt.trim(),
    '--output-format',
    'json',
    '--tools',
    '',
    '--restricted',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model',
    model,
    '--max-turns',
    String(UNDERSTAND_LIMITS.maxTurns),
    '--max-budget-usd',
    String(UNDERSTAND_LIMITS.maxBudgetUsd),
    '--json-schema',
    JSON.stringify(schema)
  ]
}

/** Reads the single JSON result of an understanding call. */
export function parseUnderstandOutput(stdout: string, stderr: string): AgentUnderstandResult {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? '') as Record<string, unknown>
  } catch {
    const c = classifyResult(null, `${stdout}\n${stderr}`)
    return c.ok ? { ok: false, code: 'unknown', costUsd: null } : c
  }
  const costUsd = typeof msg['total_cost_usd'] === 'number' ? msg['total_cost_usd'] : null
  const status = classifyResult({ isError: msg['is_error'] === true, subtype: String(msg['subtype'] ?? ''), costUsd, text: String(msg['result'] ?? '') }, stderr)
  if (!status.ok) return status
  let answer: unknown = msg['structured_output']
  if (answer === undefined) {
    try {
      answer = JSON.parse(String(msg['result'] ?? '').replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
      answer = null
    }
  }
  const parsed = UnderstandOutputSchema.safeParse(answer)
  if (!parsed.success) return { ok: false, code: 'unknown', costUsd, detail: ['The answer came back in an unexpected shape.'] }
  return { ok: true, costUsd, projects: parsed.data.projects }
}

export type ClaudeRun =
  | { kind: 'closed'; code: number | null; stderr: string }
  | { kind: 'missing' }
  | { kind: 'aborted'; stderr: string }
  | { kind: 'timeout'; stderr: string }
  | { kind: 'error'; message: string }

/** Runs `claude` without a shell, line by line, with a hard time limit and cancel. */
export function runClaude(args: string[], opts: { cwd: string; signal?: AbortSignal; timeoutMs: number; onLine: (line: string) => void; env?: Record<string, string> }): Promise<ClaudeRun> {
  return new Promise<ClaudeRun>((resolve) => {
    const child = spawn('claude', args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    let stderr = ''
    let settled = false
    const finish = (r: ClaudeRun) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve(r)
    }
    const onAbort = () => {
      child.kill('SIGTERM')
      finish({ kind: 'aborted', stderr })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ kind: 'timeout', stderr })
    }, opts.timeoutMs)
    if (opts.signal?.aborted) return onAbort()
    opts.signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) opts.onLine(line)
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000)
    })
    child.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'error', message: String(e) }))
    child.on('close', (code) => {
      if (buffer) opts.onLine(buffer)
      finish({ kind: 'closed', code, stderr })
    })
  })
}

export function createClaudeAdapter(guard: TurnLimitGuard): AgentAdapter {
  return {
    id: 'claude',

    async ready() {
      // Don't start (or spend anything) if the account is signed out.
      if ((await claudeSignedIn(exec)) === 'no') return { ok: false, code: 'auth' }
      // Never use a version that ignores its limits.
      const g = await guard.ensure()
      if (g.state === 'failed') return { ok: false, code: 'unsafe_claude', detail: g.detail }
      if (g.state !== 'ok') return { ok: false, code: 'unknown', detail: ["Revive couldn't confirm that Claude Code stops at its limits.", ...('detail' in g ? g.detail : [])] }
      return { ok: true }
    },

    async understand(projects, { model, signal }) {
      // An empty working folder: this call has no tools and needs no files.
      const cwd = await mkdtemp(join(tmpdir(), 'revive-understand-'))
      try {
        const out: string[] = []
        // No extended thinking: turning a ready summary into a sentence doesn't need it, and with it the
        // same answer took four times as long and cost two to three times as much (measured).
        const run = await runClaude(buildUnderstandArgs(projects, model), { cwd, signal, timeoutMs: UNDERSTAND_LIMITS.timeoutMs, onLine: (l) => out.push(l), env: UNDERSTAND_ENV })
        if (run.kind === 'missing') return { ok: false, code: 'claude_missing', costUsd: null }
        if (run.kind === 'aborted') return { ok: false, code: 'cancelled', costUsd: null }
        if (run.kind === 'timeout') return { ok: false, code: 'timeout', costUsd: null }
        if (run.kind === 'error') return { ok: false, code: 'unknown', costUsd: null, detail: [redact(run.message)] }
        return parseUnderstandOutput(out.join('\n'), run.stderr)
      } finally {
        await rm(cwd, { recursive: true, force: true })
      }
    }
  }
}
