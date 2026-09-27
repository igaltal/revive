import { useCallback, useEffect, useState } from 'react'
import type { GuardState } from '@shared/guard'
import { transport } from '@/transport'

/** Whether the installed Claude Code proved it stops at Revive's turn limit. */
export function useGuard(): { guard: GuardState | null; recheck: () => void } {
  const [guard, setGuard] = useState<GuardState | null>(null)
  useEffect(() => {
    let alive = true
    void transport.invoke('guard:status').then((g) => alive && setGuard(g))
    const off = transport.on('guard:changed', setGuard)
    return () => {
      alive = false
      off()
    }
  }, [])
  const recheck = useCallback(() => {
    void transport.invoke('guard:recheck').then(setGuard)
  }, [])
  return { guard, recheck }
}
