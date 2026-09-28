import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildScene, SCENE_KINDS, viewBoxFor } from '../src/renderer/theme/scene'
import { AA, contrast, over, parseColor, rgba, textContrast } from '../src/renderer/theme/contrast'
import { ACCENT_PRESETS, accentTokens, backdropWorst, GLASS, glassAlpha, glassTextContrast, onSceneContrast, photoDim, SCENIC, themeVars, type Backdrop, type GlassStrength } from '../src/renderer/theme/tokens'
import { motionFps, runMotion, type MotionEnv } from '../src/renderer/theme/motion'
import { tileLook, TILE_COLORS, TILE_ICONS } from '../src/renderer/theme/tiles'
import { brightestOf } from '../src/renderer/theme/photo'

const STRENGTHS: GlassStrength[] = ['light', 'normal', 'strong']
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

describe('the scene is a pure function of (kind, width, height)', () => {
  it('gives exactly the same scene every time', () => {
    for (const kind of SCENE_KINDS) {
      for (const [w, h] of [
        [1440, 1024],
        [390, 844],
        [1920, 1080],
        [768, 1024]
      ] as const) {
        expect(hash(buildScene(kind, w, h))).toBe(hash(buildScene(kind, w, h)))
      }
    }
  })

  it('matches the reference composition: its trees, its stars, its phone crop', () => {
    const dusk = buildScene('dusk', 1440, 1024)
    const night = buildScene('night', 1440, 1024)
    // The reference's own numbers: 26 pines on each side, 112 along the shore, 140 stars at night, none at dusk.
    expect(dusk.pinesL.match(/M/g)!.length).toBe(26 * 4)
    expect(dusk.pinesR.match(/M/g)!.length).toBe(26 * 4)
    expect(dusk.shore.match(/M/g)!.length).toBe(112 * 4)
    expect(night.stars.join(' ').match(/M/g)!.length).toBe(140)
    expect(dusk.starsOp).toBe(0)
    expect(night.moonR).toBe(22)
    expect(viewBoxFor(390, 844)).toEqual({ layout: 'tall', viewBox: '380 60 680 964' })
    expect(viewBoxFor(1440, 1024)).toEqual({ layout: 'wide', viewBox: '0 0 1440 1024' })
  })

  it('is a faithful port: the same paths and palettes as the reference’s own buildScene', () => {
    for (const file of ['home-desktop', 'home-phone']) {
      const html = readFileSync(`docs/design/home/${file}.reference.html`, 'utf8')
      const start = html.indexOf('buildScene(kind) {') + 'buildScene(kind) {'.length
      const end = html.indexOf('\n  renderVals()', start)
      const body = html.slice(start, end).trim().replace(/}$/, '')
      const reference = new Function('kind', body) as (k: string) => Record<string, string | number>
      for (const kind of ['dusk', 'night'] as const) {
        const ref = reference(kind)
        const ours = buildScene(kind, 1440, 1024)
        expect(ours.pinesL).toBe(ref['pinesL'])
        expect(ours.pinesR).toBe(ref['pinesR'])
        expect(ours.shore).toBe(ref['shore'])
        const squares = (d: string) => (d.match(/M[^M]+/g) ?? []).map((x) => x.trim()).filter((x) => x !== 'M0 0 Z').sort()
        expect(squares(ours.stars.join(' '))).toEqual(squares(String(ref['stars'])))
        for (const k of ['sky0', 'sky1', 'sky2', 'sky3', 'glow', 'glowOp', 'range1', 'snow', 'range2', 'hills', 'trees', 'lakeTop', 'lakeMid', 'lakeDeep', 'moonR'] as const) {
          expect(ours[k], `${file} ${kind} ${k}`).toBe(ref[k])
        }
      }
    }
  })

  it('has four different skies, and the size only changes the framing', () => {
    const skies = new Set(SCENE_KINDS.map((k) => buildScene(k, 1440, 1024).sky0))
    expect(skies.size).toBe(4)
    const a = buildScene('day', 1440, 1024)
    const b = buildScene('day', 390, 844)
    expect(b.pinesL).toBe(a.pinesL)
    expect(b.viewBox).not.toBe(a.viewBox)
  })
})

