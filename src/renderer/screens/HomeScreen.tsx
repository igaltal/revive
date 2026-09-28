import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import type { Appearance, WidgetId } from '@shared/appearance'
import type { Vitals } from '@shared/vitals'
import { useT } from '@/i18n/useT'
import { useProjects } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { useClient } from '@/state/client'
import { useAppearance } from '@/state/appearance'
import { AGENT_NAMES, STATUS_DOT, STATUS_TEXT, tileStatus, useAllSessions, useVitals, type LiveSession, type TileStatusKind } from '@/state/live'
import { transport } from '@/transport'
import { useOverlay } from '@/state/overlay'
import { tileLook } from '@/theme/tiles'
import { AgentProblem, type AgentProblemInfo } from '@/components/AgentProblem'
import { BrushIcon, ChipIcon, LockIcon, SendIcon, SparkIcon, TerminalIcon, UptimeIcon } from '@/components/icons'
import { useNarrow } from '@/components/media'
import { cx } from '@/components/cx'
import { localized } from '@/components/ProjectCard'
import type { Route } from '@/components/Sidebar'

type Agent = 'claude' | 'codex' | 'shell'

export interface HomeProps {
  onOpenProject: (id: string) => void
  onOpenTerminal: (projectId: string, sessionId: string) => void
  onCustomize: () => void
  onNavigate: (route: Route) => void
}

// ---------- time ----------

/** The time now, updated on the second or the minute. */
export function useClockNow(seconds: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const step = seconds ? 1000 : 60_000
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      t = setTimeout(tick, step - (Date.now() % step) + 5)
    }
    t = setTimeout(tick, step - (Date.now() % step) + 5)
    return () => clearTimeout(t)
  }, [seconds])
  return now
}

export function formatClock(now: Date, lang: string, clock: Appearance['clock']): string {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: clock.seconds ? '2-digit' : undefined,
    hour12: clock.hours === '12'
  }).format(now)
}

export function formatDate(now: Date, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
}

export function Clock({ size }: { size: 'large' | 'phone' | 'huge' }): ReactNode {
  const { lang } = useT()
  const { look } = useAppearance()
  const now = useClockNow(look.clock.seconds)
  return (
    <div className="flex flex-col gap-1" data-testid="home-clock">
      <div className={cx('scene-text font-sans leading-none font-light tracking-[-0.02em]', size === 'large' ? 'text-[92px]' : size === 'huge' ? 'text-[min(22vw,180px)]' : 'text-[64px]')}>
        <bdi>{formatClock(now, lang, look.clock)}</bdi>
      </div>
      {look.clock.date ? <div className={cx('scene-text opacity-90', size === 'phone' ? 'text-base' : 'text-xl')}>{formatDate(now, lang)}</div> : null}
    </div>
  )
}

// ---------- header ----------

function Pill({ children, testId }: { children: ReactNode; testId?: string }): ReactNode {
  return (
    <div data-testid={testId} className="glass flex h-11 items-center gap-2 rounded-full px-4 text-sm text-ink max-[639px]:h-[34px] max-[639px]:px-3 max-[639px]:text-xs">
      {children}
    </div>
  )
}

function ConnectionPills({ vitals, phone }: { vitals: Vitals | null; phone?: boolean }): ReactNode {
  const { tx } = useT()
  const client = useClient()
  const { mode, theme } = useAppearance()
  // Paper's sidebar (a top bar on phones) already names the Host and its state.
  if (theme === 'paper' && client.host) return null
  const state = client.state === 'open' || !client.host ? 'open' : client.state === 'rejected' ? 'rejected' : 'reconnecting'
  const where = client.host?.name ?? vitals?.machine.name ?? null
  return (
    <>
      <Pill testId="home-connection">
        <span className={cx('size-[9px] shrink-0 rounded-full', state === 'open' ? 'bg-running shadow-[0_0_10px_var(--color-running)]' : state === 'rejected' ? 'bg-broken' : 'animate-pulse bg-attention')} aria-hidden />
        {mode === 'local' ? (
          tx('home.pill.thisComputer')
        ) : where ? (
          // The computer's name (isolated, so an English name stays whole in Hebrew), then the state.
          <span className="flex min-w-0 items-center gap-1.5">
            <bdi className="truncate">{where}</bdi>
            <span className="shrink-0 text-muted">{tx(`home.pill.${state}`)}</span>
          </span>
        ) : (
          tx(`home.pill.${state}`)
        )}
      </Pill>
      {!phone && vitals && (vitals.tailscale === 'on' || vitals.tailscale === 'serving') ? (
        <Pill testId="home-tailscale">
          <LockIcon width={15} height={15} />
          {tx('home.pill.tailscale')}
        </Pill>
      ) : null}
    </>
  )
}

