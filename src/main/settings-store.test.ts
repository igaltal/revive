import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { SettingsStore } from './settings-store'

const tempDir = () => mkdtempSync(join(tmpdir(), 'revive-settings-'))

describe('SettingsStore', () => {
  it('starts with defaults and no language chosen', () => {
    const store = new SettingsStore(tempDir())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(store.get().uiLanguage).toBeNull()
  })

  it('persists updates across instances', () => {
    const dir = tempDir()
    new SettingsStore(dir).update({ uiLanguage: 'he', detailLevel: 'advanced' })
    const reloaded = new SettingsStore(dir).get()
    expect(reloaded.uiLanguage).toBe('he')
    expect(reloaded.detailLevel).toBe('advanced')
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).uiLanguage).toBe('he')
  })

  it('rejects invalid values', () => {
    const store = new SettingsStore(tempDir())
    expect(() => store.update({ uiLanguage: 'fr' as never })).toThrow()
    expect(store.get().uiLanguage).toBeNull()
  })

  it('recovers from a corrupt file', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), '{not json')
    expect(new SettingsStore(dir).get()).toEqual(DEFAULT_SETTINGS)
  })
})
