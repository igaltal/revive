import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ClientStatus } from '@shared/contract'
import { transport } from '@/transport'

const ClientContext = createContext<ClientStatus | null>(null)

/**
 * Where this window's work happens: this computer, or another one it is
 * connected to. Nothing renders until that's known, so every screen starts
 * with the right capabilities.
 */
export function ClientProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ClientStatus | null>(null)
  useEffect(() => {
    let alive = true
    const off = transport.subscribe('client:status', (s) => alive && setStatus(s))
    void transport
      .invoke('client:status')
      .then((s) => alive && setStatus((cur) => cur ?? s))
      .catch(() => alive && setStatus((cur) => cur ?? { state: 'local', host: null, problem: null, capabilities: transport.capabilities() }))
    return () => {
      alive = false
      off()
    }
  }, [])
  if (!status) return null
  return <ClientContext.Provider value={status}>{children}</ClientContext.Provider>
}

export function useClient(): ClientStatus {
  const ctx = useContext(ClientContext)
  if (!ctx) throw new Error('useClient must be used inside ClientProvider')
  return ctx
}

/** In client mode: the Host's name. */
export function useHostName(): string | null {
  return useContext(ClientContext)?.host?.name ?? null
}