function RoundButton({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string }): ReactNode {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} data-testid={testId} className="glass flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-ink/10">
      {children}
    </button>
  )
}

// ---------- command bar ----------

const AGENTS: Agent[] = ['claude', 'codex', 'shell']

/**
 * Pick a project and an agent, and that session opens. (Understanding free
 * text is a later milestone: here the text only finds the project.)
 */
function CommandBar({ projects, onOpenTerminal, compact }: { projects: Project[]; onOpenTerminal: HomeProps['onOpenTerminal']; compact?: boolean }): ReactNode {
  const { t, tx } = useT()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Project | null>(null)
  const [agent, setAgent] = useState<Agent>('claude')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<AgentProblemInfo | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const listId = useId()
  const q = query.trim().toLowerCase()
  const matches = q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : projects
  // The list draws over the page: it goes through the overlay, like every menu.
  const listShown = useOverlay(open && matches.length > 0)
  const target = picked ?? (matches.length === 1 ? matches[0]! : (projects.find((p) => p.name.toLowerCase() === q || p.id.toLowerCase() === q) ?? null))

  const choose = (p: Project) => {
    setPicked(p)
    setQuery(p.name)
    setOpen(false)
    setHint(null)
  }
  const go = async () => {
    if (!target) {
      setHint(t('home.command.pickFirst'))
      setOpen(true)
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const r = await transport.invoke('sessions:open', { projectId: target.id, kind: agent })
      if (r.ok) onOpenTerminal(target.id, r.sessionId)
      else setProblem({ kind: r.kind, problem: r.problem })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="command-bar" className={cx('glass flex w-full flex-col gap-3 rounded-[26px] p-[18px] pb-3.5', compact ? 'rounded-[20px] p-3' : 'max-w-[860px] self-center')}>
      <div className="relative">
        <form
          className="panel-shadow flex h-[60px] items-center gap-3 rounded-[18px] bg-field ps-[18px] pe-2 text-field-ink max-[639px]:h-[52px]"
          onSubmit={(e) => {
            e.preventDefault()
            void go()
          }}
        >
          <SparkIcon width={22} height={22} className="shrink-0 text-accent-fill" />
          <label htmlFor={`${listId}-input`} className="sr-only">
            {t('home.command.label')}
          </label>
          <input
            id={`${listId}-input`}
            data-testid="command-input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            placeholder={compact ? t('home.command.placeholderShort') : t('home.command.placeholder', { example: projects[0]?.name ?? 'trail-map' })}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQuery(e.target.value)
              setPicked(null)
              setOpen(true)
              setHint(null)
            }}
            className="h-11 min-w-0 flex-1 border-none bg-transparent text-[17px] text-field-ink outline-none placeholder:text-field-muted max-[639px]:text-[15px]"
          />
          <button
            type="submit"
            data-testid="command-go"
            aria-label={t('home.command.go')}
            disabled={busy}
            className="flex size-[46px] shrink-0 items-center justify-center rounded-[14px] bg-accent-fill text-on-accent shadow-[0_6px_18px_color-mix(in_oklab,var(--color-accent-fill)_45%,transparent)] disabled:opacity-60"
          >
            <SendIcon width={20} height={20} strokeWidth={2.2} />
          </button>
        </form>
        {listShown ? (
          <ul id={listId} role="listbox" data-testid="command-list" className="glass absolute start-0 end-0 top-[calc(100%+8px)] z-30 max-h-72 overflow-y-auto rounded-[16px] p-1.5">
            {matches.slice(0, 12).map((p) => (
              <li key={p.id} role="option" aria-selected={picked?.id === p.id}>
                <button
                  type="button"
                  data-testid="command-option"
                  data-project={p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                  className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-start text-[15px] text-ink hover:bg-ink/10"
                >
                  <TileIcon projectId={p.id} size={28} />
                  <bdi className="font-medium">{p.name}</bdi>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1.5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('home.command.agent')}>
          {AGENTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={agent === a}
              data-testid={`agent-${a}`}
              onClick={() => setAgent(a)}
              className={cx('h-[34px] rounded-full border px-3.5 text-[13px] text-ink', agent === a ? 'border-accent-fill/80 bg-accent-fill/30' : 'border-ink/15 bg-subtle hover:bg-ink/10')}
            >
              <bdi>{a === 'shell' ? t('home.command.terminal') : AGENT_NAMES[a]}</bdi>
            </button>
          ))}
        </div>
        <span className="text-sm text-muted max-[639px]:hidden">{hint ?? tx('home.command.hint')}</span>
      </div>
      {hint ? (
        <p className="px-1.5 text-sm text-attention min-[640px]:hidden" data-testid="command-hint">
          {hint}
        </p>
      ) : null}
      {problem ? <AgentProblem info={problem} onDismiss={() => setProblem(null)} /> : null}
    </section>
  )
}

// ---------- project tiles ----------

export function TileIcon({ projectId, size, choice }: { projectId: string; size: number; choice?: Appearance['tiles'][string] }): ReactNode {
  const { look } = useAppearance()
  const tile = tileLook(projectId, choice ?? look.tiles[projectId])
  return (
    <span
      aria-hidden
      data-icon={tile.iconIndex}
      data-color={tile.colorIndex}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.29, background: tile.background, color: tile.glyph, boxShadow: `inset 0 1px 0 color-mix(in oklab, ${tile.glyph} 35%, transparent), 0 8px 20px ${tile.shadow}` }}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d={tile.icon} />
      </svg>
    </span>
  )
}

