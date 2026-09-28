/**
 * The landscape behind the Scenic theme: sky, mountains, lake, pines and
 * stars, drawn as SVG path data. Ported from `buildScene` in
 * docs/design/home/*.reference.html, with dawn and day added in the same
 * shape. A pure function of (kind, width, height): the same input always
 * gives the same scene, so it never flickers between renders.
 *
 * The world is 1440 × 1024. A wide screen sees all of it; a tall one (a
 * phone) sees the middle, as in the phone reference.
 */

export const SCENE_KINDS = ['dawn', 'day', 'dusk', 'night'] as const
export type SceneKind = (typeof SCENE_KINDS)[number]

export interface ScenePalette {
  sky0: string
  sky1: string
  sky2: string
  sky3: string
  glow: string
  glowOp: number
  range1: string
  snow: string
  range2: string
  hills: string
  trees: string
  lakeTop: string
  lakeMid: string
  lakeDeep: string
  /** The moon's radius; 0 for none. */
  moonR: number
  /** Darkening at the top of the screen, where the clock sits on the sky (bright scenes only). */
  topScrim: number
  /** How bright the stars are (0 for none). */
  starsOp: number
}

export interface Scene extends ScenePalette {
  kind: SceneKind
  /** Wide: the desktop composition. Tall: the phone's (fewer layers, a different sky). */
  layout: 'wide' | 'tall'
  viewBox: string
  /** Where the sky's colors sit, as offsets of the sky's height. */
  skyStops: [number, number, number, number]
  pinesL: string
  pinesR: string
  shore: string
  /** Stars in three groups, so each can twinkle on its own. */
  stars: [string, string, string]
}

export const WORLD = { width: 1440, height: 1024 } as const

/** The reference palettes (dusk, night) and two more in the same shape. */
export const PALETTES: Record<SceneKind, ScenePalette> = {
  dawn: {
    sky0: '#27325c',
    sky1: '#5f6a9a',
    sky2: '#c99aae',
    sky3: '#ffcfa6',
    glow: '#ffe2bd',
    glowOp: 0.7,
    range1: '#6b7294',
    snow: '#f7e6e1',
    range2: '#3a4466',
    hills: '#111a2c',
    trees: '#16213a',
    lakeTop: '#b89aa8',
    lakeMid: '#3f4a6e',
    lakeDeep: '#141d33',
    moonR: 0,
    topScrim: 0.18,
    starsOp: 0.35
  },
  day: {
    sky0: '#2f6fb6',
    sky1: '#5a98d4',
    sky2: '#9cc4e6',
    sky3: '#d6e7f2',
    glow: '#fff4d6',
    glowOp: 0.55,
    range1: '#6a84a6',
    snow: '#f3f6fa',
    range2: '#46607f',
    hills: '#1a2f40',
    trees: '#1f3648',
    lakeTop: '#86aac8',
    lakeMid: '#46698c',
    lakeDeep: '#1b3550',
    moonR: 0,
    topScrim: 0.34,
    starsOp: 0
  },
  dusk: {
    sky0: '#1a2644',
    sky1: '#394a74',
    sky2: '#9b7b8e',
    sky3: '#f3b789',
    glow: '#ffd3a3',
    glowOp: 0.75,
    range1: '#56648a',
    snow: '#f1e1dc',
    range2: '#2d3954',
    hills: '#0c1320',
    trees: '#101929',
    lakeTop: '#8e7686',
    lakeMid: '#2a3753',
    lakeDeep: '#0e1627',
    moonR: 0,
    topScrim: 0,
    starsOp: 0
  },
  night: {
    sky0: '#050a18',
    sky1: '#0d1833',
    sky2: '#1f2f58',
    sky3: '#34477a',
    glow: '#9fb4ea',
    glowOp: 0.35,
    range1: '#26345a',
    snow: '#c9d3ea',
    range2: '#161f3a',
    hills: '#050912',
    trees: '#08101f',
    lakeTop: '#27386a',
    lakeMid: '#101a34',
    lakeDeep: '#060b18',
    moonR: 22,
    topScrim: 0,
    starsOp: 0.75
  }
}

/** Colors every scene shares (from the reference). */
export const SCENE_FIXED = {
  star: '#ffffff',
  moon: '#eef1f8',
  shimmer: '#ffffff',
  /** The fade over the lake, and the phone's darkening toward the bottom. */
  fade: '#060a14',
  /** Behind everything while the scene loads. */
  ground: '#0b1120'
} as const

