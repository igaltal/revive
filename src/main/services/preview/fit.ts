import type { Bounds, PreviewDevice } from '@shared/contract'

export const PHONE_WIDTH = 390

/** Desktop fills the spot; phone is 390 px wide, centred in it. */
export function fitBounds(b: Bounds, device: PreviewDevice): Bounds {
  const r = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) }
  if (device === 'desktop' || r.width <= PHONE_WIDTH) return r
  return { ...r, x: r.x + Math.round((r.width - PHONE_WIDTH) / 2), width: PHONE_WIDTH }
}