const DENSITY = {
  compact: { icon: 44, cols: 'grid-cols-10', pad: 'px-2 pt-3 pb-2.5', name: 'text-sm' },
  comfortable: { icon: 56, cols: 'grid-cols-8', pad: 'px-2.5 pt-[18px] pb-3.5', name: 'text-base' },
  large: { icon: 68, cols: 'grid-cols-6', pad: 'px-3 pt-5 pb-4', name: 'text-lg' }
} as const

/** Pinned projects first, then the rest in the folder's order. */
export function orderedProjects(projects: Project[], tiles: Appearance['tiles']): Project[] {
  return [...projects.filter((p) => tiles[p.id]?.pinned), ...projects.filter((p) => !tiles[p.id]?.pinned)]
}

function Tiles({ projects, sessions, onOpenProject, phone }: { projects: Project[]; sessions: LiveSession[]; onOpenProject: (id: string) => void; phone?: boolean }): ReactNode {
  const { tx, lang } = useT()
  const { runs } = useRuntime()
  const { look } = useAppearance()
  const d = DENSITY[look.density]
  const list = orderedProjects(projects, look.tiles)
  return (
    <section data-testid="home-tiles" className={cx('grid gap-3.5', phone ? 'grid-cols-4 gap-2' : cx(d.cols, 'max-[1100px]:grid-cols-6 max-[860px]:grid-cols-4'))}>
      {(phone ? list.slice(0, 4) : list).map((p) => {
        const status = tileStatus(p, runs[p.id], sessions)
        return (
          <button
            key={p.id}
            type="button"
            data-testid="home-tile"
            data-project={p.id}
            data-status={status.kind}
            onClick={() => onOpenProject(p.id)}
            className={cx('glass flex min-w-0 flex-col items-center gap-1.5 text-center text-ink', phone ? 'rounded-[16px] px-1 pt-3 pb-2.5' : cx('rounded-[20px]', d.pad))}
          >
            <span className={phone ? '' : 'mb-1'}>
              <TileIcon projectId={p.id} size={phone ? 44 : d.icon} />
            </span>
            <bdi className={cx('w-full truncate font-semibold', phone ? 'text-[11px]' : d.name)}>{p.name}</bdi>
            {phone ? (
              <span className={cx('size-[7px] rounded-full', STATUS_DOT[status.kind])} aria-label={String(tx(status.key, status.values))} />
            ) : (
              <>
                <span className="line-clamp-1 w-full text-xs text-muted">{localized(p.description, lang)}</span>
                <span className={cx('mt-0.5 flex max-w-full items-center gap-1.5 text-xs', STATUS_TEXT[status.kind])}>
                  <span className={cx('size-2 shrink-0 rounded-full', STATUS_DOT[status.kind])} aria-hidden />
                  <span className="truncate">{tx(status.key, status.values)}</span>
                </span>
              </>
            )}
          </button>
        )
      })}
    </section>
  )
}

