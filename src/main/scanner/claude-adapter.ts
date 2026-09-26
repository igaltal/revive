import { spawn } from 'node:child_process'
import { relative } from 'node:path'
import { SCAN_LIMITS } from '@shared/scan'
import { redact } from '@shared/redact'
import scanPrompt from '../prompts/scan.md?raw'
import { exec } from '../exec'
import { claudeSignedIn } from '../prereq'
import type { AgentAdapter, AgentScanEvent, AgentScanResult } from './agent-adapter'

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

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  async scan(folder, { model, signal, onEvent }) {
    // Don't start (or spend anything) if the account is signed out.
    if ((await claudeSignedIn(exec)) === 'no') return { ok: false, code: 'auth', costUsd: null }

    return new Promise<AgentScanResult>((resolve) => {
      const child = spawn('claude', buildScanArgs(model), { cwd: folder, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      // Claude reports resolved paths (/private/var/... for /var/...), so accept both.
      const folders = [folder, folder.replace(/^\/private\//, '/')]
      let buffer = ''
      let stderr = ''
      let result: Extract<StreamItem, { type: 'result' }> | null = null
      let settled = false

      const finish = (r: AgentScanResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(r)
      }
      const onAbort = () => {
        child.kill('SIGTERM')
        finish({ ok: false, code: 'cancelled', costUsd: result?.costUsd ?? null })
      }
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish({ ok: false, code: 'timeout', costUsd: result?.costUsd ?? null })
      }, SCAN_LIMITS.timeoutMs)
      signal.addEventListener('abort', onAbort)

      child.stdout.on('data', (d: Buffer) => {
        buffer += d.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          for (const item of parseStreamLine(line, folders)) {
            if (item?.type === 'event') onEvent(item.event)
            else if (item?.type === 'result') result = item
          }
        }
      })
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-8000)
      })
      child.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOENT' ? { ok: false, code: 'claude_missing', costUsd: null } : classifyResult(null, String(e))))
      child.on('close', () => finish(classifyResult(result, stderr)))
    })
  }
}
