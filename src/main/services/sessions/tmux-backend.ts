import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { RUN_STEPS, type RunStep, type SessionRef } from '@shared/runtime'
import type { ExistingSession, SessionBackend, SessionExit, SessionHandle, SessionSpec } from './backend'
import { TmuxNames } from './tmux-names'

export interface TmuxOptions {
  /** Path to the tmux binary. */
  tmux: string
  /** The socket label (`tmux -L <socket>`): Revive's own server, never the user's. */
  socket: string
  /** Revive's config file (`-f`): the user's ~/.tmux.conf is never read. */
  config: string
  /** Where each session's exit status is written when its command ends. */
  exitDir: string
  /** Environment for tmux itself (HOME and PATH). Defaults to this process's, without TMUX. */
  env?: Record<string, string>
  /** For tests that can't load node-pty's Electron build. */
  spawnPty?: typeof pty.spawn
}

/**
 * Records the command's exit status in a file before the session ends, since
 * `tmux attach` itself only ever exits 0. Runs the command directly (no shell parsing of it).
 */
const WRAPPER = '"$@"; s=$?; printf %s "$s" > "$REVIVE_EXIT_FILE"; exit $s'
const KILL_WAIT_MS = 3000

/** Sessions in Revive's own tmux server. They outlive Revive, and any client can attach again. */
export class TmuxBackend implements SessionBackend {
  readonly kind = 'tmux' as const
  readonly persistent = true
  readonly names = new TmuxNames()
  private readonly env: Record<string, string>

  constructor(private readonly opts: TmuxOptions) {
    const base = opts.env ?? (Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>)
    // Never nest into a tmux that Revive itself happens to run inside.
    const { TMUX: _t, TMUX_PANE: _p, ...rest } = base
    void [_t, _p]
    this.env = { HOME: homedir(), ...rest }
    mkdirSync(opts.exitDir, { recursive: true, mode: 0o700 })
  }

  /** `tmux -L <socket> -f <config> …` */
  args(rest: string[]): string[] {
    return ['-L', this.opts.socket, '-f', this.opts.config, ...rest]
  }

