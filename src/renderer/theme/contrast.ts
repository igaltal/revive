/**
 * Contrast math for text on glass (WCAG 2 relative luminance and ratio).
 * Blending is done in sRGB, the way the browser composites.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export function parseColor(color: string): Rgba {
  const c = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = [...h].map((x) => x + x).join('')
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c)
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
  throw new Error(`Unsupported color: ${color}`)
}

export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

export function rgba({ r, g, b }: Rgba, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`
}

/** `top` (with its alpha, times `alpha`) painted over an opaque `bottom`. */
export function over(top: Rgba | string, bottom: Rgba | string, alpha = 1): Rgba {
  const t = typeof top === 'string' ? parseColor(top) : top
  const b = typeof bottom === 'string' ? parseColor(bottom) : bottom
  const a = t.a * alpha
  return { r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a), a: 1 }
}

export function luminance(color: Rgba | string): number {
  const c = typeof color === 'string' ? parseColor(color) : color
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

export function contrast(a: Rgba | string, b: Rgba | string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Text (possibly see-through) over an opaque background. */
export function textContrast(text: string, background: Rgba | string): number {
  return contrast(over(text, background), background)
}

export const AA = 4.5

/** The brightest of these colors: the worst case for light text. */
export function brightest(colors: Array<Rgba | string>): Rgba {
  let best: Rgba | null = null
  for (const c of colors) {
    const v = typeof c === 'string' ? parseColor(c) : c
    if (!best || luminance(v) > luminance(best)) best = v
  }
  return best ?? { r: 0, g: 0, b: 0, a: 1 }
}

/**
 * The least `alpha` for `layer` over `backdrop` at which `text` reads at
 * `min`:1, searched between `from` and 1. Returns 1 if even that falls short.
 */
export function minAlphaFor(text: string, layer: string, backdrop: Rgba | string, min = AA, from = 0): number {
  const ok = (a: number) => textContrast(text, over(layer, backdrop, a)) >= min
  if (ok(from)) return from
  if (!ok(1)) return 1
  let lo = from
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  // Round up, so the rounded value still passes.
  return Math.ceil(hi * 1000) / 1000
}

/** Dark or light text for a solid fill, whichever reads better. */
export function onColor(fill: string, dark: string, light: string): string {
  return contrast(dark, fill) >= contrast(light, fill) ? dark : light
}

/**
 * `color` moved toward `toward` until it reads at `min`:1 on `background`
 * (an accent used as text: a custom pick can be too dark or too light).
 */
export function readableOn(color: string, background: string, toward: string, min = AA): string {
  const c = parseColor(color)
  const t = parseColor(toward)
  for (let step = 0; step <= 20; step++) {
    const k = step / 20
    const mixed = { r: c.r + (t.r - c.r) * k, g: c.g + (t.g - c.g) * k, b: c.b + (t.b - c.b) * k, a: 1 }
    if (contrast(mixed, background) >= min) return toHex(mixed)
  }
  return toHex(t)
}
