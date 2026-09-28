import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import { BUSY_STATUSES, sessionId, type RunState, type RunStatus } from '@shared/runtime'
import { transport } from '@/transport'
import { useProjects } from './projects'

interface RuntimeContextValue {
  runs: Record<string, RunState>
  /** Picture URLs by project id. */
  shots: Record<string, string>
  start: (projectId: string) => void
  stop: (projectId: string) => void
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null)

/** Everything runner-related arrives on the one runtime event stream. */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const { manifest, reload } = useProjects()
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const [shots, setShots] = useState<Record<string, string>>({})

  // Catch up whenever the project list is (re)loaded: runs may have started before this screen existed.
  useEffect(() => {
    if (manifest?.state !== 'ok') return
    let alive = true
    void transport.invoke('runner:list').then((list) => alive && setRuns(Object.fromEntries(list.map((r) => [r.projectId, r]))))
    void transport.invoke('shots:list').then((paths) => {
      if (alive) setShots(Object.fromEntries(Object.entries(paths).map(([id, p]) => [id, transport.assetUrl(p)])))
    })
    return () => {
      alive = false
    }
  }, [manifest])

  useEffect(
    () =>
      transport.subscribe('runtime:event', (e) => {
        if (e.type === 'status.changed') setRuns((r) => ({ ...r, [e.state.projectId]: e.state }))
        else if (e.type === 'shot.captured') setShots((s) => ({ ...s, [e.projectId]: transport.assetUrl(e.path) }))
        else if (e.type === 'manifest.changed') reload()
      }),
    [reload]
  )

  const start = useCallback((projectId: string) => {
    void transport.invoke('runner:start', { projectId }).then((state) => setRuns((r) => ({ ...r, [projectId]: state })))
  }, [])
  const stop = useCallback((projectId: string) => {
    void transport.invoke('runner:stop', { projectId })
  }, [])

  const value = useMemo(() => ({ runs, shots, start, stop }), [runs, shots, start, stop])
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext)
  if (!ctx) throw new Error('useRuntime must be used inside RuntimeProvider')
  return ctx
}

export type DisplayStatus = { kind: 'running' | 'verified' | 'broken' | 'unknown' } | { kind: 'busy'; phase: RunStatus }

/** What the user sees: the live run when there is one, otherwise what the manifest remembers. */
export function displayStatus(project: Project, run: RunState | undefined): DisplayStatus {
  if (run) {
    if (run.status === 'running') return { kind: 'running' }
    if (BUSY_STATUSES.includes(run.status)) return { kind: 'busy', phase: run.status }
    if (run.status === 'broken') return { kind: 'broken' }
  }
  return { kind: project.status === 'running' ? 'unknown' : project.status }
}

/** The project's recent output (masked by main), refreshed whenever its run session prints. */
export function useProjectLog(projectId: string): string[] {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      timer = null
      void transport.invoke('runner:logs', { projectId }).then((l) => alive && setLines(l))
    }
    refresh()
    const later = () => {
      if (!timer) timer = setTimeout(refresh, 250)
    }
    const offOutput = transport.subscribe('session:output', later, { sessionId: sessionId({ projectId, kind: 'run' }), fromOffset: 0 })
    // A new start clears the log even before anything is printed.
    const offState = transport.subscribe('runtime:event', (e) => {
      if (e.type === 'process.started' && e.session.projectId === projectId) later()
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      offOutput()
      offState()
    }
  }, [projectId])
  return lines
}