  runSync(rest: string[]): { code: number; stdout: string; stderr: string } {
    const r = spawnSync(this.opts.tmux, this.args(rest), { env: this.env, encoding: 'utf8', timeout: 10_000 })
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  run(rest: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(this.opts.tmux, this.args(rest), { env: this.env, timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = !error ? 0 : typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code as number) : 1
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      })
    })
  }

  exists(name: string): boolean {
    return this.runSync(['has-session', '-t', `=${name}`]).code === 0
  }

  spawn(spec: SessionSpec & { step?: RunStep; display?: string }): SessionHandle {
    const name = this.names.name(spec.ref)
    const size = { cols: spec.cols ?? 120, rows: spec.rows ?? 32 }
    // Already running (from an earlier Revive, say): attach to it instead of starting another.
    if (this.exists(name)) return this.attachTo(name, spec.ref, size, true)

    const exitFile = join(this.opts.exitDir, name)
    rmSync(exitFile, { force: true })
    const env = { ...spec.env, REVIVE_EXIT_FILE: exitFile }
    const created = this.runSync([
      'new-session',
      '-d',
      '-s',
      name,
      '-x',
      String(size.cols),
      '-y',
      String(size.rows),
      '-c',
      spec.cwd,
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      '--',
      '/bin/sh',
      '-c',
      WRAPPER,
      'revive',
      spec.file,
      ...spec.args
    ])
    if (created.code !== 0) throw new Error(`tmux couldn't start ${name}: ${created.stderr.trim()}`)
    // Who it belongs to, on the session itself, so a later Revive can tell even for hashed names.
    this.runSync([
      'set-option', '-q', '-t', name, '@revive_project', spec.ref.projectId, ';',
      'set-option', '-q', '-t', name, '@revive_kind', spec.ref.kind, ';',
      'set-option', '-q', '-t', name, '@revive_step', spec.step ?? '', ';',
      'set-option', '-q', '-t', name, '@revive_display', spec.display ?? ''
    ])
    return this.attachTo(name, spec.ref, size, false)
  }

  async list(): Promise<ExistingSession[]> {
    const r = await this.run(['list-sessions', '-F', '#{session_name}\t#{@revive_project}\t#{@revive_kind}\t#{@revive_step}\t#{session_created}\t#{@revive_display}'])
    // No server yet means no sessions.
    if (r.code !== 0) return []
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name = '', projectId = '', kind = '', step = '', created = '', display = ''] = line.split('\t')
        // The identity stored on the session counts only if it really produces this name.
        if (projectId && kind) this.names.remember(name, { projectId, kind } as SessionRef)
        const ref = this.names.identity(name)
        return {
          name,
          ref,
          step: (RUN_STEPS as readonly string[]).includes(step) ? (step as RunStep) : null,
          display: display || null,
          createdAt: created ? new Date(Number(created) * 1000).toISOString() : null
        }
      })
  }

  attach(existing: ExistingSession & { ref: SessionRef }, size = { cols: 120, rows: 32 }): SessionHandle {
    this.names.remember(existing.name, existing.ref)
    return this.attachTo(existing.name, existing.ref, size, true)
  }

  async end(name: string): Promise<void> {
    await this.run(['kill-session', '-t', `=${name}`])
  }

  /** Stops Revive's tmux server and every session in it, and removes its socket file. Only for tests. */
  killServer(): void {
    this.runSync(['kill-server'])
    const dir = join(this.env['TMUX_TMPDIR'] || '/tmp', `tmux-${process.getuid?.() ?? 0}`)
    rmSync(join(dir, this.opts.socket), { force: true })
  }

  /** The session's scrollback and screen, with colours, as the terminal should show it first. */
  history(name: string): string {
    const r = this.runSync(['capture-pane', '-p', '-e', '-J', '-S', '-', '-E', '-', '-t', `=${name}:`])
    if (r.code !== 0) return ''
    const text = r.stdout.replace(/\n+$/, '')
    return text ? `${text.replace(/\n/g, '\r\n')}\r\n` : ''
  }

  private attachTo(name: string, ref: SessionRef, size: { cols: number; rows: number }, withHistory: boolean): SessionHandle {
    const spawnPty = this.opts.spawnPty ?? pty.spawn
    const history = withHistory ? this.history(name) : ''
    const term = spawnPty(this.opts.tmux, this.args(['attach-session', '-t', `=${name}`]), {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: this.env['HOME'],
      env: this.env
    })
    const dataListeners = new Set<(d: string) => void>()
    const exitListeners = new Set<(e: SessionExit) => void>()
    let exited: SessionExit | null = null
    let detaching = false
    let detached: (() => void) | null = null

    // What was printed before this attach comes first, ahead of anything live.
    let pendingHistory = history
    const emit = (d: string) => {
      if (pendingHistory) {
        const h = pendingHistory
        pendingHistory = ''
        for (const l of dataListeners) l(h)
      }
      for (const l of dataListeners) l(d)
    }
    if (history) queueMicrotask(() => pendingHistory && emit(''))
    term.onData((d) => emit(d))

    term.onExit(() => {
      if (detaching) {
        detached?.()
        return
      }
      const exitFile = join(this.opts.exitDir, name)
      let code: number | null = null
      if (existsSync(exitFile)) {
        code = Number(readFileSync(exitFile, 'utf8')) || 0
        rmSync(exitFile, { force: true })
      }
      // The attach can also end because the tmux server went away: then the session is gone too.
      exited = code === null ? { exitCode: null, signal: 'SIGHUP' } : { exitCode: code, signal: null }
      for (const l of exitListeners) l(exited)
      exitListeners.clear()
    })

    const handle: SessionHandle = {
      ref,
      write: (data) => {
        if (!exited) term.write(data)
      },
      resize: (cols, rows) => {
        if (!exited) term.resize(Math.max(1, cols), Math.max(1, rows))
      },
      onData: (l) => {
        dataListeners.add(l)
        return () => dataListeners.delete(l)
      },
      onExit: (l) => {
        if (exited) {
          l(exited)
          return () => {}
        }
        exitListeners.add(l)
        return () => exitListeners.delete(l)
      },
      kill: () =>
        new Promise<SessionExit>((resolve) => {
          if (exited) return resolve(exited)
          handle.onExit(resolve)
          void this.end(name)
          setTimeout(() => {
            if (!exited) term.kill()
          }, KILL_WAIT_MS).unref()
        }),
      detach: () =>
        new Promise<void>((resolve) => {
          if (exited) return resolve()
          detaching = true
          detached = resolve
          // SIGHUP to the tmux client detaches it; the session keeps running.
          term.kill('SIGHUP')
          setTimeout(resolve, 1000).unref()
        })
    }
    return handle
  }
}

/**
 * Where tmux is, if anywhere: the one bundled with Revive first, then a system
 * one. REVIVE_TMUX overrides (a path, or "none" to act as if it's missing).
 */
export function findTmux(env: NodeJS.ProcessEnv = process.env, bundled: string | null = null): string | null {
  const override = env['REVIVE_TMUX']
  if (override === 'none') return null
  if (override) return existsSync(override) ? override : null
  if (bundled && existsSync(bundled)) return bundled
  const dirs = [...(env['PATH'] ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  for (const d of dirs) if (d && existsSync(join(d, 'tmux'))) return join(d, 'tmux')
  return null
}

export function tmuxVersion(tmux: string): string | null {
  const r = spawnSync(tmux, ['-V'], { encoding: 'utf8', timeout: 5000 })
  return r.status === 0 ? (/tmux\s+(\S+)/.exec(r.stdout)?.[1] ?? null) : null
}
