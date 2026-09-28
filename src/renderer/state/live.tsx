import { useEffect, useState } from 'react'
import type { Project } from '@shared/manifest'
import { BUSY_STATUSES, type RunState, type SessionKind } from '@shared/runtime'
import type { Vitals } from '@shared/vitals'
import { transport } from '@/transport'

export interface LiveSession {
  sessionId: string
  projectId: string
  kind: SessionKind
}

/** Every open session, of every project, kept current from the event stream. */
export function useAllSessions(): LiveSession[] {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  useEffect(() => {
    let alive = true
    const refresh = () =>
      void transport
        .invoke('sessions:list')
        .then((list) => alive && setSessions(list.map((s) => ({ sessionId: s.sessionId, projectId: s.projectId, kind: s.kind }))))
        .catch(() => {})
    refresh()
    const off = transport.subscribe('runtime:event', (e) => {
      if (e.type === 'process.started' || e.type === 'process.exited') refresh()
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return sessions
}

/** How often a watch is renewed; well inside the Host's lease. */
const RENEW_MS = 8000

/**
 * The Host's vitals while this screen is shown. Watching is what makes the
 * Host sample at all; leaving the screen stops it (and a lost connection
 * lets the lease run out on its own).
 */
export function useVitals(enabled = true): Vitals | null {
  const [vitals, setVitals] = useState<Vitals | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let lease: string | undefined
    const watch = () =>
      void transport
        .invoke('vitals:watch', lease ? { leaseId: lease } : {})
        .then((r) => {
          if (!alive) {
            void transport.invoke('vitals:unwatch', { leaseId: r.leaseId }).catch(() => {})
            return
          }
          lease = r.leaseId
          if (r.vitals) setVitals(r.vitals)
        })
        .catch(() => {})
    watch()
    const renew = setInterval(watch, RENEW_MS)
    const off = transport.subscribe('runtime:event', (e) => {
      if (e.type === 'vitals.updated' && alive) setVitals(e.vitals)
    })
    // A reconnect gets a fresh lease (the old one may have run out meanwhile).
    const offConn = transport.onConnection((state) => {
      if (state === 'open') watch()
    })
    return () => {
      alive = false
      clearInterval(renew)
      off()
      offConn()
      if (lease) void transport.invoke('vitals:unwatch', { leaseId: lease }).catch(() => {})
    }
  }, [enabled])
  return vitals
}

export type TileStatusKind = 'working' | 'waiting' | 'review' | 'idle' | 'failed'

export interface TileStatus {
  kind: TileStatusKind
  /** An i18n key and its values. */
  key: string
  values?: Record<string, unknown>
}

export const AGENT_NAMES: Record<'claude' | 'codex', string> = { claude: 'Claude Code', codex: 'Codex' }

/** One line for a project tile: what's happening there, in the status colors of the design. */
export function tileStatus(project: Project, run: RunState | undefined, sessions: LiveSession[]): TileStatus {
  if (run?.status === 'broken') return { kind: 'failed', key: 'vocab.needsFixing' }
  const agent = sessions.find((s) => s.projectId === project.id && (s.kind === 'claude' || s.kind === 'codex'))
  if (agent) return { kind: 'working', key: 'home.status.agentWorking', values: { agent: AGENT_NAMES[agent.kind as 'claude' | 'codex'] } }
  if (run?.status === 'running') return run.port ? { kind: 'working', key: 'home.status.runningOn', values: { port: run.port } } : { kind: 'working', key: 'vocab.runningNow' }
  if (run && BUSY_STATUSES.includes(run.status)) return { kind: 'working', key: `run.phase.${run.status}` }
  if (project.status === 'broken') return { kind: 'failed', key: 'vocab.needsFixing' }
  if (project.status === 'verified') return { kind: 'review', key: 'vocab.checkedAndWorking' }
  return { kind: 'idle', key: 'home.status.ready' }
}

/** The status color of each kind, as a token utility. */
export const STATUS_DOT: Record<TileStatusKind, string> = {
  working: 'bg-running',
  waiting: 'bg-attention',
  review: 'bg-verified',
  idle: 'bg-idle',
  failed: 'bg-broken'
}
export const STATUS_TEXT: Record<TileStatusKind, string> = {
  working: 'text-running',
  waiting: 'text-attention',
  review: 'text-verified',
  idle: 'text-muted',
  failed: 'text-broken'
}