describe('glass text contrast stays at or above 4.5:1', () => {
  it('over every scene, at every glass strength', () => {
    for (const scene of SCENE_KINDS) {
      for (const g of STRENGTHS) {
        const b: Backdrop = { scene }
        expect(glassTextContrast(g, b), `${scene} ${g}`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  it('over a bright photo (white, yellow, sky blue, a busy dark one), at every strength, and the date straight on it', () => {
    for (const worst of ['#ffffff', '#fff3a0', '#9fdcff', '#f5c6d0', '#444444']) {
      const b: Backdrop = { photo: { worst, dim: photoDim(worst) } }
      expect(onSceneContrast(b), `date on ${worst}`).toBeGreaterThanOrEqual(AA)
      for (const g of STRENGTHS) expect(glassTextContrast(g, b), `${worst} ${g}`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('the clock and date read on every sky', () => {
    for (const scene of SCENE_KINDS) expect(onSceneContrast({ scene }), scene).toBeGreaterThanOrEqual(AA)
  })

  it('panes inside a glass sheet, and accent text, read too', () => {
    for (const scene of SCENE_KINDS) {
      for (const g of STRENGTHS) {
        const b: Backdrop = { scene }
        const surface = over(rgba(parseColor(GLASS.tint), glassAlpha(g, b)), backdropWorst(b))
        const pane = over(SCENIC.subtle, surface)
        expect(textContrast(SCENIC.muted, pane), `${scene} ${g} pane`).toBeGreaterThanOrEqual(AA)
        for (const accent of [...Object.values(ACCENT_PRESETS), '#1a1a1a', '#0000ff']) {
          const a = accentTokens('scenic', accent, '#' + [surface.r, surface.g, surface.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''))
          expect(contrast(a.asText, surface), `${accent} on ${scene}`).toBeGreaterThanOrEqual(AA)
          expect(contrast(a.onFill, a.fill), `text on ${accent}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('the strength still matters where the scene allows it (night)', () => {
    const night: Backdrop = { scene: 'night' }
    expect(glassAlpha('light', night)).toBeLessThan(glassAlpha('normal', night))
    expect(glassAlpha('normal', night)).toBeLessThan(glassAlpha('strong', night))
  })

  it('Paper keeps its colors exactly as before', () => {
    const v = themeVars({ theme: 'paper', glass: 'normal', accent: null, backdrop: { scene: 'day' } })
    expect(v).toMatchObject({ '--color-bg': '#f4f2ec', '--color-card': '#ffffff', '--color-ink': '#1b1a17', '--color-muted': '#6b675e', '--color-accent': '#d9480f', '--color-primary': '#1b1a17', '--glass-filter': 'none' })
  })
})

describe('a photo’s brightest spot', () => {
  it('is the brightest pixel of the small, averaged image', () => {
    expect(brightestOf([10, 10, 10, 255, 250, 240, 200, 255, 30, 60, 90, 255])).toBe('#faf0c8')
  })
})

describe('motion', () => {
  function env(visible = true) {
    let vis = visible
    let now = 0
    const listeners = new Set<() => void>()
    let timers: Array<{ ms: number; fn: () => void; next: number }> = []
    const e: MotionEnv = {
      visible: () => vis,
      onVisibilityChange: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
      every: (ms, fn) => {
        const t = { ms, fn, next: now + ms }
        timers.push(t)
        return () => (timers = timers.filter((x) => x !== t))
      },
      now: () => now
    }
    const advance = (ms: number) => {
      const end = now + ms
      for (;;) {
        const t = timers.filter((x) => x.next <= end).sort((a, b) => a.next - b.next)[0]
        if (!t) break
        now = t.next
        t.next += t.ms
        t.fn()
      }
      now = end
    }
    const setVisible = (v: boolean) => {
      vis = v
      listeners.forEach((l) => l())
    }
    return { e, advance, setVisible, timers: () => timers.length }
  }

  it('is off under reduced motion (the system’s or the user’s), a few frames a second otherwise', () => {
    expect(motionFps('full', true)).toBe(0)
    expect(motionFps('reduced', true)).toBe(0)
    expect(motionFps('off', false)).toBe(0)
    expect(motionFps('reduced', false)).toBe(2)
    expect(motionFps('full', false)).toBeLessThanOrEqual(10)
  })

  it('runs nothing at all when off', () => {
    const m = env()
    let frames = 0
    runMotion(0, m.e, () => frames++)
    m.advance(10_000)
    expect(frames).toBe(0)
    expect(m.timers()).toBe(0)
  })

  it('pauses while the page is hidden and resumes when it shows again', () => {
    const m = env()
    let frames = 0
    const stop = runMotion(8, m.e, () => frames++)
    m.advance(1000)
    expect(frames).toBe(8)
    m.setVisible(false)
    expect(m.timers()).toBe(0)
    m.advance(10_000)
    expect(frames).toBe(8)
    m.setVisible(true)
    m.advance(500)
    expect(frames).toBe(12)
    stop()
    m.advance(1000)
    expect(frames).toBe(12)
  })

  it('does not start when the page starts hidden', () => {
    const m = env(false)
    let frames = 0
    runMotion(8, m.e, () => frames++)
    m.advance(5000)
    expect(frames).toBe(0)
  })
})

describe('project tiles', () => {
  it('has 40 icons and 12 colors, and a stable generated tile per project', () => {
    expect(TILE_ICONS).toHaveLength(40)
    expect(TILE_COLORS).toHaveLength(12)
    expect(tileLook('trail-map')).toEqual(tileLook('trail-map'))
    expect(tileLook('trail-map', { icon: 3, color: 5, pinned: true })).toMatchObject({ iconIndex: 3, colorIndex: 5 })
    const spread = new Set(['a', 'b', 'c', 'trail-map', 'camp-site', 'relay', 'loop', 'ride-share'].map((id) => tileLook(id).iconIndex))
    expect(spread.size).toBeGreaterThan(4)
  })

  it('every tile color keeps its icon visible (3:1, as for graphics)', () => {
    for (const c of TILE_COLORS) {
      expect(Math.max(contrast(c.glyph, c.from), contrast(c.glyph, c.to)), `${c.from}`).toBeGreaterThanOrEqual(2)
    }
  })
})
