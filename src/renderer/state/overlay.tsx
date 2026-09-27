import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { transport } from '@/transport'

/**
 * The live preview is a native view: it always draws on top of the page, so
 * a dialog, menu or sheet can't appear over it. Every overlay goes through
 * `useOverlay`. While any is open, main pictures the preview, hides it, and
 * the preview's spot shows that picture; when the last one closes, the live
 * view comes back.
 */
interface OverlayContextValue {
  /** True while at least one overlay is open. */
  covered: boolean
  /** Registers an open overlay. Resolves once the preview is hidden; call the returned function on close. */
  acquire: () => { ready: Promise<void>; release: () => void }
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

/** Never wait longer than this for the preview to hide before drawing the overlay. */
const MAX_WAIT_MS = 400

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0)
  const open = useRef(0)
  const hidden = useRef<Promise<void>>(Promise.resolve())

  const acquire = useCallback(() => {
    open.current += 1
    setCount(open.current)
    if (open.current === 1) {
      hidden.current = Promise.race([
        transport.invoke('preview:cover').catch(() => {}),
        new Promise<void>((r) => setTimeout(r, MAX_WAIT_MS))
      ]).then(() => {})
    }
    let released = false
    return {
      ready: hidden.current,
      release: () => {
        if (released) return
        released = true
        open.current -= 1
        setCount(open.current)
        if (open.current === 0) void transport.invoke('preview:uncover')
      }
    }
  }, [])

  const value = useMemo(() => ({ covered: count > 0, acquire }), [count, acquire])
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
}

/**
 * Use in every dialog, menu and sheet. Returns true once it's safe to draw:
 * the preview has been pictured and hidden.
 */
export function useOverlay(open: boolean): boolean {
  const acquire = useContext(OverlayContext)?.acquire
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open || !acquire) return
    let alive = true
    const { ready: hidden, release } = acquire()
    void hidden.then(() => alive && setReady(true))
    return () => {
      alive = false
      setReady(false)
      release()
    }
  }, [open, acquire])
  // Without the provider there is no preview to worry about.
  return acquire ? open && ready : open
}

/** For the preview frame: whether something is drawn over it right now. */
export function usePreviewCovered(): boolean {
  return useContext(OverlayContext)?.covered ?? false
}
