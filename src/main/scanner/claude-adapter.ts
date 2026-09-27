import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { DESCRIBE_LIMITS, SCAN_LIMITS } from '@shared/scan'
import { redact } from '@shared/redact'
import scanPrompt from '../prompts/scan.md?raw'
import describePrompt from '../prompts/describe.md?raw'
import { exec } from '../exec'
import { claudeSignedIn } from '../prereq'
import type { AgentAdapter, AgentDescribeResult, AgentScanEvent, AgentScanResult, DescribeInput } from './agent-adapter'
import type { TurnLimitGuard } from './turn-limit-guard'

/** Files Claude may never read during a scan. A Read deny also blocks writing there. */
export const SECRET_FILE_DENY = [
  'Read(.env)',
  'Read(.env.*)',
  'Read(*.pem)',
  'Read(*.key)',
  'Read(*.p12)',
  'Read(id_rsa*)',
  'Read(id_ed25519*)',
  'Read(.npmrc)',
  'Read(.pypirc)',
  'Read(.netrc)',
  'Read(*credentials*.json)',
  'Read(*service-account*.json)',
  'Read(.revive/git/**)',
  'Read(.git/**)'
]

/**
 * Flags checked against `claude --help` (2.1.282) and code.claude.com/docs:
 * - --restricted: no Bash or other code-running tools; ignores the folder's own
 *   .claude settings; file tools confined to the working directory.
 * - --tools: only Read, Glob, Write, Edit exist. Grep is left out on purpose:
 *   Read deny rules apply to the folder Grep searches, not to each file, so a
 *   folder-wide Grep could surface .env lines.
 * - Edit(...) rules govern Write too (Write(...) rules are never consulted).
 *   The only allowed write is .revive/manifest.json.
 * - dontAsk + --permission-prompts none: anything not allowed is denied.
 */
export function buildScanArgs(model: string): string[] {
  return [
    '-p',
    scanPrompt.trim(),
    '--output-format',
    'stream-json',
    '--verbose',
    '--restricted',
    '--tools',
    'Read,Glob,Write,Edit',
    '--allowedTools',
    'Read',
    'Glob',
    'Edit(.revive/manifest.json)',
    '--disallowedTools',
    ...SECRET_FILE_DENY,
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model',
    model,
    '--max-turns',
    String(SCAN_LIMITS.maxTurns),
    '--max-budget-usd',
    String(SCAN_LIMITS.maxBudgetUsd)
  ]
}

const AUTH_TEXT = /not logged in|please run \/login|\blog ?in\b|authenticat|invalid api key|oauth|\b401\b/i

export type StreamItem =
  | { type: 'event'; event: AgentScanEvent }
  | { type: 'result'; isError: boolean; subtype: string; costUsd: number | null; text: string }
  | null

/** Turns one line of Claude's stream-json output into something Revive cares about. */
export function parseStreamLine(line: string, folders: string[]): StreamItem[] {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(line) as Record<string, unknown>
  } catch {
    return []
  }
  const rel = (p: string) => {
    for (const f of folders) if (p === f || p.startsWith(`${f}/`)) return relative(f, p)
    return p
  }
  if (msg['type'] === 'assistant') {
    const content = ((msg['message'] as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>
    return content
      .filter((c) => c['type'] === 'tool_use')
      .map((c): StreamItem => {
        const input = (c['input'] ?? {}) as Record<string, unknown>
        if (c['name'] === 'Read' && typeof input['file_path'] === 'string') return { type: 'event', event: { kind: 'read', path: rel(input['file_path']) } }
        if (c['name'] === 'Glob') return { type: 'event', event: { kind: 'glob' } }
        return null
      })
      .filter((x) => x !== null)
  }
  if (msg['type'] === 'result') {
    const cost = typeof msg['total_cost_usd'] === 'number' ? msg['total_cost_usd'] : null
    return [{ type: 'result', isError: msg['is_error'] === true, subtype: String(msg['subtype'] ?? ''), costUsd: cost, text: String(msg['result'] ?? '') }]
  }
  return []
}

export function classifyResult(r: Extract<StreamItem, { type: 'result' }> | null, stderr: string): AgentScanResult {
  if (r && !r.isError && r.subtype === 'success') return { ok: true, costUsd: r.costUsd }
  const costUsd = r?.costUsd ?? null
  if (r && /max_turns|max_budget/.test(r.subtype)) return { ok: false, code: 'limit', costUsd }
  const text = `${r?.text ?? ''}\n${stderr}`
  if (AUTH_TEXT.test(text)) return { ok: false, code: 'auth', costUsd }
  return { ok: false, code: 'unknown', costUsd, detail: text.split('\n').filter(Boolean).slice(-20).map((l) => redact(l)) }
}

/** The description step's answer. Revive validates it; Claude never writes a file here. */
export const DescribeOutputSchema = z.object({
  projects: z.array(z.object({ id: z.string().min(1), en: z.string().min(1).max(400), he: z.string().min(1).max(400) }))
})

export function buildDescribePrompt(projects: DescribeInput[]): string {
  return describePrompt.trim().replace('{{PROJECTS}}', JSON.stringify(projects, null, 1))
}

/**
 * No tools at all (`--tools ""`), so this call can't read or change anything:
 * it sees only what the indexing step found, and answers in a checked JSON shape.
 */
export function buildDescribeArgs(projects: DescribeInput[], model: string): string[] {
  const { $schema: _drop, ...schema } = z.toJSONSchema(DescribeOutputSchema) as Record<string, unknown>
  void _drop
  return [
    '-p',
    buildDescribePrompt(projects),
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
    String(DESCRIBE_LIMITS.maxTurns),
    '--max-budget-usd',
    String(DESCRIBE_LIMITS.maxBudgetUsd),
    '--json-schema',
    JSON.stringify(schema)
  ]
}

/** Reads the single JSON result of the description call. */
export function parseDescribeOutput(stdout: string, stderr: string): AgentDescribeResult {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? '') as Record<string, unknown>
  } catch {
    return { ...classifyResult(null, `${stdout}\n${stderr}`), ok: false } as AgentDescribeResult
  }
  const costUsd = typeof msg['total_cost_usd'] === 'number' ? msg['total_cost_usd'] : null
  const status = classifyResult({ type: 'result', isError: msg['is_error'] === true, subtype: String(msg['subtype'] ?? ''), costUsd, text: String(msg['result'] ?? '') }, stderr)
  if (!status.ok) return status
  let answer: unknown = msg['structured_output']
  if (answer === undefined) {
    try {
      answer = JSON.parse(String(msg['result'] ?? '').replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
      answer = null
    }
  }
  const parsed = DescribeOutputSchema.safeParse(answer)
  if (!parsed.success) return { ok: false, code: 'unknown', costUsd, detail: ['The descriptions came back in an unexpected shape.'] }
  return { ok: true, costUsd, descriptions: parsed.data.projects }
}

