import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ACCENT_NAMES,
  IDLE_MINUTES,
  resetSection,
  WIDGET_IDS,
  type AppearancePatch,
  type AppearanceSection,
  type TileChoice
} from '@shared/appearance'
import { CITIES } from '@shared/cities'
import { useT } from '@/i18n/useT'
import { useAppearance, deviceTimeZone, resolveTheme } from '@/state/appearance'
import { useProjects } from '@/state/projects'
import { PageHeader } from '@/components/PageHeader'
import { OptionCards } from '@/components/OptionCards'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Switch } from '@/components/host'
import { SceneSvg } from '@/components/SceneBackdrop'
import { SaverView } from '@/components/Screensaver'
import { ArrowDownIcon, ArrowUpIcon, PinIcon } from '@/components/icons'
import { cx } from '@/components/cx'
import { TileIcon } from '@/screens/HomeScreen'
import { buildScene, SCENE_KINDS, type SceneKind } from '@/theme/scene'
import { ACCENT_PRESETS } from '@/theme/tokens'
import { TILE_COLORS, TILE_ICONS, tileLook } from '@/theme/tiles'
import { preparePhoto } from '@/theme/photo'
import { systemReducedMotion } from '@/theme/motion'
import { cityForTimeZone } from '@shared/cities'

function Section({ id, title, hint, children, onReset }: { id: AppearanceSection; title: ReactNode; hint?: ReactNode; children: ReactNode; onReset: () => void }): ReactNode {
  const { tx } = useT()
  return (
    <section data-testid={`customize-${id}`} className="flex flex-col gap-3 border-t border-border py-7 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl text-ink">{title}</h2>
          {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
        </div>
        <button type="button" data-testid={`reset-${id}`} onClick={onReset} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
          {tx('customize.reset')}
        </button>
      </div>
      {children}
    </section>
  )
}

/** A small picture of a scene, to choose it by sight. */
function SceneThumb({ kind }: { kind: SceneKind }): ReactNode {
  const scene = useMemo(() => buildScene(kind, 1440, 1024), [kind])
  return (
    <span className="relative block h-14 w-full overflow-hidden rounded-[8px]" aria-hidden>
      <SceneSvg scene={scene} />
    </span>
  )
}

function Select<V extends string | number>({ value, options, onChange, label, testId }: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; label: string; testId?: string }): ReactNode {
  return (
    <select
      aria-label={label}
      data-testid={testId}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value)
        if (o) onChange(o.value)
      }}
      className="min-h-[42px] w-full max-w-sm rounded-[10px] border border-border bg-card px-3 text-[15px] text-ink"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * How Revive looks on this device. Every change shows at once, across the
 * whole app, and is kept only after Save.
 */
