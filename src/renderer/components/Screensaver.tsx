import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Appearance } from '@shared/appearance'
import type { Project } from '@shared/manifest'
import type { StateEvent } from '@shared/runtime'
import { stripAnsi } from '@shared/ansi'
import { useT } from '@/i18n/useT'
import { transport } from '@/transport'
import { useOverlay } from '@/state/overlay'
import { accentColor, useAppearance } from '@/state/appearance'
import { useProjects } from '@/state/projects'
import { AGENT_NAMES, useAllSessions } from '@/state/live'
import { buildScene } from '@/theme/scene'
import { BURN_IN_STEP_MS, burnInOffset, SAVER, themeVars } from '@/theme/tokens'
import { SceneSvg, useSceneMotion } from './SceneBackdrop'
import { Clock } from '@/screens/HomeScreen'
import { cx } from './cx'

export interface SaverAlert {
  kind: 'waiting' | 'failed' | 'finished'
  /** An i18n key and its values: one line naming who needs you. */
  key: string
  values: Record<string, string>
}

/**
 * Which events wake the screensaver, and the one line it shows. A run that
 * fails, an agent that stops with an error, or (when asked for) an agent
 * that finishes. Waiting for approval arrives with the approval queue (H5).
 */
export function saverAlertFor(e: StateEvent, projects: Project[], wake: Appearance['screensaver']['wake']): SaverAlert | null {
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  if (e.type === 'status.changed' && e.state.status === 'broken' && wake.failed) return { kind: 'failed', key: 'saver.alert.runFailed', values: { project: name(e.state.projectId) } }
  if (e.type === 'process.exited' && (e.session.kind === 'claude' || e.session.kind === 'codex')) {
    const agent = AGENT_NAMES[e.session.kind]
    const failed = e.exitCode !== 0 && e.exitCode !== null
    if (failed && wake.failed) return { kind: 'failed', key: 'saver.alert.agentFailed', values: { agent, project: name(e.session.projectId) } }
    if (!failed && wake.finished) return { kind: 'finished', key: 'saver.alert.agentFinished', values: { agent, project: name(e.session.projectId) } }
  }
  return null
}

/** Idle for `minutes` (0: never). Any key, click, touch or real mouse movement counts as activity. */
export function useIdle(minutes: number): [boolean, () => void] {
  const [idle, setIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wakeRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (minutes <= 0) return
    const arm = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setIdle(true), minutes * 60_000)
    }
    let lastX = -1
    let lastY = -1
    const activity = (e: Event) => {
      // A mouse resting on the desk can report tiny moves; only a real movement counts.
      if (e instanceof MouseEvent && e.type === 'mousemove') {
        const moved = lastX < 0 || Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 8
        lastX = e.clientX
        lastY = e.clientY
        if (!moved) return
      }
      setIdle(false)
      arm()
    }
    wakeRef.current = () => {
      setIdle(false)
      arm()
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown']
    for (const ev of events) window.addEventListener(ev, activity, { passive: true, capture: true })
    arm()
    return () => {
      for (const ev of events) window.removeEventListener(ev, activity, { capture: true })
      if (timer.current) clearTimeout(timer.current)
      wakeRef.current = () => {}
    }
  }, [minutes])
  return [idle && minutes > 0, () => wakeRef.current()]
}

/** Shows `photos` one after another, slowly. */
function PhotoShow({ urls }: { urls: string[] }): ReactNode {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (urls.length < 2) return
    const t = setInterval(() => setI((n) => (n + 1) % urls.length), 20_000)
    return () => clearInterval(t)
  }, [urls.length])
  return (
    <>
      {urls.map((u, n) => (
        <div key={u} className={cx('absolute inset-0 bg-cover bg-center transition-opacity duration-[2500ms]', n === i ? 'opacity-100' : 'opacity-0')} style={{ backgroundImage: `url("${u}")` }} />
      ))}
    </>
  )
}

/** The last line each agent printed, kept while the screensaver is up. */
function useAgentLines(active: boolean): Array<{ sessionId: string; label: string; line: string }> {
  const sessions = useAllSessions()
  const { manifest } = useProjects()
  const [lines, setLines] = useState<Record<string, string>>({})
  const agents = useMemo(() => sessions.filter((s) => s.kind === 'claude' || s.kind === 'codex'), [sessions])
  useEffect(() => {
    if (!active) return
    const offs = agents.map((s) =>
      transport.subscribe(
        'session:output',
        (chunk) => {
          const last = stripAnsi(chunk.data)
            .split(/\r?\n|\r/)
            .map((l) => l.trim())
            .filter(Boolean)
            .at(-1)
          if (last) setLines((cur) => ({ ...cur, [s.sessionId]: last.slice(0, 140) }))
        },
        { sessionId: s.sessionId, fromOffset: 0 }
      )
    )
    return () => offs.forEach((off) => off())
  }, [active, agents])
  const projects = manifest?.state === 'ok' ? manifest.manifest.projects : []
  return agents.map((s) => ({
    sessionId: s.sessionId,
    label: `${AGENT_NAMES[s.kind as 'claude' | 'codex']} · ${projects.find((p) => p.id === s.projectId)?.name ?? s.projectId}`,
    line: lines[s.sessionId] ?? ''
  }))
}

