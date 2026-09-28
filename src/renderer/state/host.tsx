import { useCallback, useEffect, useState } from 'react'
import type { HostStatus } from '@shared/host'
import { transport } from '@/transport'

/** Host mode, on the Host itself (capabilities().hostControls). */
export function useHostStatus(): { host: HostStatus | null; refresh: () => void } {
  const enabled = transport.capabilities().hostControls
  const [host, setHost] = useState<HostStatus | null>(null)
  const refresh = useCallback(() => {
    if (enabled) void transport.invoke('host:status').then(setHost).catch(() => {})
  }, [enabled])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void transport
      .invoke('host:status')
      .then((h) => alive && setHost(h))
      .catch(() => {})
    const off = transport.subscribe('host:status', (h) => alive && setHost(h))
    return () => {
      alive = false
      off()
    }
  }, [enabled])
  return { host, refresh }
}