/** Fixed pieces of the composition (from the reference). */
export const SHAPES = {
  range1: 'M0 520 L90 492 L170 505 L260 458 L330 474 L420 420 L500 440 L590 360 L660 300 L720 228 L784 282 L836 272 L900 332 L980 380 L1060 408 L1150 388 L1240 428 L1330 418 L1440 452 L1440 610 L0 610 Z',
  range1Reflection: 'M0 520 L90 492 L170 505 L260 458 L330 474 L420 420 L500 440 L590 360 L660 300 L720 228 L784 282 L836 272 L900 332 L980 380 L1060 408 L1150 388 L1240 428 L1330 418 L1440 452 L1440 600 L0 600 Z',
  snow: 'M660 300 L720 228 L784 282 L764 290 L746 272 L730 298 L710 282 L690 308 Z',
  range2: 'M0 560 L140 522 L250 546 L380 502 L470 530 L560 506 L650 540 L760 516 L880 548 L1000 506 L1120 536 L1250 500 L1360 528 L1440 512 L1440 610 L0 610 Z',
  shimmer: 'M560 640 h260 v1.5 h-260 z M700 662 h180 v1.2 h-180 z M620 690 h120 v1 h-120 z M980 650 h140 v1.2 h-140 z',
  hillL: 'M0 610 L0 418 C80 428 180 468 260 518 C300 544 340 570 400 604 Z',
  hillR: 'M1440 610 L1440 398 C1360 418 1260 468 1180 528 C1140 558 1100 580 1050 604 Z'
} as const

/** The reference's hash: a fixed pseudo random number per index. */
function rnd(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const f = (n: number) => n.toFixed(1)

function pine(x: number, base: number, h: number): string {
  const w = h * 0.46
  const bottoms = [0, 0.3, 0.55]
  const apex = [0.55, 0.8, 1]
  const half = [0.5, 0.38, 0.26]
  let d = ''
  for (let k = 0; k < 3; k++) {
    const by = base - h * bottoms[k]!
    const ay = base - h * apex[k]!
    const hw = w * half[k]!
    d += `M${f(x - hw)} ${f(by)} L${f(x)} ${f(ay)} L${f(x + hw)} ${f(by)} Z `
  }
  d += `M${f(x - h * 0.03)} ${f(base)} h${f(h * 0.06)} v${f(h * 0.08)} h${f(-h * 0.06)} Z `
  return d
}

// The trees and the shore are the same in every scene: built once.
let trees: { pinesL: string; pinesR: string; shore: string } | null = null
function forest() {
  if (trees) return trees
  let pinesL = ''
  let pinesR = ''
  let shore = ''
  for (let i = 0; i < 26; i++) {
    const x = rnd(i) * 370
    const t = x / 390
    pinesL += pine(x, 438 + t * 160 + 22, (175 - t * 115) * (0.7 + rnd(i + 50) * 0.5))
  }
  for (let j = 0; j < 26; j++) {
    const xr = 1440 - rnd(j + 100) * 380
    const tr = (1440 - xr) / 400
    pinesR += pine(xr, 418 + tr * 175 + 22, (180 - tr * 115) * (0.7 + rnd(j + 150) * 0.5))
  }
  for (let k = 0; k < 112; k++) shore += pine(k * 13 + rnd(k + 200) * 8, 598, 10 + rnd(k + 300) * 22)
  trees = { pinesL, pinesR, shore }
  return trees
}

function starField(count: number): [string, string, string] {
  const groups: [string, string, string] = ['', '', '']
  for (let s = 0; s < count; s++) {
    const sx = rnd(s + 500) * 1440
    const sy = rnd(s + 900) * 380
    const sz = 0.8 + rnd(s + 1300) * 1.6
    groups[s % 3] += `M${f(sx)} ${f(sy)} h${f(sz)} v${f(sz)} h${f(-sz)} Z `
  }
  return groups.map((g) => g || 'M0 0 Z') as [string, string, string]
}

const STAR_COUNT: Record<SceneKind, number> = { dawn: 40, day: 0, dusk: 0, night: 140 }

/** What part of the world a screen of this shape shows (the rest is cut off by `slice`). */
export function viewBoxFor(width: number, height: number): { layout: 'wide' | 'tall'; viewBox: string } {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  if (w / h >= 1) return { layout: 'wide', viewBox: `0 0 ${WORLD.width} ${WORLD.height}` }
  // Tall: centered on the peak, 964 high from y = 60 (the phone reference: 380 60 680 964).
  const vh = 964
  const vw = Math.min(WORLD.width, Math.max(680, Math.round(vh * (w / h))))
  const x = Math.round(720 - vw / 2)
  return { layout: 'tall', viewBox: `${x} 60 ${vw} ${vh}` }
}

export function buildScene(kind: SceneKind, width: number, height: number): Scene {
  const { layout, viewBox } = viewBoxFor(width, height)
  const { pinesL, pinesR, shore } = forest()
  return {
    ...PALETTES[kind],
    kind,
    layout,
    viewBox,
    // The desktop sky reaches its horizon color early; the phone's sky runs down to the ridge.
    skyStops: layout === 'wide' ? [0, 0.3, 0.47, 0.58] : [0, 0.48, 0.76, 0.94],
    pinesL,
    pinesR,
    shore,
    stars: starField(STAR_COUNT[kind])
  }
}

/** Every solid color a scene paints, glow included: what glass may end up over. */
export function sceneColors(kind: SceneKind): string[] {
  const p = PALETTES[kind]
  return [p.sky0, p.sky1, p.sky2, p.sky3, p.range1, p.snow, p.range2, p.hills, p.trees, p.lakeTop, p.lakeMid, p.lakeDeep]
}
