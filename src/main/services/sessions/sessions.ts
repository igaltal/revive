import type { SessionsInfo } from '@shared/contract'
import type { SessionRef } from '@shared/runtime'
import type { ExistingSession, SessionBackend } from './backend'
import type { SessionHub } from './session-hub'
import type { ProjectSource } from '../runner/runner'
import { readEnvSecrets } from '../runner/env-secrets'

export interface QuitPolicy {
  /** Host mode: every session keeps running for paired devices. */
  hosting: boolean
  /** Local mode: Claude Code, Codex and shell sessions keep running (Settings). */
  keepAgents: boolean
}

/**
 * The sessions Revive finds and leaves behind. At startup it takes over the
 * tmux sessions of known projects; the rest are listed for cleanup and never
 * ended without the user asking. At quit it decides what keeps running.
 */
export class Sessions {
  private orphans: ExistingSession[] = []

  constructor(
    private readonly deps: {
      hub: SessionHub
      backend: SessionBackend
      projects: ProjectSource & { projectIds(): Promise<{ projectIds: Set<string> } | null> }
      runner: { adopt(projectId: string): Promise<void>; stopAll(): Promise<void> }
      tmuxVersion: string | null
    }
  ) {}

  /** Takes over what an earlier Revive left running. */
  async adopt(): Promise<void> {
    const existing = await this.deps.backend.list()
    const known = (await this.deps.projects.projectIds())?.projectIds ?? new Set<string>()
    const orphans: ExistingSession[] = []
    for (const e of existing) {
      if (!e.ref || !known.has(e.ref.projectId)) {
        orphans.push(e)
        continue
      }
      const ref: SessionRef = e.ref
      let secrets: string[] = []
      try {
        secrets = (await readEnvSecrets((await this.deps.projects.resolve(ref.projectId)).dir)).values
      } catch {
        // the folder may be gone; nothing to mask then
      }
      this.deps.hub.adopt({ ...e, ref }, { step: e.step ?? (ref.kind === 'run' ? 'dev' : 'terminal'), display: e.display ?? e.name, secrets })
      if (ref.kind === 'run') await this.deps.runner.adopt(ref.projectId)
    }
    this.orphans = orphans
  }

  info(): SessionsInfo {
    return {
      backend: this.deps.backend.kind,
      persistent: this.deps.backend.persistent,
      tmuxVersion: this.deps.tmuxVersion,
      orphans: this.orphans.map((o) => ({ name: o.name, projectId: o.ref?.projectId ?? null, kind: o.ref?.kind ?? null, createdAt: o.createdAt }))
    }
  }

  /** Ends one orphan the user chose to end. */
  async endOrphan(name: string): Promise<SessionsInfo> {
    if (!this.orphans.some((o) => o.name === name)) throw new Error('Not in the cleanup list')
    await this.deps.backend.end(name)
    this.orphans = this.orphans.filter((o) => o.name !== name)
    return this.info()
  }

  /**
   * At quit. Without tmux, everything stops (it can't outlive Revive).
   * Hosting: everything keeps running. Local: dev servers stop as always;
   * agents and shells keep running if the setting says so.
   */
  async quit(policy: QuitPolicy): Promise<void> {
    const { hub } = this.deps
    if (!hub.persistent) {
      await this.deps.runner.stopAll()
      await hub.killAll()
      return
    }
    if (policy.hosting) return hub.detachAll()
    await this.deps.runner.stopAll()
    if (policy.keepAgents) return hub.detachAll((ref) => ref.kind !== 'run')
    await hub.killAll()
  }
}
