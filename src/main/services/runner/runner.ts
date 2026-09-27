import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@shared/manifest'
import type { BrokenReason, RunState, RunStatus, RunStep, SessionRef } from '@shared/runtime'
import { stripAnsi } from '@shared/ansi'
import { redact } from '@shared/redact'
import type { RuntimeBus } from '../runtime-bus'
import type { SessionHub } from '../sessions/session-hub'
import type { SessionExit } from '../sessions/backend'
import { COMMON_PORTS, detectPort, listeningAnywhere, type DetectedPort } from './port-detect'
import { waitHealthy, type Fetcher } from './health'
import { needsInstall } from './install-detect'
import { readEnvSecrets } from './env-secrets'
import { ruleExplainer, type ErrorExplainer } from './explain'

export interface ResolvedProject {
  /** Absolute path of the project's own folder, already checked to be inside the chosen folder. */
  dir: string
  project: Project
}

/** Facts a run establishes, written to the manifest's run block. */
export interface RunRecord {
  status?: 'verified' | 'broken'
  verifiedAt?: string
  port?: number
  url?: string
}

export interface ProjectSource {
  resolve(projectId: string): Promise<ResolvedProject>
  record(projectId: string, record: RunRecord): Promise<void>
}

export interface RunnerDeps {
  hub: SessionHub
  bus: RuntimeBus
  projects: ProjectSource
  /** How to launch the built-in file server; the runner appends <folder> <port>. */
  staticServer: { file: string; args: string[]; env: Record<string, string> }
  /** Environment for project commands (the login-shell PATH is already merged in by main). */
  baseEnv?: () => Record<string, string>
  shell?: string
  explainer?: ErrorExplainer
  /** Takes a picture of the running app; returns its asset path, or null. */
  capture?: (projectId: string, url: string) => Promise<string | null>
  fetcher?: Fetcher
  timing?: Partial<typeof DEFAULT_TIMING>
}

export const DEFAULT_TIMING = {
  /** From launch to a page that answers. First compiles of big apps can be slow. */
  startTimeoutMs: 90_000,
  installTimeoutMs: 10 * 60_000,
  /** When the output hasn't named a port by then, look for one. */
  probeAfterMs: 12_000,
  probeEveryMs: 2_000
}

interface Plan {
  install: string | null
  main: { step: RunStep; display: string; file: string; args: string[]; env?: Record<string, string> }
}

interface Run {
  state: RunState
  abort: AbortController
  stopping: boolean
}

