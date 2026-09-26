import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ManifestState } from '@shared/ipc'
import type { ScanDone, ScanProgress } from '@shared/scan'
import { useSettings } from './settings'

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
    void window.revive
      .invoke('manifest:get')
      .then((m) => alive && setManifest(m))
      .catch(() => alive && setManifest({ state: 'none' }))
    return () => {
      alive = false
    }
  }, [folder, reloadTick])

  useEffect(() => {
    let alive = true
    void window.revive.invoke('scan:active').then((a) => {
      if (alive && a) setScan((s) => s ?? { scanId: a.scanId, progress: null })
    })
    const offProgress = window.revive.on('scan:progress', (p) => setScan({ scanId: p.scanId, progress: p }))
    const offDone = window.revive.on('scan:done', (d) => {
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
    void window.revive.invoke('scan:start').then(({ scanId }) => setScan((s) => s ?? { scanId, progress: null }))
  }, [])
  const cancelScan = useCallback(() => {
    if (scan) void window.revive.invoke('scan:cancel', { scanId: scan.scanId })
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