export function CustomizeScreen({ onDone }: { onDone: () => void }): ReactNode {
  const { t, tx, lang } = useT()
  const { look, editing, preview, save, discard, addPhoto, removePhoto, photoUrl, mode, sky } = useAppearance()
  const { manifest } = useProjects()
  const [saving, setSaving] = useState(false)
  const [photoProblem, setPhotoProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [saverPreview, setSaverPreview] = useState(false)
  const [editingTile, setEditingTile] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const projects = manifest?.state === 'ok' ? manifest.manifest.projects : []
  const set = (patch: AppearancePatch) => preview(patch)
  const reset = (s: AppearanceSection) => preview(resetSection(s))


  const zoneCity = cityForTimeZone(deviceTimeZone())
  const cityName = (c: { en: string; he: string }) => (lang === 'he' ? c.he : c.en)

  const onPhoto = async (f: File | undefined) => {
    if (!f) return
    setPhotoProblem(null)
    try {
      const prepared = await preparePhoto(f)
      const photo = await addPhoto(prepared.jpegBase64, prepared.worst)
      // Shown right away, behind everything; kept after Save.
      set({ background: photo.id, theme: look.theme ?? (resolveTheme(null, mode) === 'paper' ? 'scenic' : null) })
    } catch {
      setPhotoProblem(t('customize.background.problem'))
    }
  }

  const moveWidget = (i: number, by: -1 | 1) => {
    const w = [...look.widgets]
    const j = i + by
    if (j < 0 || j >= w.length) return
    ;[w[i], w[j]] = [w[j]!, w[i]!]
    set({ widgets: w })
  }
  const setTile = (id: string, patch: Partial<TileChoice>) => {
    const cur = look.tiles[id] ?? { icon: null, color: null, pinned: false }
    set({ tiles: { ...look.tiles, [id]: { ...cur, ...patch } } })
  }
  const reduced = systemReducedMotion()
  const custom = look.accent && !(ACCENT_NAMES as readonly string[]).includes(look.accent) ? look.accent : null

  return (
    <div className="max-w-3xl" data-testid="customize">
      <PageHeader
        title={tx('customize.title')}
        subtitle={tx('customize.subtitle')}
        actions={
          <>
            <Button variant="secondary" data-testid="customize-discard" disabled={!editing} onClick={discard}>
              {tx('customize.discard')}
            </Button>
            <Button
              data-testid="customize-save"
              disabled={!editing || saving}
              onClick={() => {
                setSaving(true)
                void save().finally(() => setSaving(false))
              }}
            >
              {tx('customize.save')}
            </Button>
          </>
        }
      />
      {editing ? (
        <p data-testid="customize-unsaved" className="-mt-4 mb-6 text-sm text-attention">
          {tx('customize.unsaved')}
        </p>
      ) : null}

      <Section id="theme" title={tx('customize.theme.title')} hint={tx('customize.theme.hint')} onReset={() => reset('theme')}>
        <OptionCards
          testId="set-theme"
          columns={3}
          label={t('customize.theme.title')}
          value={look.theme ?? 'default'}
          onChange={(v) => set({ theme: v === 'default' ? null : v })}
          options={[
            { value: 'default', label: tx('customize.theme.default'), hint: tx(mode === 'local' ? 'customize.theme.defaultLocal' : 'customize.theme.defaultShared') },
            { value: 'scenic', label: tx('customize.theme.scenic'), hint: tx('customize.theme.scenicHint') },
            { value: 'paper', label: tx('customize.theme.paper'), hint: tx('customize.theme.paperHint') }
          ]}
        />
      </Section>

      <Section id="scene" title={tx('customize.scene.title')} hint={tx('customize.scene.hint', { scene: t(`customize.scene.${sky}`) })} onReset={() => reset('scene')}>
        <OptionCards
          testId="set-scene"
          columns={5}
          label={t('customize.scene.title')}
          value={look.scene}
          onChange={(scene) => set({ scene })}
          options={[
            { value: 'auto', label: tx('customize.scene.auto'), hint: tx('customize.scene.autoHint') },
            ...SCENE_KINDS.map((k) => ({ value: k, label: tx(`customize.scene.${k}`), hint: <SceneThumb kind={k} /> }))
          ]}
        />
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {tx('customize.scene.city')}
          <Select
            testId="set-city"
            label={t('customize.scene.city')}
            value={look.city ?? ''}
            onChange={(v) => set({ city: v || null })}
            options={[{ value: '', label: t('customize.scene.cityAuto', { city: cityName(zoneCity) }) }, ...CITIES.map((c) => ({ value: c.id, label: cityName(c) }))]}
          />
        </label>
      </Section>

      <Section id="background" title={tx('customize.background.title')} hint={tx('customize.background.hint')} onReset={() => reset('background')}>
        <div className="grid grid-cols-3 gap-3 min-[640px]:grid-cols-4" role="radiogroup" aria-label={t('customize.background.title')}>
          <button
            type="button"
            role="radio"
            aria-checked={look.background === null}
            data-testid="background-scene"
            onClick={() => set({ background: null })}
            className={cx('flex h-24 flex-col items-center justify-center gap-1 overflow-hidden rounded-[10px] border text-sm text-ink', look.background === null ? 'border-ink ring-1 ring-ink' : 'border-border')}
          >
            {tx('customize.background.scene')}
          </button>
          {look.photos.map((p) => (
            <div key={p.id} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={look.background === p.id}
                aria-label={t('customize.background.use')}
                data-testid="background-photo"
                onClick={() => set({ background: p.id })}
                className={cx('block h-24 w-full rounded-[10px] border bg-cover bg-center', look.background === p.id ? 'border-ink ring-2 ring-ink' : 'border-border')}
                style={{ backgroundImage: `url("${photoUrl(p.id)}")` }}
              />
              <button type="button" onClick={() => setRemoving(p.id)} className="absolute end-1.5 top-1.5 rounded-full bg-scrim px-2 py-0.5 text-xs text-ink" data-testid="photo-remove">
                {tx('customize.background.remove')}
              </button>
            </div>
          ))}
          <button type="button" data-testid="background-add" onClick={() => file.current?.click()} className="flex h-24 items-center justify-center rounded-[10px] border border-dashed border-border text-sm text-muted hover:text-ink">
            {tx('customize.background.add')}
          </button>
        </div>
        <input ref={file} type="file" accept="image/*" className="hidden" data-testid="background-file" onChange={(e) => void onPhoto(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        {photoProblem ? <p className="text-sm text-broken">{photoProblem}</p> : null}
        <p className="text-[13px] text-muted">{tx('customize.background.note')}</p>
      </Section>

      <Section id="glass" title={tx('customize.glass.title')} hint={tx('customize.glass.hint')} onReset={() => reset('glass')}>
        <OptionCards
          testId="set-glass"
          columns={3}
          label={t('customize.glass.title')}
          value={look.glass}
          onChange={(glass) => set({ glass })}
          options={(['light', 'normal', 'strong'] as const).map((g) => ({ value: g, label: tx(`customize.glass.${g}`) }))}
        />
      </Section>

      <Section id="accent" title={tx('customize.accent.title')} hint={tx('customize.accent.hint')} onReset={() => reset('accent')}>
        <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label={t('customize.accent.title')}>
          <button
            type="button"
            role="radio"
            aria-checked={look.accent === null}
            data-testid="accent-default"
            onClick={() => set({ accent: null })}
            className={cx('min-h-[42px] rounded-full border px-4 text-sm text-ink', look.accent === null ? 'border-ink ring-1 ring-ink' : 'border-border')}
          >
            {tx('customize.accent.default')}
          </button>
          {ACCENT_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={look.accent === name}
              aria-label={t(`customize.accent.${name}`)}
              title={t(`customize.accent.${name}`)}
              data-testid={`accent-${name}`}
              onClick={() => set({ accent: name })}
              className={cx('size-10 rounded-full border-2', look.accent === name ? 'border-ink' : 'border-transparent')}
              style={{ backgroundColor: ACCENT_PRESETS[name] }}
            />
          ))}
          <label className={cx('flex min-h-[42px] cursor-pointer items-center gap-2 rounded-full border px-3 text-sm text-ink', custom ? 'border-ink ring-1 ring-ink' : 'border-border')}>
            <input type="color" data-testid="accent-custom" value={custom ?? ACCENT_PRESETS.blue} onChange={(e) => set({ accent: e.target.value.toLowerCase() })} className="size-7 cursor-pointer rounded-full border-none bg-transparent" />
            {tx('customize.accent.custom')}
          </label>
        </div>
      </Section>

      <Section id="widgets" title={tx('customize.widgets.title')} hint={tx('customize.widgets.hint')} onReset={() => reset('widgets')}>
        <ol className="flex flex-col divide-y divide-border rounded-[12px] border border-border bg-card" data-testid="widget-list">
          {look.widgets.map((w, i) => (
            <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2" data-widget={w.id}>
              <Switch testId={`widget-${w.id}`} checked={w.visible} onChange={(visible) => set({ widgets: look.widgets.map((x) => (x.id === w.id ? { ...x, visible } : x)) })} label={tx(`customize.widgets.${w.id}`)} />
              <span className="flex gap-1">
                <button type="button" aria-label={t('customize.widgets.up')} data-testid={`widget-${w.id}-up`} disabled={i === 0} onClick={() => moveWidget(i, -1)} className="flex size-9 items-center justify-center rounded-[8px] text-ink hover:bg-ink/10 disabled:opacity-30">
                  <ArrowUpIcon />
                </button>
                <button
                  type="button"
                  aria-label={t('customize.widgets.down')}
                  data-testid={`widget-${w.id}-down`}
                  disabled={i === WIDGET_IDS.length - 1}
                  onClick={() => moveWidget(i, 1)}
                  className="flex size-9 items-center justify-center rounded-[8px] text-ink hover:bg-ink/10 disabled:opacity-30"
                >
                  <ArrowDownIcon />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="tiles" title={tx('customize.tiles.title')} hint={tx('customize.tiles.hint')} onReset={() => reset('tiles')}>
        <OptionCards
          testId="set-density"
          columns={3}
          label={t('customize.tiles.density')}
          value={look.density}
          onChange={(density) => set({ density })}
          options={(['compact', 'comfortable', 'large'] as const).map((d) => ({ value: d, label: tx(`customize.tiles.${d}`) }))}
        />
        <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border bg-card">
          {projects.map((p) => {
            const choice = look.tiles[p.id]
            return (
              <li key={p.id} className="flex flex-col gap-3 px-4 py-3" data-testid="tile-row" data-project={p.id}>
                <div className="flex items-center gap-3">
                  <TileIcon projectId={p.id} size={40} />
                  <bdi className="min-w-0 flex-1 truncate font-medium text-ink">{p.name}</bdi>
                  <button
                    type="button"
                    aria-pressed={choice?.pinned ?? false}
                    data-testid="tile-pin"
                    onClick={() => setTile(p.id, { pinned: !(choice?.pinned ?? false) })}
                    className={cx('flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm', choice?.pinned ? 'border-accent-fill bg-accent-fill/20 text-ink' : 'border-border text-muted')}
                  >
                    <PinIcon width={16} height={16} />
                    {tx(choice?.pinned ? 'customize.tiles.pinned' : 'customize.tiles.pin')}
                  </button>
                  <Button variant="quiet" data-testid="tile-edit" onClick={() => setEditingTile(editingTile === p.id ? null : p.id)}>
                    {tx(editingTile === p.id ? 'customize.tiles.close' : 'customize.tiles.change')}
                  </Button>
                </div>
                {editingTile === p.id ? <TilePicker projectId={p.id} choice={choice} onChange={(patch) => setTile(p.id, patch)} /> : null}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section id="clock" title={tx('customize.clock.title')} onReset={() => reset('clock')}>
        <OptionCards
          testId="set-hours"
          label={t('customize.clock.title')}
          value={look.clock.hours}
          onChange={(hours) => set({ clock: { ...look.clock, hours } })}
          options={[
            { value: '24', label: tx('customize.clock.h24') },
            { value: '12', label: tx('customize.clock.h12') }
          ]}
        />
        <Switch testId="clock-seconds" checked={look.clock.seconds} onChange={(seconds) => set({ clock: { ...look.clock, seconds } })} label={tx('customize.clock.seconds')} />
        <Switch testId="clock-date" checked={look.clock.date} onChange={(date) => set({ clock: { ...look.clock, date } })} label={tx('customize.clock.date')} />
      </Section>

      <Section id="motion" title={tx('customize.motion.title')} hint={reduced ? tx('customize.motion.system') : tx('customize.motion.hint')} onReset={() => reset('motion')}>
        <OptionCards
          testId="set-motion"
          columns={3}
          label={t('customize.motion.title')}
          value={look.motion}
          onChange={(motion) => set({ motion })}
          options={(['full', 'reduced', 'off'] as const).map((m) => ({ value: m, label: tx(`customize.motion.${m}`) }))}
        />
      </Section>

      <Section id="screensaver" title={tx('customize.saver.title')} hint={tx('customize.saver.hint')} onReset={() => reset('screensaver')}>
        <OptionCards
          testId="set-saver"
          columns={4}
          label={t('customize.saver.title')}
          value={look.screensaver.mode}
          onChange={(m) => set({ screensaver: { ...look.screensaver, mode: m } })}
          options={(['scene', 'activity', 'photos', 'dark'] as const).map((m) => ({ value: m, label: tx(`customize.saver.${m}`), hint: tx(`customize.saver.${m}Hint`) }))}
        />
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {tx('customize.saver.idle')}
          <Select
            testId="set-idle"
            label={t('customize.saver.idle')}
            value={look.screensaver.idleMinutes}
            onChange={(idleMinutes) => set({ screensaver: { ...look.screensaver, idleMinutes } })}
            options={IDLE_MINUTES.map((n) => ({ value: n, label: n === 0 ? t('customize.saver.never') : t('customize.saver.minutes', { count: n }) }))}
          />
        </label>
        <p className="pt-2 text-sm text-muted">{tx('customize.saver.wake')}</p>
        {(['waiting', 'failed', 'finished'] as const).map((w) => (
          <Switch
            key={w}
            testId={`wake-${w}`}
            checked={look.screensaver.wake[w]}
            onChange={(on) => set({ screensaver: { ...look.screensaver, wake: { ...look.screensaver.wake, [w]: on } } })}
            label={tx(`customize.saver.wake_${w}`)}
          />
        ))}
        <div>
          <Button variant="secondary" data-testid="saver-preview" onClick={() => setSaverPreview(true)}>
            {tx('customize.saver.preview')}
          </Button>
        </div>
      </Section>

      <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-6">
        <Button variant="secondary" data-testid="customize-done" onClick={onDone}>
          {tx(editing ? 'customize.leave' : 'customize.done')}
        </Button>
      </div>

      {saverPreview ? <SaverView onExit={() => setSaverPreview(false)} /> : null}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={tx('customize.background.removeTitle')}
        testId="photo-remove-confirm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {tx('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="photo-remove-yes"
              onClick={() => {
                if (removing) void removePhoto(removing)
                setRemoving(null)
              }}
            >
              {tx('customize.background.removeYes')}
            </Button>
          </>
        }
      >
        <p>{tx('customize.background.removeBody')}</p>
      </Dialog>
    </div>
  )
}

/** Pick one of the 40 icons and 12 colors, or go back to the generated tile. */
function TilePicker({ projectId, choice, onChange }: { projectId: string; choice?: TileChoice; onChange: (patch: Partial<TileChoice>) => void }): ReactNode {
  const { t, tx } = useT()
  const look = tileLook(projectId, choice)
  return (
    <div className="flex flex-col gap-3" data-testid="tile-picker">
      <div className="grid grid-cols-8 gap-1.5 min-[640px]:grid-cols-10" role="radiogroup" aria-label={t('customize.tiles.icon')}>
        {TILE_ICONS.map((d, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={look.iconIndex === i}
            aria-label={t('customize.tiles.iconN', { n: i + 1 })}
            data-testid="tile-icon"
            onClick={() => onChange({ icon: i })}
            className={cx('flex aspect-square items-center justify-center rounded-[8px] border text-ink', look.iconIndex === i ? 'border-ink bg-ink/10' : 'border-border hover:bg-ink/5')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={d} />
            </svg>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('customize.tiles.color')}>
        {TILE_COLORS.map((c, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={look.colorIndex === i}
            aria-label={t('customize.tiles.colorN', { n: i + 1 })}
            data-testid="tile-color"
            onClick={() => onChange({ color: i })}
            className={cx('size-9 rounded-[10px] border-2', look.colorIndex === i ? 'border-ink' : 'border-transparent')}
            style={{ background: `linear-gradient(160deg, ${c.from}, ${c.to})` }}
          />
        ))}
      </div>
      <div>
        <Button variant="quiet" data-testid="tile-generated" onClick={() => onChange({ icon: null, color: null })}>
          {tx('customize.tiles.generated')}
        </Button>
      </div>
    </div>
  )
}