/**
 * After a while without use, the screen becomes a screensaver: the scene
 * and a clock, what agents are doing, photos, or nearly black. It wakes
 * gently when something needs you: a glow in the status color and one line.
 */
export function Screensaver(): ReactNode {
  const { look } = useAppearance()
  const [idle, wake] = useIdle(look.screensaver.idleMinutes)
  return idle ? <SaverView onExit={wake} /> : null
}

export function SaverView({ onExit, mode: forced }: { onExit: () => void; mode?: Appearance['screensaver']['mode'] }): ReactNode {
  const { t, tx } = useT()
  const { look, sky, photoUrl } = useAppearance()
  const { manifest } = useProjects()
  const mode = forced ?? look.screensaver.mode
  const [alert, setAlert] = useState<SaverAlert | null>(null)
  const [step, setStep] = useState(0)
  const [size] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const scene = useMemo(() => buildScene(sky, size.width, size.height), [sky, size])
  const svg = useRef<SVGSVGElement>(null)
  useSceneMotion(mode === 'dark' ? 'off' : look.motion, svg)
  const lines = useAgentLines(mode === 'activity')
  const projects = useMemo(() => (manifest?.state === 'ok' ? manifest.manifest.projects : []), [manifest])
  const wake = look.screensaver.wake

  useEffect(() => {
    const off = transport.subscribe('runtime:event', (e) => {
      const a = saverAlertFor(e, projects, wake)
      if (a) setAlert(a)
    })
    return off
  }, [projects, wake])

  // Burn-in: move everything a few pixels every few minutes.
  useEffect(() => {
    const t = setInterval(() => setStep((n) => n + 1), BURN_IN_STEP_MS)
    return () => clearInterval(t)
  }, [])
  const shift = burnInOffset(step)
  const photos = look.photos.map((p) => photoUrl(p.id))
  const glow = alert ? SAVER.glow[alert.kind] : null
  // Over everything, the native preview included.
  const ready = useOverlay(true)
  const scenic = useMemo(
    () => themeVars({ theme: 'scenic', glass: look.glass, accent: accentColor(look.accent), backdrop: { scene: sky } }) as React.CSSProperties,
    [look.glass, look.accent, sky]
  )

  if (!ready) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('saver.label')}
      data-testid="screensaver"
      data-mode={mode}
      data-alert={alert?.kind ?? ''}
      className="fixed inset-0 z-[60] cursor-none overflow-hidden"
      // Always Scenic inside: the screensaver shows the scene (or black) in either theme.
      data-theme="scenic"
      style={{ ...scenic, backgroundColor: SAVER.dark, boxShadow: glow ? `inset 0 0 160px 24px ${glow}` : undefined }}
      onPointerDown={onExit}
      onKeyDown={onExit}
    >
      {mode === 'photos' && photos.length > 0 ? <PhotoShow urls={photos} /> : mode !== 'dark' ? <SceneSvg scene={scene} svgRef={svg} /> : null}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }} data-testid="saver-content" data-shift={`${shift.x},${shift.y}`}>
        {alert ? (
          <p data-testid="screensaver-alert" className="rounded-full px-5 py-2 text-lg" style={{ color: SAVER.ink, backgroundColor: SAVER.chip, boxShadow: `0 0 40px ${glow}` }}>
            {tx(alert.key, alert.values)}
          </p>
        ) : null}
        <div style={mode === 'dark' ? { color: SAVER.darkInk } : undefined} className={mode === 'dark' ? '[&_.scene-text]:text-inherit [&_.scene-text]:[text-shadow:none]' : ''}>
          <Clock size="huge" />
        </div>
        {mode === 'photos' && photos.length === 0 ? <p className="scene-text text-base">{tx('saver.noPhotos')}</p> : null}
      </div>
      {mode === 'activity' ? (
        <div className="absolute start-6 end-6 bottom-6 flex flex-col gap-2" data-testid="saver-activity">
          {lines.length === 0 ? (
            <p className="scene-text text-base">{tx('saver.noAgents')}</p>
          ) : (
            lines.map((l) => (
              <p key={l.sessionId} className="glass truncate rounded-[14px] px-4 py-2 text-sm text-ink">
                <bdi className="font-medium">{l.label}</bdi> <span className="font-mono text-muted" dir="ltr">{l.line || '…'}</span>
              </p>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
