import { sessionId, type SessionId, type SessionKind, type SessionRef } from '@shared/runtime'
import type { SessionHub } from './sessions/session-hub'
import type { ProjectSource } from './runner/runner'
import { readEnvSecrets } from './runner/env-secrets'
import type { AgentCheck, AgentProblem } from './agent-check'

export type TerminalKind = Exclude<SessionKind, 'run'>

/**
 * Interactive terminals in a project's folder: a plain shell, Claude Code or
 * Codex. One per project and kind; opening one that's already running
 * returns it. Any number of clients may watch it and type into it.
 */
export class Terminals {
  constructor(
    private readonly hub: SessionHub,
    private readonly projects: ProjectSource,
    private readonly env: () => Record<string, string> = () => cleanEnv(),
    /** Stand-ins for the agents (development and tests only): kind → program and arguments. */
    private readonly commands: Partial<Record<TerminalKind, { file: string; args: string[] }>> = {},
    /** Is Claude Code or Codex installed and signed in? Checked before every new agent session. */
    private readonly check: AgentCheck = async () => ({ ok: true })
  ) {}

  async open(projectId: string, kind: TerminalKind): Promise<{ ok: true; sessionId: SessionId; created: boolean } | { ok: false; kind: 'claude' | 'codex'; problem: AgentProblem }> {
    const ref: SessionRef = { projectId, kind }
    if (this.hub.get(ref)) return { ok: true, sessionId: sessionId(ref), created: false }
    // An agent that isn't installed or signed in would only flash an error and end: say why instead.
    if ((kind === 'claude' || kind === 'codex') && !this.commands[kind]) {
      const ready = await this.check(kind)
      if (!ready.ok) return { ok: false, kind, problem: ready.problem }
    }
    const { dir } = await this.projects.resolve(projectId)
    const shell = process.env['SHELL'] || '/bin/zsh'
    const standIn = this.commands[kind]
    const command = standIn
      ? { ...standIn, display: [standIn.file, ...standIn.args].join(' ') }
      : kind === 'shell'
        ? { file: shell, args: ['-l'], display: `${shell} -l` }
        : { file: kind, args: [], display: kind }
    const secrets = await readEnvSecrets(dir)
    this.hub.start({ ref, cwd: dir, file: command.file, args: command.args, env: this.env(), step: 'terminal', display: command.display, secrets: secrets.values })
    return { ok: true, sessionId: sessionId(ref), created: true }
  }

  async close(ref: SessionRef): Promise<void> {
    if (ref.kind === 'run') throw new Error('Run sessions are stopped through the runner')
    await this.hub.kill(ref)
  }

  list(): Array<{ sessionId: SessionId; projectId: string; kind: SessionKind; step: ReturnType<SessionHub['list']>[number]['step'] }> {
    return this.hub.list().map((s) => ({ sessionId: sessionId(s.ref), projectId: s.ref.projectId, kind: s.ref.kind, step: s.step }))
  }
}

/** The environment without Electron's or Revive's own switches. */
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ELECTRON_') && !k.startsWith('REVIVE_')) env[k] = v
  return { ...env, TERM: 'xterm-256color' }
}
