/**
 * The scene's subtle motion (water shimmer, twinkling stars): a few frames a
 * second, never while the page is hidden, and none at all when the system
 * or the user asks for less motion.
 */

export type MotionSetting = 'full' | 'reduced' | 'off'

/** Frames per second; 0 means no motion. */
export function motionFps(setting: MotionSetting, systemReduced: boolean): number {
  if (setting === 'off' || systemReduced) return 0
  return setting === 'reduced' ? 2 : 8
}

export interface MotionEnv {
  /** Whether the page can be seen right now. */
  visible(): boolean
  onVisibilityChange(cb: () => void): () => void
  every(ms: number, fn: () => void): () => void
  now(): number
}

export function browserMotionEnv(): MotionEnv {
  return {
    visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    onVisibilityChange: (cb) => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    every: (ms, fn) => {
      const t = setInterval(fn, ms)
      return () => clearInterval(t)
    },
    now: () => performance.now()
  }
}

/**
 * Calls `frame(seconds)` `fps` times a second while the page is visible.
 * Returns a stop function. With fps 0 nothing ever runs.
 */
export function runMotion(fps: number, env: MotionEnv, frame: (seconds: number) => void): () => void {
  if (fps <= 0) return () => {}
  let stopTimer: (() => void) | null = null
  const start = env.now()
  const sync = () => {
    if (env.visible() && !stopTimer) stopTimer = env.every(1000 / fps, () => frame((env.now() - start) / 1000))
    else if (!env.visible() && stopTimer) {
      stopTimer()
      stopTimer = null
    }
  }
  const offVisibility = env.onVisibilityChange(sync)
  sync()
  return () => {
    offVisibility()
    stopTimer?.()
    stopTimer = null
  }
}

/** Star twinkle for group `i` (0 to 2) at time `t`: a slow wave between 0.45 and 1. */
export function twinkle(i: number, t: number): number {
  return 0.725 + 0.275 * Math.sin(t * (0.9 + i * 0.37) + i * 2.1)
}

/** How far the water's highlights drift at time `t` (world units). */
export function shimmer(t: number): { dx: number; opacity: number } {
  return { dx: Math.sin(t * 0.6) * 14, opacity: 0.1 + 0.05 * Math.sin(t * 1.3) }
}

/** Whether the system asks for reduced motion. */
export function systemReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