// ---------- vitals, agents and services, uptime ----------

function PanelTitle({ icon, children, aside }: { icon: ReactNode; children: ReactNode; aside?: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink/10 pb-2.5">
      <span className="flex min-w-0 items-center gap-2.5 text-base font-medium text-ink">
        {icon}
        <span className="truncate">{children}</span>
      </span>
      {aside}
    </div>
  )
}

const GAUGES = [
  { id: 'cpu', key: 'home.vitals.cpu', stroke: 'stroke-gauge-cpu', bar: 'bg-gauge-cpu' },
  { id: 'memory', key: 'home.vitals.memory', stroke: 'stroke-gauge-memory', bar: 'bg-gauge-memory' },
  { id: 'disk', key: 'home.vitals.disk', stroke: 'stroke-gauge-disk', bar: 'bg-gauge-disk' },
  { id: 'temperature', key: 'home.vitals.temperature', stroke: 'stroke-gauge-temperature', bar: 'bg-gauge-temperature' }
] as const

function gaugeValues(v: Vitals | null) {
  return GAUGES.filter((g) => g.id !== 'temperature' || v?.temperature != null).map((g) => {
    const value = v ? (g.id === 'temperature' ? (v.temperature ?? 0) : v[g.id]) : null
    const fraction = value === null ? 0 : g.id === 'temperature' ? Math.min(1, value / 100) : Math.min(1, value / 100)
    const text = value === null ? '–' : g.id === 'temperature' ? `${Math.round(value)}°C` : `${Math.round(value)}%`
    return { ...g, fraction, text }
  })
}

