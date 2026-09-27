import { spawn } from 'node:child_process'
import type { SessionBackend, SessionExit, SessionHandle, SessionSpec } from './backend'

/**
 * Sessions as plain child processes (no terminal). Used by tests, where the
 * node-pty build for Electron can't load; it also shows the runner works
 * with any backend that implements SessionBackend.
 */
export const childBackend: SessionBackend = {
  kind: 'pty',
  spawn(spec: SessionSpec): SessionHandle {
    const child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let exited: SessionExit | null = null
    const exitListeners = new Set<(e: SessionExit) => void>()
    child.on('exit', (code, signal) => {
      exited = { exitCode: code, signal }
      for (const l of exitListeners) l(exited)
    })
    child.on('error', () => {
      exited ??= { exitCode: 127, signal: null }
      for (const l of exitListeners) l(exited)
    })
    const group = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {
        // gone
      }
    }
    const handle: SessionHandle = {
      ref: spec.ref,
      write: (d) => child.stdin.write(d),
      resize: () => {},
      onData: (l) => {
        const f = (b: Buffer) => l(b.toString())
        child.stdout.on('data', f)
        child.stderr.on('data', f)
        return () => {
          child.stdout.off('data', f)
          child.stderr.off('data', f)
        }
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
        new Promise((resolve) => {
          if (exited) return resolve(exited)
          handle.onExit(resolve)
          group('SIGTERM')
          setTimeout(() => group('SIGKILL'), 2000).unref()
        })
    }
    return handle
  }
}
