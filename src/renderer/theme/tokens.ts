import { AA, brightest, minAlphaFor, onColor, over, parseColor, readableOn, rgba, textContrast, toHex, type Rgba } from './contrast'
import { PALETTES, sceneColors, type SceneKind } from './scene'

/**
 * Every color Revive paints comes from here (and the scene palettes). The
 * values become CSS variables on <html>; components only use their names
 * (`bg-card`, `text-muted`...). A lint rule keeps raw colors out of the rest
 * of the renderer.
 */

export type ThemeName = 'scenic' | 'paper'
export type GlassStrength = 'light' | 'normal' | 'strong'

/** The six accent presets, the same in both themes. */
export const ACCENT_PRESETS = {
  blue: '#5aa2ff',
  teal: '#3cc4b0',
  orange: '#ff8a4c',
  pink: '#ff7fa0',
  violet: '#9b8cff',
  gold: '#f2b84b'
} as const
export type AccentPreset = keyof typeof ACCENT_PRESETS

// ---------- Scenic: frosted glass over a scene (docs/design/home) ----------

/** The glass recipe: rgba(14, 20, 34, 0.42 to 0.55), a hairline of white, blur and saturation. */
export const GLASS = {
  tint: '#0e1422',
  border: 'rgba(255, 255, 255, 0.13)',
  filter: 'blur(22px) saturate(140%)',
  /** How see-through each strength would like to be, before the contrast floor. */
  alpha: { light: 0.36, normal: 0.46, strong: 0.6 } satisfies Record<GlassStrength, number>
}

export const SCENIC = {
  page: '#0b1120',
  ink: '#f2f5fa',
  /** The dimmest text on glass. Contrast is guaranteed for this one, so everything brighter passes too. */
  muted: 'rgba(242, 245, 250, 0.8)',
  /** Clock and date sit straight on the sky. */
  onScene: 'rgba(242, 245, 250, 0.9)',
  /** Status colors from the reference, plus a red for failed. */
  working: '#5fd38d',
  waiting: '#ffa552',
  review: '#7fb8ff',
  idle: 'rgba(242, 245, 250, 0.5)',
  failed: '#ff7a6b',
  /** The command bar: a light field with dark text. */
  field: 'rgba(246, 248, 252, 0.94)',
  fieldInk: '#141a26',
  fieldMuted: '#5b6475',
  subtle: 'rgba(255, 255, 255, 0.06)',
  scrim: 'rgba(6, 10, 20, 0.55)',
  /** Darkens a personal photo; its strength is computed per photo. */
  dim: '#060a14',
  terminalBg: '#0c111c',
  terminalFg: '#e6ebf3',
  gauges: { cpu: '#5aa2ff', memory: '#5fd38d', disk: '#b18cff', temperature: '#ffa552' },
  defaultAccent: ACCENT_PRESETS.blue
}

// ---------- Paper: the warm editorial look, as it was ----------

export const PAPER = {
  page: '#f4f2ec',
  card: '#ffffff',
  border: '#e4e0d8',
  ink: '#1b1a17',
  muted: '#6b675e',
  running: '#1e8e4e',
  verified: '#2563eb',
  attention: '#b7791f',
  broken: '#b42318',
  idle: '#8a857a',
  subtle: 'rgba(27, 26, 23, 0.04)',
  scrim: 'rgba(27, 26, 23, 0.3)',
  field: '#ffffff',
  terminalBg: '#1d1b18',
  terminalFg: '#ece8df',
  white: '#ffffff',
  gauges: { cpu: '#2563eb', memory: '#1e8e4e', disk: '#7c3aed', temperature: '#b7791f' },
  defaultAccent: '#d9480f'
}

/** What the glass may sit over: a scene, or a personal photo (its brightest spot, already dimmed). */
export type Backdrop = { scene: SceneKind } | { photo: { worst: string; dim: number } }

export function backdropWorst(b: Backdrop): Rgba {
  if ('scene' in b) {
    const p = PALETTES[b.scene]
    // The glow brightens the horizon: count it where it is strongest. The snow cap is a sliver
    // (80 px) that the glass blur (22 px) always averages with its ridge, so it counts half.
    const solid = sceneColors(b.scene).filter((c) => c !== p.snow)
    return brightest([...solid, over(p.snow, p.range1, 0.5), over(p.glow, p.sky3, p.glowOp), over(p.glow, p.lakeTop, p.glowOp)])
  }
  return over(SCENIC.dim, b.photo.worst, b.photo.dim)
}