function Gauge({ label, text, fraction, stroke }: { label: ReactNode; text: string; fraction: number; stroke: string }): ReactNode {
  const C = 2 * Math.PI * 44
  return (
    <div className="relative size-[104px] justify-self-center" data-testid="vitals-gauge">
      <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden>
        <circle cx="52" cy="52" r="44" fill="none" strokeWidth="6" className="stroke-ink/10" />
        <circle cx="52" cy="52" r="44" fill="none" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 52 52)" strokeDasharray={`${(C * fraction).toFixed(1)} ${C.toFixed(1)}`} className={cx(stroke, 'transition-[stroke-dasharray] duration-700')} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-[22px] font-medium text-ink">
          <bdi>{text}</bdi>
        </span>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)} GB`
}

function VitalsPanel({ vitals }: { vitals: Vitals | null }): ReactNode {
  const { tx } = useT()
  const gauges = gaugeValues(vitals)
  return (
    <div data-testid="home-vitals" className="glass flex flex-col gap-3.5 rounded-[22px] px-[22px] py-[18px]">
      <PanelTitle
        icon={<ChipIcon width={18} height={18} />}
        aside={vitals && vitals.machine.cores ? <span className="font-mono text-xs text-muted" dir="ltr">{`${vitals.machine.cores} cores · ${formatBytes(vitals.machine.memoryBytes)}`}</span> : null}
      >
        <bdi>{vitals?.machine.name ?? tx('home.vitals.title')}</bdi>
      </PanelTitle>
      <div className={cx('grid gap-2', gauges.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {gauges.map((g) => (
          <Gauge key={g.id} label={tx(g.key)} text={g.text} fraction={g.fraction} stroke={g.stroke} />
        ))}
      </div>
    </div>
  )
}

interface LiveItem {
  id: string
  name: string
  note: ReactNode
  kind: TileStatusKind
}

function useLiveItems(projects: Project[], sessions: LiveSession[], vitals: Vitals | null): LiveItem[] {
  const { tx } = useT()
  const { runs } = useRuntime()
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  const items: LiveItem[] = []
  for (const s of sessions) {
    if (s.kind !== 'claude' && s.kind !== 'codex') continue
    items.push({ id: s.sessionId, name: AGENT_NAMES[s.kind], note: tx('home.live.on', { project: nameOf(s.projectId) }), kind: 'working' })
  }
  for (const r of Object.values(runs)) {
    if (r.status === 'running') items.push({ id: `run-${r.projectId}`, name: nameOf(r.projectId), note: r.port ? tx('home.status.runningOn', { port: r.port }) : tx('vocab.runningNow'), kind: 'working' })
    else if (r.status === 'broken') items.push({ id: `run-${r.projectId}`, name: nameOf(r.projectId), note: tx('vocab.needsFixing'), kind: 'failed' })
  }
  if (vitals) {
    if (vitals.ollama.state !== 'missing')
      items.push({
        id: 'ollama',
        name: 'Ollama',
        note: vitals.ollama.state === 'running' ? (vitals.ollama.models.length ? tx('home.live.loaded', { model: vitals.ollama.models[0] }) : tx('home.live.ready')) : tx('home.live.stopped'),
        kind: vitals.ollama.state === 'running' ? 'working' : 'idle'
      })
    if (vitals.devicesOnline !== null) items.push({ id: 'host', name: 'Revive Host', note: tx('home.live.devices', { count: vitals.devicesOnline }), kind: 'working' })
    if (vitals.tailscale !== 'missing')
      items.push({ id: 'tailscale', name: 'Tailscale', note: tx(`home.live.tailscale.${vitals.tailscale}`), kind: vitals.tailscale === 'off' ? 'failed' : 'working' })
  }
  return items
}

function AgentsPanel({ items }: { items: LiveItem[] }): ReactNode {
  const { tx } = useT()
  return (
    <div data-testid="home-agents" className="glass flex flex-col gap-2.5 rounded-[22px] px-[22px] py-[18px]">
      <PanelTitle icon={<TerminalIcon width={18} height={18} />}>{tx('home.live.title')}</PanelTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{tx('home.live.none')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-[11px]">
          {items.slice(0, 8).map((l) => (
            <div key={l.id} className="flex min-w-0 items-center gap-2.5 text-sm" data-testid="home-live-item" data-kind={l.kind}>
              <span className={cx('size-2.5 shrink-0 rounded-full', STATUS_DOT[l.kind])} aria-hidden />
              <span className="truncate text-ink">
                <bdi>{l.name}</bdi> <span className="text-muted">{l.note}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function formatUptime(seconds: number, lang: string): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const fmt = (n: number, unit: 'day' | 'hour' | 'minute') => new Intl.NumberFormat(lang === 'he' ? 'he' : 'en', { style: 'unit', unit, unitDisplay: 'long' }).format(n)
  if (days > 0) return fmt(days, 'day')
  if (hours > 0) return fmt(hours, 'hour')
  return fmt(Math.floor(seconds / 60), 'minute')
}

function sparkline(history: number[]): { line: string; area: string } | null {
  if (history.length < 2) return null
  const step = 200 / (history.length - 1)
  const pts = history.map((v, i) => [i * step, 66 - (Math.min(100, Math.max(0, v)) / 100) * 60] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return { line, area: `${line} L200 70 L0 70 Z` }
}

function UptimePanel({ vitals }: { vitals: Vitals | null }): ReactNode {
  const { tx, lang } = useT()
  const spark = sparkline(vitals?.cpuHistory ?? [])
  const gid = useId()
  return (
    <div data-testid="home-uptime" className="glass flex flex-col gap-2.5 overflow-hidden rounded-[22px] px-5 py-[18px]">
      <PanelTitle icon={<UptimeIcon width={18} height={18} />}>{tx('home.uptime.title')}</PanelTitle>
      <span className="text-[34px] leading-none font-medium text-ink">{vitals ? formatUptime(vitals.uptimeSeconds, lang) : '–'}</span>
      <svg viewBox="0 0 200 70" className="h-[70px] w-full text-gauge-cpu" preserveAspectRatio="none" aria-label={String(tx('home.uptime.cpu'))} role="img">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {spark ? (
          <>
            <path d={spark.area} fill={`url(#${gid})`} />
            <path d={spark.line} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
    </div>
  )
}