const shellRef = (projectId: string): SessionRef => ({ projectId, agent: 'shell' })
const firstWord = (cmd: string | null) => (cmd ?? '').trim().split(/\s+/)[0]?.replace(/^.*\//, '') ?? ''

/** Runs until the signal aborts; resolves 'aborted' instead of throwing. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T | 'aborted'> {
  if (signal.aborted) return Promise.resolve('aborted')
  return new Promise((resolve) => {
    const onAbort = () => resolve('aborted')
    signal.addEventListener('abort', onAbort, { once: true })
    void p.then((v) => {
      signal.removeEventListener('abort', onAbort)
      resolve(v)
    })
  })
}

const sleep = (ms: number) => new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms).unref?.())

/**
 * Start and stop projects: install what's missing, start the dev server (or
 * Revive's own file server for plain pages), find its port, check that it
 * answers, and record the result. Everything is reported on the runtime bus.
 *
 * Plain TypeScript with no Electron: IPC handlers and any future remote
 * transport are thin adapters over this API.
 */
export class Runner {
  private readonly runs = new Map<string, Run>()
  /** Projects whose last failure pointed at missing parts: install again next time. */
  private readonly forceInstall = new Set<string>()
  private readonly timing: typeof DEFAULT_TIMING
  private readonly explainer: ErrorExplainer

  constructor(private readonly deps: RunnerDeps) {
    this.timing = { ...DEFAULT_TIMING, ...deps.timing }
    this.explainer = deps.explainer ?? ruleExplainer
  }

  list(): RunState[] {
    return [...this.runs.values()].map((r) => ({ ...r.state }))
  }

  get(projectId: string): RunState | null {
    const r = this.runs.get(projectId)
    return r ? { ...r.state } : null
  }

  logs(projectId: string): string[] {
    return this.deps.hub.log(shellRef(projectId))
  }

  async start(projectId: string): Promise<RunState> {
    const current = this.runs.get(projectId)
    if (current && !['idle', 'stopped', 'broken'].includes(current.state.status)) return { ...current.state }

    const { dir, project } = await this.deps.projects.resolve(projectId)
    const run: Run = {
      state: { projectId, status: 'starting', url: null, port: null, reason: null, command: null, updatedAt: new Date().toISOString() },
      abort: new AbortController(),
      stopping: false
    }
    this.runs.set(projectId, run)
    this.deps.hub.clearLog(shellRef(projectId))

    const plan = this.plan(dir, project)
    if (!plan) {
      await this.fail(run, { code: 'no_start_command' })
      return { ...run.state }
    }
    const secrets = await readEnvSecrets(dir)
    const install = plan.install && (this.forceInstall.has(projectId) || needsInstall(dir, plan.install)) ? plan.install : null
    this.set(run, { status: install ? 'installing' : 'starting', command: redact(install ?? plan.main.display, secrets.values) })
    void this.execute(run, dir, project, plan, install, secrets).catch((e: unknown) => {
      console.error(`[runner] ${projectId}:`, e)
      if (!run.stopping) void this.fail(run, { code: 'unknown' })
    })
    return { ...run.state }
  }

  async stop(projectId: string): Promise<RunState> {
    const run = this.runs.get(projectId)
    if (!run) return { projectId, status: 'idle', url: null, port: null, reason: null, command: null, updatedAt: new Date().toISOString() }
    if (['idle', 'stopped', 'broken'].includes(run.state.status)) return { ...run.state }
    run.stopping = true
    run.abort.abort()
    this.set(run, { status: 'stopping' })
    await this.deps.hub.kill(shellRef(projectId))
    this.set(run, { status: 'stopped', reason: null })
    return { ...run.state }
  }

  /** Everything Revive started stops: on quit, before a scan, when the folder changes. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)))
  }

  private plan(dir: string, project: Project): Plan | null {
    const shell = this.deps.shell ?? process.env['SHELL'] ?? '/bin/zsh'
    if (project.run.dev) {
      return { install: project.run.install, main: { step: 'dev', display: project.run.dev, file: shell, args: ['-c', project.run.dev] } }
    }
    if (existsSync(join(dir, 'index.html'))) {
      const s = this.deps.staticServer
      return {
        install: null,
        main: { step: 'serve', display: 'revive static-server .', file: s.file, args: [...s.args, dir, String(project.run.port ?? 0)], env: s.env }
      }
    }
    return null
  }

  private env(extra: Record<string, string> = {}): Record<string, string> {
    const base = this.deps.baseEnv?.() ?? (Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>)
    const env = { ...base }
    // Electron's own switches must not leak into the user's tools.
    for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_') || k.startsWith('REVIVE_')) delete env[k]
    // Some dev servers open a browser tab on start; Revive shows its own preview.
    return { ...env, BROWSER: 'none', ...extra }
  }

  private async execute(run: Run, dir: string, project: Project, plan: Plan, install: string | null, secrets: { values: string[] }): Promise<void> {
    const { projectId } = run.state
    const ref = shellRef(projectId)
    const tools = [firstWord(plan.install), firstWord(project.run.dev)].filter(Boolean)
    const keys = project.keys.map((k) => k.key)
    const shell = this.deps.shell ?? process.env['SHELL'] ?? '/bin/zsh'

    // 1. Get things ready.
    if (install) {
      const { exited } = this.deps.hub.start({ ref, cwd: dir, file: shell, args: ['-c', install], env: this.env(), step: 'install', display: install, secrets: secrets.values })
      const exit = await abortable(Promise.race([exited, sleep(this.timing.installTimeoutMs)]), run.abort.signal)
      if (exit === 'aborted') return
      if (exit === 'timeout' || exit.exitCode !== 0) {
        await this.deps.hub.kill(ref)
        return this.fail(run, this.explainer.explain({ log: this.logs(projectId), step: 'install', timedOut: exit === 'timeout', keys, tools }))
      }
      this.forceInstall.delete(projectId)
    }

    // 2. Start.
    const startedAt = Date.now()
    const deadline = startedAt + this.timing.startTimeoutMs
    const candidates = [...new Set([project.run.port, ...COMMON_PORTS].filter((p): p is number => typeof p === 'number'))]
    const busyBefore = new Set<number>()
    await Promise.all(candidates.map(async (p) => (await listeningAnywhere(p)) && busyBefore.add(p)))

    this.set(run, { status: 'starting', command: redact(plan.main.display, secrets.values) })
    const { handle, exited } = this.deps.hub.start({
      ref,
      cwd: dir,
      file: plan.main.file,
      args: plan.main.args,
      env: this.env(plan.main.env),
      step: plan.main.step,
      display: plan.main.display,
      secrets: secrets.values
    })

    // 3. Find the port: from what the server prints, else by looking for a newly opened one.
    const found = new Promise<DetectedPort & { source: 'output' | 'probe' }>((resolve) => {
      let carry = ''
      const off = handle.onData((chunk) => {
        const text = carry + stripAnsi(chunk)
        const lines = text.split(/\r?\n/)
        carry = lines.pop() ?? ''
        for (const line of [...lines, carry]) {
          const d = detectPort(line)
          if (d) {
            off()
            clearInterval(probe)
            resolve({ ...d, source: 'output' })
            return
          }
        }
      })
      const probe = setInterval(() => {
        if (Date.now() - startedAt < this.timing.probeAfterMs) return
        void (async () => {
          for (const p of candidates) {
            if (!busyBefore.has(p) && (await listeningAnywhere(p))) {
              off()
              clearInterval(probe)
              resolve({ port: p, url: `http://localhost:${p}/`, source: 'probe' })
              return
            }
          }
        })()
      }, this.timing.probeEveryMs)
      run.abort.signal.addEventListener('abort', () => {
        off()
        clearInterval(probe)
      })
      void exited.then(() => {
        off()
        clearInterval(probe)
      })
    })

    const first = await abortable(Promise.race([found, exited, sleep(Math.max(0, deadline - Date.now()))]), run.abort.signal)
    if (first === 'aborted') return
    if (first === 'timeout' || 'exitCode' in first) {
      return this.failStart(run, plan.main.step, first === 'timeout', keys, tools)
    }

    this.deps.bus.emit({ type: 'port.detected', projectId, port: first.port, url: first.url, source: first.source })
    this.set(run, { status: 'checking', port: first.port, url: first.url })

    // 4. Check that it really answers.
    const health = await abortable(
      Promise.race([waitHealthy(first.url, { deadline, signal: run.abort.signal, fetcher: this.deps.fetcher }), exited.then((e: SessionExit) => ({ ok: false as const, exit: e }))]),
      run.abort.signal
    )
    if (health === 'aborted') return
    if (!health.ok) return this.failStart(run, plan.main.step, !('exit' in health), keys, tools)

    // 5. Running. Record the facts so any client can find this server again.
    this.set(run, { status: 'running' })
    await this.deps.projects
      .record(projectId, { status: 'verified', verifiedAt: new Date().toISOString(), port: first.port, url: first.url })
      .then(() => this.deps.bus.emit({ type: 'manifest.changed' }))
      .catch(() => {})
    void this.deps.capture?.(projectId, first.url).then((path) => {
      if (path) this.deps.bus.emit({ type: 'shot.captured', projectId, path })
    })

    // It may still stop on its own later.
    void exited.then(() => {
      if (!run.stopping && this.runs.get(projectId) === run) this.set(run, { status: 'stopped', reason: { code: 'exited' } })
    })
  }

  private async failStart(run: Run, step: RunStep, timedOut: boolean, keys: string[], tools: string[]): Promise<void> {
    await this.deps.hub.kill(shellRef(run.state.projectId))
    if (run.stopping) return
    const reason = this.explainer.explain({ log: this.logs(run.state.projectId), step, timedOut, keys, tools })
    return this.fail(run, reason)
  }

  private async fail(run: Run, reason: BrokenReason): Promise<void> {
    const { projectId } = run.state
    if (reason.code === 'deps_missing') this.forceInstall.add(projectId)
    this.set(run, { status: 'broken', reason })
    await this.deps.projects
      .record(projectId, { status: 'broken' })
      .then(() => this.deps.bus.emit({ type: 'manifest.changed' }))
      .catch(() => {})
  }

  private set(run: Run, patch: Partial<Omit<RunState, 'projectId'>> & { status?: RunStatus }): void {
    run.state = { ...run.state, ...patch, updatedAt: new Date().toISOString() }
    this.deps.bus.emit({ type: 'status.changed', state: { ...run.state } })
  }
}