/**
 * How opaque the glass is: the strength the user picked, but never so
 * see-through that muted text on it drops below 4.5:1 over this backdrop.
 */
export function glassAlpha(strength: GlassStrength, backdrop: Backdrop): number {
  return Math.max(GLASS.alpha[strength], glassFloor(backdrop))
}

/**
 * The least opacity at which the dimmest text reads at 4.5:1, on the glass
 * itself and on a lighter pane inside a sheet of glass (the harder of the two).
 */
export function glassFloor(backdrop: Backdrop): number {
  const worst = backdropWorst(backdrop)
  const tint = parseColor(GLASS.tint)
  const ok = (a: number) => {
    const surface = over(rgba(tint, a), worst)
    return textContrast(SCENIC.muted, surface) >= AA && textContrast(SCENIC.muted, over(SCENIC.subtle, surface)) >= AA
  }
  let lo = 0
  let hi = 1
  if (ok(0)) return 0
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return Math.ceil(hi * 1000) / 1000
}

/**
 * How much a personal photo is darkened: enough that the date (straight on
 * the photo, no glass) reads at 4.5:1 over its brightest spot. At least a
 * little, so a busy photo stays calm behind the interface.
 */
export function photoDim(worst: string): number {
  return Math.max(0.25, minAlphaFor(SCENIC.onScene, SCENIC.dim, worst, AA))
}

/** The accent as a fill, the text that goes on it, and the accent as text on the page. */
export function accentTokens(theme: ThemeName, accent: string | null, surface: string) {
  // Paper's own accent stays exactly as it always was (it's used for large, bold text).
  if (theme === 'paper' && accent === null) return { fill: PAPER.defaultAccent, onFill: PAPER.white, asText: PAPER.defaultAccent }
  const fill = accent ?? SCENIC.defaultAccent
  const onFill = onColor(fill, theme === 'scenic' ? SCENIC.fieldInk : PAPER.ink, PAPER.white)
  const asText = readableOn(fill, surface, theme === 'scenic' ? SCENIC.ink : PAPER.ink)
  return { fill, onFill, asText }
}

