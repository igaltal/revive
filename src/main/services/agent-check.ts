import type { Exec } from '../exec'
import { claudeSignedIn } from '../prereq'

export type AgentKind = 'claude' | 'codex'
export type AgentProblem = 'not_installed' | 'signed_out'
export type AgentCheck = (kind: AgentKind) => Promise<{ ok: true } | { ok: false; problem: AgentProblem }>

/**
 * Whether Claude Code or Codex can start a session here: installed, and
 * signed in. Runs where the session would run, so a request from another
 * device is checked on the Host.
 */
export function agentCheck(exec: Exec): AgentCheck {
  return async (kind) => {
    const version = await exec(kind, ['--version'], { timeoutMs: 8000 })
    if (version.code !== 0) return { ok: false, problem: 'not_installed' }
    if (kind === 'claude') {
      // "unknown" (an old CLI, a slow answer) doesn't block: the session will say so itself.
      return (await claudeSignedIn(exec)) === 'no' ? { ok: false, problem: 'signed_out' } : { ok: true }
    }
    const status = await exec('codex', ['login', 'status'], { timeoutMs: 8000 })
    return status.code === 0 ? { ok: true } : { ok: false, problem: 'signed_out' }
  }
}
