import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, SettingsPatchSchema, SettingsSchema, type Settings, type SettingsPatch } from '@shared/settings'

/** Plain app settings (no secrets) stored as JSON in the app's userData folder. */
export class SettingsStore {
  private readonly file: string
  private current: Settings

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'settings.json')
    this.current = this.load()
  }

  get(): Settings {
    return this.current
  }

  update(patch: SettingsPatch): Settings {
    const parsedPatch = SettingsPatchSchema.parse(patch)
    this.current = SettingsSchema.parse({ ...this.current, ...parsedPatch })
    this.save()
    return this.current
  }

  private load(): Settings {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      // Fill in fields added in newer versions, then validate strictly.
      const merged = { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw !== null ? raw : {}) }
      const parsed = SettingsSchema.safeParse(merged)
      return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.current, null, 2))
    renameSync(tmp, this.file)
  }
}
