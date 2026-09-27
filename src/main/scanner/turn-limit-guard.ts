import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { GuardState } from '@shared/guard'
import { redact } from '@shared/redact'
import type { Exec } from '../exec'
import { claudeSignedIn } from '../prereq'
import { runClaude, type ClaudeRun } from './claude-adapter'

/**
 * Proves the installed Claude Code honours `--max-turns`.
 *
 * Three files, each naming the next with a random name, so the model can't
 * read ahead in parallel: reading the second file takes a second turn. With
 * `--max-turns 1` an honest CLI stops after the first read with
 * `error_max_turns`. Costs about a cent, once per Claude Code version.
 */
export type ProbeVerdict = 'enforced' | 'not_enforced' | 'inconclusive'

export interface ProbeFiles {
  first: string
  second: string
  third: string
}

export function probePrompt(files: ProbeFiles): string {
  return `Use the Read tool to read ${files.first}. It names the next file to read; read that one with the Read tool, and keep following the chain until a file says the chain ends. Then reply with the last word you read.`
}

export function buildProbeArgs(files: ProbeFiles): string[] {
  return [
    '-p',
    probePrompt(files),
    '--output-format',
    'stream-json',
    '--verbose',
    '--restricted',
    '--tools',
    'Read',
    '--allowedTools',
    'Read',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model',
    'haiku',
    '--max-turns',
    '1',
    '--max-budget-usd',
    '0.1'
  ]
}

const AUTH_TEXT = /not logged in|please run \/login|authenticat|invalid api key|oauth|\b401\b/i
const UNKNOWN_FLAG = /unknown option|unrecognized option|unexpected argument/i

