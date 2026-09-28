import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppearance } from '@/state/appearance'
import { buildScene, SCENE_FIXED, SHAPES, type Scene } from '@/theme/scene'
import { browserMotionEnv, motionFps, runMotion, shimmer, systemReducedMotion, twinkle, type MotionEnv, type MotionSetting } from '@/theme/motion'
import { SCENIC } from '@/theme/tokens'

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: typeof window === 'undefined' ? 1440 : window.innerWidth, height: typeof window === 'undefined' ? 1024 : window.innerHeight }))
  useEffect(() => {
    const on = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(systemReducedMotion)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * The scene's motion, applied straight to the SVG (no re-render per frame).
 * Exposes how it runs on the element, so tests can see it's paused or off.
 */
export function useSceneMotion(setting: MotionSetting, target: React.RefObject<SVGSVGElement | null>, env?: MotionEnv): number {
  const reduced = useSystemReducedMotion()
  const fps = motionFps(setting, reduced)
  // Fixed for the component's life (tests pass their own clock and visibility).
  const [motionEnv] = useState(() => env ?? browserMotionEnv())
  useEffect(() => {
    const svg = target.current
    if (!svg) return
    const stars = [0, 1, 2].map((i) => svg.querySelector<SVGPathElement>(`[data-stars="${i}"]`))
    const water = svg.querySelector<SVGPathElement>('[data-shimmer]')
    const stop = runMotion(fps, motionEnv, (t) => {
      stars.forEach((el, i) => el?.setAttribute('opacity', twinkle(i, t).toFixed(3)))
      if (water) {
        const s = shimmer(t)
        water.setAttribute('transform', `translate(${s.dx.toFixed(1)} 0)`)
        water.setAttribute('opacity', s.opacity.toFixed(3))
      }
    })
    return stop
  }, [fps, target, motionEnv])
  return fps
}

/** The landscape, in SVG. Wide screens get the desktop composition, tall ones the phone's. */
export function SceneSvg({ scene, svgRef }: { scene: Scene; svgRef?: React.Ref<SVGSVGElement> }): ReactNode {
  const s = scene
  const id = `scene-${s.kind}-${s.layout}`
  const wide = s.layout === 'wide'
  return (
    <svg ref={svgRef} viewBox={s.viewBox} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden data-scene={s.kind} data-layout={s.layout}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2={wide ? '1' : '620'} gradientUnits={wide ? 'objectBoundingBox' : 'userSpaceOnUse'}>
          {[s.sky0, s.sky1, s.sky2, s.sky3].map((c, i) => (
            <stop key={i} offset={s.skyStops[i]} stopColor={c} />
          ))}
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={s.glow} stopOpacity={s.glowOp} />
          <stop offset="1" stopColor={s.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-lake`} x1="0" y1={wide ? '0' : '600'} x2="0" y2={wide ? '1' : '1024'} gradientUnits={wide ? 'objectBoundingBox' : 'userSpaceOnUse'}>
          <stop offset="0" stopColor={s.lakeTop} />
          <stop offset="0.3" stopColor={s.lakeMid} />
          <stop offset="1" stopColor={s.lakeDeep} />
        </linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SCENE_FIXED.fade} stopOpacity="0" />
          <stop offset="1" stopColor={SCENE_FIXED.fade} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1440" height="620" fill={`url(#${id}-sky)`} />
      {s.starsOp > 0
        ? s.stars.map((d, i) => (
            <g key={i} opacity={s.starsOp}>
              <path d={d} fill={SCENE_FIXED.star} data-stars={i} />
            </g>
          ))
        : null}
      {s.moonR > 0 ? <circle cx={wide ? 1110 : 930} cy={wide ? 150 : 170} r={s.moonR} fill={SCENE_FIXED.moon} /> : null}
      <ellipse cx={wide ? 1040 : 820} cy="560" rx={wide ? 560 : 420} ry={wide ? 220 : 200} fill={`url(#${id}-glow)`} />
      <path d={SHAPES.range1} fill={s.range1} />
      <path d={SHAPES.snow} fill={s.snow} opacity="0.9" />
      <path d={SHAPES.range2} fill={s.range2} />
      <rect x="0" y="600" width="1440" height="424" fill={`url(#${id}-lake)`} />
      {wide ? (
        <g transform="matrix(1 0 0 -1 0 1200)" opacity="0.16">
          <path d={SHAPES.range1Reflection} fill={s.range1} />
        </g>
      ) : null}
      <path d={SHAPES.shimmer} fill={SCENE_FIXED.shimmer} opacity="0.12" data-shimmer />
      <path d={s.shore} fill={s.trees} />
      <rect x="0" y="592" width="1440" height="9" fill={s.trees} />
      {wide ? (
        <>
          <path d={SHAPES.hillL} fill={s.hills} />
          <path d={SHAPES.hillR} fill={s.hills} />
          <path d={s.pinesL} fill={s.hills} />
          <path d={s.pinesR} fill={s.hills} />
          <rect x="0" y="640" width="1440" height="384" fill={`url(#${id}-fade)`} />
        </>
      ) : null}
    </svg>
  )
}

/**
 * Behind every screen in the Scenic theme: the scene of the moment, or the
 * device's own photo, blurred and dimmed so glass text stays readable.
 */
export function SceneBackdrop(): ReactNode {
  const { theme, sky, look, backdrop, photoUrl } = useAppearance()
  const { width, height } = useViewport()
  const scene = useMemo(() => buildScene(sky, width, height), [sky, width, height])
  const svg = useRef<SVGSVGElement>(null)
  const fps = useSceneMotion(look.motion, svg)
  if (theme !== 'scenic') return null
  const photo = 'photo' in backdrop && look.background ? backdrop.photo : null
  const tall = scene.layout === 'tall'
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" data-testid="scene-backdrop" data-sky={photo ? 'photo' : sky} data-motion-fps={photo ? 0 : fps} style={{ backgroundColor: SCENE_FIXED.ground }} aria-hidden>
      {photo && look.background ? (
        <>
          {/* Blurred and a little larger, so the blur has no soft edges. */}
          <div className="absolute -inset-10 bg-cover bg-center" style={{ backgroundImage: `url("${photoUrl(look.background)}")`, filter: 'blur(28px) saturate(120%)' }} />
          <div className="absolute inset-0" style={{ backgroundColor: SCENIC.dim, opacity: photo.dim }} data-testid="photo-dim" data-dim={photo.dim} />
        </>
      ) : (
        <>
          <SceneSvg scene={scene} svgRef={svg} />
          {scene.topScrim > 0 ? (
            <div className="absolute start-0 end-0 top-0 h-[55%]" style={{ background: `linear-gradient(180deg, ${SCENE_FIXED.fade} 0%, ${SCENE_FIXED.fade} 30%, transparent 100%)`, opacity: scene.topScrim }} />
          ) : null}
          {tall ? <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 45%, ${SCENE_FIXED.fade} 100%)`, opacity: 0.7 }} /> : null}
        </>
      )}
    </div>
  )
}
