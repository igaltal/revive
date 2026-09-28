import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StateEvent } from '@shared/runtime'
import type { TrashInfo, VersionSummary } from '@shared/versions'
import { transport } from '@/transport'
import { useSettings } from './settings'

export type LastRestore = Extract<StateEvent, { type: 'version.restored' }>

interface VersionsContextValue {
  versions: VersionSummary[] | null
  trash: TrashInfo | null
  /** The latest go back or undo, from the event stream, until dismissed. */
  lastRestore: LastRestore | null
  dismissRestore: () => void
  refresh: () => void
}

const VersionsContext = createContext<VersionsContextValue | null>(null)

export function VersionsProvider({ children }: { children: ReactNode }) {
  const folder = useSettings().settings.lastFolder
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [trash, setTrash] = useState<TrashInfo | null>(null)
  const [lastRestore, setLastRestore] = useState<LastRestore | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!folder) return
    let alive = true
    void transport
      .invoke('versions:list')
      .then((v) => alive && setVersions(v))
      .catch(() => alive && setVersions([]))
    void transport
      .invoke('trash:info')
      .then((t) => alive && setTrash(t))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [folder, tick])

  useEffect(
    () =>
      transport.subscribe('runtime:event', (e) => {
        if (e.type === 'version.saved' || e.type === 'trash.emptied') refresh()
        if (e.type === 'version.restored') {
          setLastRestore(e)
          refresh()
        }
      }),
    [refresh]
  )

  const dismissRestore = useCallback(() => setLastRestore(null), [])
  const value = useMemo(() => ({ versions, trash, lastRestore, dismissRestore, refresh }), [versions, trash, lastRestore, dismissRestore, refresh])
  return <VersionsContext.Provider value={value}>{children}</VersionsContext.Provider>
}

export function useVersions(): VersionsContextValue {
  const ctx = useContext(VersionsContext)
  if (!ctx) throw new Error('useVersions must be used inside VersionsProvider')
  return ctx
}