/** Decides from the CLI's own stream whether the limit held. */
export function judgeProbe(lines: string[], stderr: string, files: ProbeFiles): { verdict: ProbeVerdict; detail: string[]; signedOut?: boolean } {
  const reads: string[] = []
  let result: { subtype: string; text: string; turns: unknown } | null = null
  for (const line of lines) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (msg['type'] === 'assistant') {
      for (const c of ((msg['message'] as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>) {
        const input = (c['input'] ?? {}) as Record<string, unknown>
        if (c['type'] === 'tool_use' && c['name'] === 'Read' && typeof input['file_path'] === 'string') reads.push(basename(input['file_path']))
      }
    } else if (msg['type'] === 'result') {
      result = { subtype: String(msg['subtype'] ?? ''), text: String(msg['result'] ?? ''), turns: msg['num_turns'] }
    }
  }
  const detail = [`files read: ${reads.join(', ') || 'none'}`, `result: ${result?.subtype ?? 'none'} (turns: ${String(result?.turns ?? '?')})`]
  const said = `${result?.text ?? ''}\n${stderr}`
  if (UNKNOWN_FLAG.test(stderr)) return { verdict: 'not_enforced', detail: [...detail, 'Claude Code did not recognise --max-turns.', redact(stderr.trim().split('\n').slice(-3).join(' '))] }
  if (reads.includes(files.second) || reads.includes(files.third)) return { verdict: 'not_enforced', detail: [...detail, 'Claude kept going past the one-turn limit.'] }
  if (result?.subtype === 'error_max_turns' && reads.includes(files.first)) return { verdict: 'enforced', detail }
  if (result?.subtype === 'success' && reads.length > 0) return { verdict: 'not_enforced', detail: [...detail, 'Claude finished normally although the limit should have stopped it.'] }
  if (AUTH_TEXT.test(said)) return { verdict: 'inconclusive', detail: [...detail, 'Signed out of Claude.'], signedOut: true }
  return { verdict: 'inconclusive', detail: [...detail, redact(said.trim().split('\n').slice(-3).join(' '))].filter(Boolean) }
}

export type ClaudeRunner = (args: string[], opts: { cwd: string; timeoutMs: number; onLine: (line: string) => void }) => Promise<ClaudeRun>

export async function runTurnLimitProbe(run: ClaudeRunner = runClaude): Promise<{ verdict: ProbeVerdict; detail: string[]; signedOut?: boolean; missing?: boolean }> {
  const dir = await mkdtemp(join(tmpdir(), 'revive-turn-probe-'))
  const tag = () => randomBytes(4).toString('hex')
  const files: ProbeFiles = { first: 'start.txt', second: `next-${tag()}.txt`, third: `last-${tag()}.txt` }
  try {
    await writeFile(join(dir, files.first), `The next file to read is ${files.second}\n`)
    await writeFile(join(dir, files.second), `The next file to read is ${files.third}\n`)
    await writeFile(join(dir, files.third), 'The chain ends here. The last word is: lantern\n')
    const lines: string[] = []
    const r = await run(buildProbeArgs(files), { cwd: dir, timeoutMs: 90_000, onLine: (l) => lines.push(l) })
    if (r.kind === 'missing') return { verdict: 'inconclusive', detail: ['Claude Code is not installed.'], missing: true }
    if (r.kind === 'timeout') return { verdict: 'inconclusive', detail: ['The check took too long.'] }
    if (r.kind === 'error' || r.kind === 'aborted') return { verdict: 'inconclusive', detail: [r.kind === 'error' ? redact(r.message) : 'Stopped.'] }
    return judgeProbe(lines, r.stderr, files)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

interface CacheEntry {
  version: string
  verdict: 'enforced' | 'not_enforced'
  checkedAt: string
  detail: string[]
}

/**
 * Keeps the verdict per Claude Code version, so the paid check runs once
 * after each update. A failed verdict blocks every scan until it passes.
 */
export class TurnLimitGuard {
  private state: GuardState = { state: 'checking', version: null }
  private inFlight: Promise<GuardState> | null = null

  constructor(
    private readonly cacheFile: string,
    private readonly exec: Exec,
    private readonly onChange: (s: GuardState) => void,
    private readonly probe: () => ReturnType<typeof runTurnLimitProbe> = () => runTurnLimitProbe()
  ) {}

  current(): GuardState {
    return this.state
  }

  ensure(force = false): Promise<GuardState> {
    this.inFlight ??= this.check(force).finally(() => (this.inFlight = null))
    return this.inFlight
  }

  private set(s: GuardState): GuardState {
    this.state = s
    this.onChange(s)
    return s
  }

  private readCache(): CacheEntry | null {
    try {
      return existsSync(this.cacheFile) ? (JSON.parse(readFileSync(this.cacheFile, 'utf8')) as CacheEntry) : null
    } catch {
      return null
    }
  }

  private async check(force: boolean): Promise<GuardState> {
    const v = await this.exec('claude', ['--version'], { timeoutMs: 8000 })
    const version = v.code === 0 ? (/(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? v.stdout.trim()) : null
    if (!version) return this.set({ state: 'unchecked', version: null, detail: ['Claude Code is not installed.'] })

    const cached = this.readCache()
    if (!force && cached?.version === version) {
      if (this.state.state === 'ok' && this.state.version === version) return this.state
      return this.set(cached.verdict === 'enforced' ? { state: 'ok', version, checkedAt: cached.checkedAt } : { state: 'failed', version, detail: cached.detail })
    }

    // Signed out: nothing to learn yet, and nothing to spend. Checked again before the next scan.
    if ((await claudeSignedIn(this.exec)) === 'no') return this.set({ state: 'unchecked', version, detail: ['Signed out of Claude.'] })

    this.set({ state: 'checking', version })
    const r = await this.probe()
    if (r.verdict === 'inconclusive') return this.set({ state: 'unchecked', version, detail: r.detail })
    const entry: CacheEntry = { version, verdict: r.verdict, checkedAt: new Date().toISOString(), detail: r.detail }
    await writeFile(this.cacheFile, JSON.stringify(entry, null, 2)).catch(() => {})
    if (r.verdict === 'enforced') return this.set({ state: 'ok', version, checkedAt: entry.checkedAt })
    console.error(`[revive] Claude Code ${version} does not enforce --max-turns. Scans are blocked.\n  ${r.detail.join('\n  ')}`)
    return this.set({ state: 'failed', version, detail: r.detail })
  }
}