export type ClaudeRun =
  | { kind: 'closed'; code: number | null; stderr: string }
  | { kind: 'missing' }
  | { kind: 'aborted'; stderr: string }
  | { kind: 'timeout'; stderr: string }
  | { kind: 'error'; message: string }

/** Runs `claude` without a shell, line by line, with a hard time limit and cancel. */
export function runClaude(args: string[], opts: { cwd: string; signal?: AbortSignal; timeoutMs: number; onLine: (line: string) => void }): Promise<ClaudeRun> {
  return new Promise<ClaudeRun>((resolve) => {
    const child = spawn('claude', args, { cwd: opts.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
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
    async scan(folder, { model, signal, onEvent }) {
      // Don't start (or spend anything) if the account is signed out.
      if ((await claudeSignedIn(exec)) === 'no') return { ok: false, code: 'auth', costUsd: null }
      // Never let a version that ignores the turn limit read a folder.
      const g = await guard.ensure()
      if (g.state === 'failed') return { ok: false, code: 'unsafe_claude', costUsd: null, detail: g.detail }
      if (g.state !== 'ok') return { ok: false, code: 'unknown', costUsd: null, detail: ["Revive couldn't confirm that Claude Code stops at its limits.", ...('detail' in g ? g.detail : [])] }

      // Claude reports resolved paths (/private/var/... for /var/...), so accept both.
      const folders = [folder, folder.replace(/^\/private\//, '/')]
      let result: Extract<StreamItem, { type: 'result' }> | null = null
      const run = await runClaude(buildScanArgs(model), {
        cwd: folder,
        signal,
        timeoutMs: SCAN_LIMITS.timeoutMs,
        onLine: (line) => {
          for (const item of parseStreamLine(line, folders)) {
            if (item?.type === 'event') onEvent(item.event)
            else if (item?.type === 'result') result = item
          }
        }
      })
      const costUsd = (result as { costUsd: number | null } | null)?.costUsd ?? null
      if (run.kind === 'missing') return { ok: false, code: 'claude_missing', costUsd: null }
      if (run.kind === 'aborted') return { ok: false, code: 'cancelled', costUsd }
      if (run.kind === 'timeout') return { ok: false, code: 'timeout', costUsd }
      if (run.kind === 'error') return classifyResult(null, run.message)
      return classifyResult(result, run.stderr)
    },

    async describe(projects: DescribeInput[], { model, signal }) {
      // An empty working folder: this call has no tools and needs no files.
      const cwd = await mkdtemp(join(tmpdir(), 'revive-describe-'))
      try {
        const out: string[] = []
        const run = await runClaude(buildDescribeArgs(projects, model), { cwd, signal, timeoutMs: DESCRIBE_LIMITS.timeoutMs, onLine: (l) => out.push(l) })
        if (run.kind === 'missing') return { ok: false, code: 'claude_missing', costUsd: null }
        if (run.kind === 'aborted') return { ok: false, code: 'cancelled', costUsd: null }
        if (run.kind === 'timeout') return { ok: false, code: 'timeout', costUsd: null }
        if (run.kind === 'error') return { ok: false, code: 'unknown', costUsd: null, detail: [redact(run.message)] }
        return parseDescribeOutput(out.join('\n'), run.stderr)
      } finally {
        await rm(cwd, { recursive: true, force: true })
      }
    }
  }
}
