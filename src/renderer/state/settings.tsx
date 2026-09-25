import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'
import { applyLanguage } from '@/i18n'

interface SettingsContextValue {
  settings: Settings
  loaded: boolean
  update: (patch: SettingsPatch) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void window.revive.invoke('settings:get').then((s) => {
      if (!alive) return
      setSettings(s)
      setLoaded(true)
    })
    const off = window.revive.on('settings:changed', setSettings)
    return () => {
      alive = false
      off()
    }
  }, [])

  // Direction and words follow the language, in place.
  useEffect(() => {
    applyLanguage(settings.uiLanguage ?? 'en')
  }, [settings.uiLanguage])

  const update = useCallback((patch: SettingsPatch) => {
    // Optimistic: the screen changes instantly, the file is written after.
    setSettings((prev) => ({ ...prev, ...patch }))
    void window.revive.invoke('settings:set', patch)
  }, [])

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