/** Phone: CPU, memory, disk and uptime as four small bars. */
function StatsBar({ vitals, withUptime }: { vitals: Vitals | null; withUptime: boolean }): ReactNode {
  const { tx, lang } = useT()
  const gauges = gaugeValues(vitals).filter((g) => g.id !== 'temperature')
  const cells = [
    ...gauges.map((g) => ({ id: g.id, label: tx(g.key), text: g.text, pct: g.fraction, bar: g.bar })),
    ...(withUptime ? [{ id: 'uptime', label: tx('home.uptime.short'), text: vitals ? formatUptime(vitals.uptimeSeconds, lang) : '–', pct: 1, bar: 'bg-gauge-temperature' }] : [])
  ]
  return (
    <section data-testid="home-stats" className={cx('glass grid gap-1.5 rounded-[20px] px-4 py-3.5', cells.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
      {cells.map((c) => (
        <div key={c.id} className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] text-muted">{c.label}</span>
          <span className="truncate text-lg font-medium text-ink">
            <bdi>{c.text}</bdi>
          </span>
          <div className="h-1 rounded-sm bg-ink/10">
            <div className={cx('h-1 rounded-sm', c.bar)} style={{ width: `${Math.round(c.pct * 100)}%` }} />
          </div>
        </div>
      ))}
    </section>
  )
}

/** Phone, first: what needs you (a project that stopped working), with the one button that helps. */
function Attention({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (id: string) => void }): ReactNode {
  const { tx } = useT()
  const { runs } = useRuntime()
  const broken = projects.find((p) => runs[p.id]?.status === 'broken')
  if (!broken) return null
  return (
    <section data-testid="home-attention" className="glass flex flex-col gap-2.5 rounded-[20px] border-broken/40 p-3.5">
      <div className="flex items-center gap-2.5">
        <TileIcon projectId={broken.id} size={40} />
        <div className="flex min-w-0 flex-col">
          <bdi className="truncate text-[15px] font-semibold text-ink">{broken.name}</bdi>
          <span className="text-xs text-broken">{tx('home.attention.failed')}</span>
        </div>
      </div>
      <button type="button" onClick={() => onOpenProject(broken.id)} className="h-11 rounded-[12px] bg-accent-fill text-[15px] font-semibold text-on-accent">
        {tx('home.attention.open')}
      </button>
    </section>
  )
}

// ---------- the screen ----------

const BOTTOM: WidgetId[] = ['vitals', 'agents', 'uptime']
const SPAN: Record<string, string> = { vitals: 'col-span-2', agents: 'col-span-2', uptime: 'col-span-1' }

/** The widgets to show, in the user's order; vitals, agents and uptime next to each other share a row. */
export function homeBlocks(widgets: Appearance['widgets']): Array<WidgetId | WidgetId[]> {
  const out: Array<WidgetId | WidgetId[]> = []
  for (const w of widgets) {
    if (!w.visible) continue
    const last = out.at(-1)
    if (BOTTOM.includes(w.id) && Array.isArray(last)) last.push(w.id)
    else out.push(BOTTOM.includes(w.id) ? [w.id] : w.id)
  }
  return out
}

/**
 * Home: the clock, the connection, the command bar, the projects with live
 * status, and the Host's health. On a computer, as in the desktop design;
 * on a phone, what needs you comes first.
 */
export function HomeScreen({ onOpenProject, onOpenTerminal, onCustomize }: HomeProps): ReactNode {
  const { t } = useT()
  const { manifest } = useProjects()
  const { look } = useAppearance()
  const narrow = useNarrow()
  const sessions = useAllSessions()
  const blocks = homeBlocks(look.widgets)
  // Home always shows some of the Host's health (the connection pills at least): watching is what makes it sampled.
  const vitals = useVitals()
  const projects = useMemo(() => (manifest?.state === 'ok' ? manifest.manifest.projects : []), [manifest])
  const live = useLiveItems(projects, sessions, vitals)

  const block = (b: WidgetId | WidgetId[]) => {
    if (Array.isArray(b)) {
      if (narrow) {
        return (
          <div key={b.join('-')} className="flex flex-col gap-3">
            {b.includes('vitals') || b.includes('uptime') ? <StatsBar vitals={vitals} withUptime={b.includes('uptime')} /> : null}
            {b.includes('agents') ? <AgentsPanel items={live} /> : null}
          </div>
        )
      }
      const cols = b.reduce((n, id) => n + (id === 'uptime' ? 1 : 2), 0)
      return (
        <section key={b.join('-')} className="grid gap-3.5 max-[1100px]:grid-cols-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {b.map((id) => (
            <div key={id} className={cx(SPAN[id], 'min-w-0 max-[1100px]:col-span-1')}>
              {id === 'vitals' ? <VitalsPanel vitals={vitals} /> : id === 'agents' ? <AgentsPanel items={live} /> : <UptimePanel vitals={vitals} />}
            </div>
          ))}
        </section>
      )
    }
    if (b === 'command') return <CommandBar key={b} projects={projects} onOpenTerminal={onOpenTerminal} compact={narrow} />
    return <Tiles key={b} projects={projects} sessions={sessions} onOpenProject={onOpenProject} phone={narrow} />
  }

  if (narrow) {
    return (
      <div data-testid="home" data-layout="phone" className="flex min-h-full flex-col gap-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ConnectionPills vitals={vitals} phone />
          </div>
          <RoundButton label={t('home.customize')} onClick={onCustomize} testId="home-customize">
            <BrushIcon width={18} height={18} />
          </RoundButton>
        </div>
        <div className="mt-1">
          <Clock size="phone" />
        </div>
        <div className="min-h-6 flex-1" />
        <Attention projects={projects} onOpenProject={onOpenProject} />
        {blocks.map(block)}
      </div>
    )
  }

  return (
    <div data-testid="home" data-layout="desktop" className="flex min-h-full flex-col px-5 pt-4 pb-2">
      <header className="flex min-h-[130px] items-start justify-between gap-6">
        <Clock size="large" />
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1.5">
          <ConnectionPills vitals={vitals} />
          <RoundButton label={t('home.customize')} onClick={onCustomize} testId="home-customize">
            <BrushIcon width={19} height={19} />
          </RoundButton>
        </div>
      </header>
      <div className="max-h-[140px] min-h-6 flex-1" />
      {blocks.flatMap((b, i) => [
        block(b),
        // Below the command bar the page breathes (as in the design); elsewhere a steady gap.
        i < blocks.length - 1 ? <div key={`gap-${i}`} aria-hidden className={b === 'command' ? 'min-h-6 flex-1' : 'h-5 shrink-0'} /> : null
      ])}
    </div>
  )
}
