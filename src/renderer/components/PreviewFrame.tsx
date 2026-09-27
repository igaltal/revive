import { useEffect, useRef, type ReactNode } from 'react'
import type { PreviewDevice } from '@shared/ipc'
import { transport } from '@/transport'
import { usePreviewCovered } from '@/state/overlay'
import { useRuntime } from '@/state/runtime'

/**
 * Reserves the spot where the live preview appears. Main draws the running
 * app there; this element only reports where "there" is, clipped to the
 * visible part of the scrolling page.
 */
export function PreviewFrame({ projectId, device }: { projectId: string; device: PreviewDevice }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  // While a dialog or menu is open, main has hidden the live view; its latest picture stands in.
  const covered = usePreviewCovered()
  const picture = useRuntime().shots[projectId]

  useEffect(() => {
    const el = ref.current
    if (!el || covered) return
    let frame = 0
    const report = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const clip = el.closest('[data-scroll-root]')?.getBoundingClientRect() ?? { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }
      const top = Math.max(r.top, clip.top)
      const bottom = Math.min(r.bottom, clip.bottom)
      const left = Math.max(r.left, clip.left)
      const right = Math.min(r.right, clip.right)
      if (bottom - top < 40 || right - left < 40) {
        void transport.invoke('preview:hide')
        return
      }
      void transport.invoke('preview:show', { projectId, device, bounds: { x: left, y: top, width: right - left, height: bottom - top } })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    schedule()
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    resize?.observe(el)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      resize?.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      void transport.invoke('preview:hide')
    }
  }, [projectId, device, covered])

  return (
    <div ref={ref} data-testid="preview-frame" data-device={device} data-covered={covered} className="flex h-[560px] w-full justify-center overflow-hidden bg-bg">
      {covered && picture ? (
        <img src={picture} alt="" data-testid="preview-standin" className={device === 'phone' ? 'h-full w-[390px] object-cover object-top' : 'h-full w-full object-cover object-top'} />
      ) : null}
    </div>
  )
}
