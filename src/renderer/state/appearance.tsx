import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { ACCENT_NAMES, DEFAULT_APPEARANCE, photoPath, type Appearance, type AppearancePatch, type Photo } from '@shared/appearance'
import { cityById, cityForTimeZone, type City } from '@shared/cities'
import { nextSkyChange, skyAt } from '@shared/sun'
import { transport } from '@/transport'
import { useClient } from './client'
import { useHostStatus } from './host'
import { ACCENT_PRESETS, photoDim, themeVars, type Backdrop, type ThemeName } from '@/theme/tokens'
import type { SceneKind } from '@/theme/scene'

export type AppMode = 'local' | 'host' | 'client'

interface AppearanceValue {
  loaded: boolean
  /** What is stored for this device. */
  saved: Appearance
  /** What the screen shows: the unsaved changes being tried, or what is stored. */
  look: Appearance
  editing: boolean
  /** Try a change on the whole app without saving it. */
  preview: (patch: AppearancePatch) => void
  save: () => Promise<void>
  discard: () => void
  addPhoto: (jpegBase64: string, worst: string) => Promise<Photo>
  removePhoto: (id: string) => Promise<void>
  mode: AppMode
  theme: ThemeName
  /** The sky being shown right now. */
  sky: SceneKind
  city: City
  backdrop: Backdrop
  photoUrl: (id: string) => string
}

const AppearanceContext = createContext<AppearanceValue | null>(null)

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Scenic in Host and client mode, Paper in local mode, unless the device chose. */
export function resolveTheme(choice: Appearance['theme'], mode: AppMode): ThemeName {
  return choice ?? (mode === 'local' ? 'paper' : 'scenic')
}

export function accentColor(accent: Appearance['accent']): string | null {
  if (!accent) return null
  return (ACCENT_NAMES as readonly string[]).includes(accent) ? ACCENT_PRESETS[accent as keyof typeof ACCENT_PRESETS] : accent
}

/** The sky at this moment for these choices (auto follows the sun at the city). */
function useSky(choice: Appearance['scene'], city: City): SceneKind {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (choice !== 'auto') return
    // Wake up exactly when the sky changes (and at least every 15 minutes, in case the clock jumps).
    const next = nextSkyChange(new Date(), city.lat, city.lon).getTime() - Date.now()
    const t = setTimeout(() => setNow(new Date()), Math.max(1000, Math.min(next + 500, 15 * 60_000)))
    return () => clearTimeout(t)
  }, [choice, city, now])
  return choice === 'auto' ? skyAt(now, city.lat, city.lon) : choice
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const client = useClient()
  const { host } = useHostStatus()
  const [saved, setSaved] = useState<Appearance>(DEFAULT_APPEARANCE)
  const [draft, setDraft] = useState<Appearance | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void transport
      .invoke('appearance:get')
      // Fields a newer version added get their defaults.
      .then((a) => alive && a && setSaved({ ...DEFAULT_APPEARANCE, ...a }))
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  const look = draft ?? saved
  const mode: AppMode = client.host ? 'client' : host?.sharing ? 'host' : 'local'
  const theme = resolveTheme(look.theme, mode)
  const city = useMemo(() => cityById(look.city) ?? cityForTimeZone(deviceTimeZone()), [look.city])
  const sky = useSky(look.scene, city)

  const photo = look.background ? look.photos.find((p) => p.id === look.background) : undefined
  const backdrop: Backdrop = useMemo(() => (photo ? { photo: { worst: photo.worst, dim: photoDim(photo.worst) } } : { scene: sky }), [photo, sky])
  const vars = useMemo(() => themeVars({ theme, glass: look.glass, accent: accentColor(look.accent), backdrop }), [theme, look.glass, look.accent, backdrop])

  // The look applies to the whole page: variables on <html>, read by every component.
  useLayoutEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    root.dataset['theme'] = theme
    root.dataset['density'] = look.density
    // The phone's status bar and the installed app's frame follow the look.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--color-page']!)
  }, [vars, theme, look.density])

  const preview = useCallback((patch: AppearancePatch) => setDraft((d) => ({ ...(d ?? saved), ...patch })), [saved])
  const discard = useCallback(() => setDraft(null), [])
  const save = useCallback(async () => {
    if (!draft) return
    const { photos: _photos, ...patch } = draft
    void _photos
    const next = await transport.invoke('appearance:set', patch)
    setSaved(next)
    setDraft(null)
  }, [draft])
  const addPhoto = useCallback(async (jpegBase64: string, worst: string) => {
    const p = await transport.invoke('photos:add', { jpegBase64, worst })
    setSaved((s) => ({ ...s, photos: [...s.photos, p] }))
    setDraft((d) => (d ? { ...d, photos: [...d.photos, p] } : d))
    return p
  }, [])
  const removePhoto = useCallback(async (id: string) => {
    const next = await transport.invoke('photos:remove', { id })
    setSaved(next)
    setDraft((d) => (d ? { ...d, photos: next.photos, background: d.background === id ? null : d.background } : d))
  }, [])
  const photoUrl = useCallback((id: string) => transport.assetUrl(photoPath(id)), [])

  const value = useMemo<AppearanceValue>(
    () => ({ loaded, saved, look, editing: draft !== null, preview, save, discard, addPhoto, removePhoto, mode, theme, sky, city, backdrop, photoUrl }),
    [loaded, saved, look, draft, preview, save, discard, addPhoto, removePhoto, mode, theme, sky, city, backdrop, photoUrl]
  )
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used inside AppearanceProvider')
  return ctx
}

/** The same, for components that also render outside the app (tests of single screens). */
export function useAppearanceMaybe(): AppearanceValue | null {
  return useContext(AppearanceContext)
}