/** The CSS variables for one look. */
export function themeVars(opts: { theme: ThemeName; glass: GlassStrength; accent: string | null; backdrop: Backdrop }): Record<string, string> {
  if (opts.theme === 'paper') {
    const a = accentTokens('paper', opts.accent, PAPER.card)
    return {
      '--color-page': PAPER.page,
      '--color-bg': PAPER.page,
      '--color-card': PAPER.card,
      '--color-border': PAPER.border,
      '--color-ink': PAPER.ink,
      '--color-muted': PAPER.muted,
      '--color-on-scene': PAPER.ink,
      '--color-accent': a.asText,
      '--color-accent-fill': a.fill,
      '--color-on-accent': a.onFill,
      '--color-primary': PAPER.ink,
      '--color-on-primary': PAPER.white,
      '--color-running': PAPER.running,
      '--color-verified': PAPER.verified,
      '--color-attention': PAPER.attention,
      '--color-broken': PAPER.broken,
      '--color-on-broken': PAPER.white,
      '--color-idle': PAPER.idle,
      '--color-subtle': PAPER.subtle,
      '--color-scrim': PAPER.scrim,
      '--color-field': PAPER.field,
      '--color-field-ink': PAPER.ink,
      '--color-field-muted': PAPER.muted,
      '--color-knob': PAPER.white,
      '--color-picture': PAPER.white,
      '--color-terminal': PAPER.terminalBg,
      '--color-terminal-ink': PAPER.terminalFg,
      '--color-gauge-cpu': PAPER.gauges.cpu,
      '--color-gauge-memory': PAPER.gauges.memory,
      '--color-gauge-disk': PAPER.gauges.disk,
      '--color-gauge-temperature': PAPER.gauges.temperature,
      '--glass-filter': 'none',
      '--glass-alpha': '1',
      '--scene-text-shadow': 'none',
      '--panel-shadow': '0 1px 2px rgba(27, 26, 23, 0.06)'
    }
  }
  const alpha = glassAlpha(opts.glass, opts.backdrop)
  const tint = parseColor(GLASS.tint)
  // Accent text is checked against the glass over the worst spot of the backdrop.
  const surface = toHex(over(rgba(tint, alpha), backdropWorst(opts.backdrop)))
  const a = accentTokens('scenic', opts.accent, surface)
  return {
    '--color-page': SCENIC.page,
    '--color-bg': SCENIC.subtle,
    '--color-card': rgba(tint, alpha),
    '--color-border': GLASS.border,
    '--color-ink': SCENIC.ink,
    '--color-muted': SCENIC.muted,
    '--color-on-scene': SCENIC.onScene,
    '--color-accent': a.asText,
    '--color-accent-fill': a.fill,
    '--color-on-accent': a.onFill,
    '--color-primary': a.fill,
    '--color-on-primary': a.onFill,
    '--color-running': SCENIC.working,
    '--color-verified': SCENIC.review,
    '--color-attention': SCENIC.waiting,
    '--color-broken': SCENIC.failed,
    '--color-on-broken': SCENIC.fieldInk,
    '--color-idle': SCENIC.idle,
    '--color-subtle': SCENIC.subtle,
    '--color-scrim': SCENIC.scrim,
    '--color-field': SCENIC.field,
    '--color-field-ink': SCENIC.fieldInk,
    '--color-field-muted': SCENIC.fieldMuted,
    '--color-knob': PAPER.white,
    '--color-picture': PAPER.white,
    '--color-terminal': SCENIC.terminalBg,
    '--color-terminal-ink': SCENIC.terminalFg,
    '--color-gauge-cpu': SCENIC.gauges.cpu,
    '--color-gauge-memory': SCENIC.gauges.memory,
    '--color-gauge-disk': SCENIC.gauges.disk,
    '--color-gauge-temperature': SCENIC.gauges.temperature,
    '--glass-filter': GLASS.filter,
    '--glass-alpha': String(alpha),
    '--scene-text-shadow': '0 2px 24px rgba(0, 0, 0, 0.25)',
    '--panel-shadow': '0 10px 40px rgba(0, 0, 0, 0.25)'
  }
}

/** For the contrast test: the dimmest glass text over the worst spot. */
export function glassTextContrast(strength: GlassStrength, backdrop: Backdrop): number {
  const surface = over(rgba(parseColor(GLASS.tint), glassAlpha(strength, backdrop)), backdropWorst(backdrop))
  return textContrast(SCENIC.muted, surface)
}

/** For the contrast test: the date straight on the backdrop, at the top of the screen. */
export function onSceneContrast(backdrop: Backdrop): number {
  if ('photo' in backdrop) return textContrast(SCENIC.onScene, backdropWorst(backdrop))
  const p = PALETTES[backdrop.scene]
  // The clock and date sit over the top of the sky (sky0 to sky1), under the scrim.
  return Math.min(...[p.sky0, p.sky1].map((sky) => textContrast(SCENIC.onScene, over(SCENIC.dim, sky, p.topScrim))))
}

/** The screensaver's own colors (the same in both themes: it always shows the scene or black). */
export const SAVER = {
  dark: '#000000',
  /** The dimmed clock of the dark screensaver. */
  darkInk: 'rgba(242, 245, 250, 0.34)',
  ink: SCENIC.ink,
  /** Behind the one line that names who needs you. */
  chip: 'rgba(0, 0, 0, 0.45)',
  glow: { waiting: SCENIC.waiting, failed: SCENIC.failed, finished: SCENIC.review } as const
}

/**
 * OLED screens: the screensaver's content moves a few pixels every few
 * minutes, so nothing stays lit in one place. A fixed, repeating walk.
 */
export const BURN_IN_STEP_MS = 3 * 60_000
export function burnInOffset(step: number): { x: number; y: number } {
  const walk = [
    [0, 0],
    [4, 2],
    [6, -3],
    [2, -6],
    [-3, -4],
    [-6, 1],
    [-4, 5],
    [1, 6]
  ] as const
  const [x, y] = walk[((step % walk.length) + walk.length) % walk.length]!
  return { x, y }
}
