import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ManifestState } from '@shared/manifest'
import type { ScanDone, ScanProgress } from '@shared/scan'
import { useSettings } from './settings'
import { transport } from '@/transport'

interface ProjectsContextValue {
  manifest: ManifestState | null
  scan: { scanId: string; progress: ScanProgress | null } | null
  /** The outcome of the last scan in this session, until dismissed. */
  lastResult: ScanDone | null
  startScan: () => void
  cancelScan: () => void
  dismissResult: () => void
  reload: () => void
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [manifest, setManifest] = useState<ManifestState | null>(null)
  const [scan, setScan] = useState<ProjectsContextValue['scan']>(null)
  const [lastResult, setLastResult] = useState<ScanDone | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const folder = settings.lastFolder

  useEffect(() => {
    if (!folder) return
    let alive = true
    void transport
      .invoke('manifest:get')
      .then((m) => alive && setManifest(m))
      .catch(() => alive && setManifest({ state: 'none' }))
    return () => {
      alive = false
    }
  }, [folder, reloadTick])

  useEffect(() => {
    let alive = true
    void transport.invoke('scan:active').then((a) => {
      if (alive && a) setScan((s) => s ?? { scanId: a.scanId, progress: null })
    })
    const offProgress = transport.subscribe('scan:progress', (p) => setScan({ scanId: p.scanId, progress: p }))
    const offDone = transport.subscribe('scan:done', (d) => {
      setScan(null)
      setLastResult(d)
      setReloadTick((n) => n + 1)
    })
    return () => {
      alive = false
      offProgress()
      offDone()
    }
  }, [])

  const startScan = useCallback(() => {
    setLastResult(null)
    void transport.invoke('scan:start').then(({ scanId }) => setScan((s) => s ?? { scanId, progress: null }))
  }, [])
  const cancelScan = useCallback(() => {
    if (scan) void transport.invoke('scan:cancel', { scanId: scan.scanId })
  }, [scan])
  const dismissResult = useCallback(() => setLastResult(null), [])
  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  const value = useMemo(
    () => ({ manifest, scan, lastResult, startScan, cancelScan, dismissResult, reload }),
    [manifest, scan, lastResult, startScan, cancelScan, dismissResult, reload]
  )
  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjects must be used inside ProjectsProvider')
  return ctx
}
