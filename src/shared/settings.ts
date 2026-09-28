import { z } from 'zod'

export const LANGUAGES = ['he', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const SettingsSchema = z.object({
  /** null until the user picks a language on first run. */
  uiLanguage: z.enum(LANGUAGES).nullable(),
  claudeLanguage: z.enum(['same', 'he', 'en']),
  detailLevel: z.enum(['simple', 'advanced']),
  /** Model alias passed to `claude --model` for scans. */
  scanModel: z.string().min(1),
  recentFolders: z.array(z.string()).max(8),
  /** Local mode: Claude Code, Codex and shell sessions keep running after Revive quits (with tmux). */
  keepAgentsRunning: z.boolean(),
  lastFolder: z.string().nullable()
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: null,
  claudeLanguage: 'same',
  detailLevel: 'simple',
  scanModel: 'haiku',
  recentFolders: [],
  keepAgentsRunning: true,
  lastFolder: null
}

export const SettingsPatchSchema = SettingsSchema.partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export function dirFor(lang: Language): 'rtl' | 'ltr' {
  return lang === 'he' ? 'rtl' : 'ltr'
}
