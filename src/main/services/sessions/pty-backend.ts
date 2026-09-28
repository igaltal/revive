import * as pty from 'node-pty'
import { constants } from 'node:os'
import type { SessionBackend, SessionExit, SessionHandle, SessionSpec } from './backend'

const KILL_GRACE_MS = 3000

const signalName = (n: number | undefined): string | null => {
  if (!n) return null
  return Object.entries(constants.signals).find(([, v]) => v === n)?.[0] ?? String(n)
}

/** Signals the whole process group: the pty's child leads its own group, so dev servers it spawned stop too. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

/** Sessions run as direct children of Revive in a pseudo-terminal. They end when Revive ends. */
export const ptyBackend: SessionBackend = {
  kind: 'pty',
  persistent: false,
  list: async () => [],
  attach: () => {
    throw new Error('Direct terminal sessions end with Revive; there is nothing to attach to')
  },
  end: async () => {},
  spawn(spec: SessionSpec): SessionHandle {
    const term = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: spec.cols ?? 120,
      rows: spec.rows ?? 32,
      cwd: spec.cwd,
      env: spec.env
    })
    const exitListeners = new Set<(e: SessionExit) => void>()
    let exited: SessionExit | null = null
    term.onExit(({ exitCode, signal }) => {
      exited = { exitCode: signal ? null : exitCode, signal: signalName(signal) }
      for (const l of exitListeners) l(exited)
      exitListeners.clear()
    })

    const handle: SessionHandle = {
      ref: spec.ref,
      write: (data) => {
        if (!exited) term.write(data)
      },
      resize: (cols, rows) => {
        if (!exited) term.resize(cols, rows)
      },
      onData: (listener) => {
        const d = term.onData(listener)
        return () => d.dispose()
      },
      onExit: (listener) => {
        if (exited) {
          listener(exited)
          return () => {}
        }
        exitListeners.add(listener)
        return () => exitListeners.delete(listener)
      },
      detach: async () => {
        await handle.kill()
      },
      kill: () =>
        new Promise<SessionExit>((resolve) => {
          if (exited) return resolve(exited)
          handle.onExit(resolve)
          killGroup(term.pid, 'SIGTERM')
          setTimeout(() => {
            if (exited) return
            killGroup(term.pid, 'SIGKILL')
            // Never hang a quit on a process that won't report its exit.
            setTimeout(() => resolve(exited ?? { exitCode: null, signal: 'SIGKILL' }), 1000).unref()
          }, KILL_GRACE_MS).unref()
        })
    }
    return handle
  }
}
