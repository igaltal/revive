import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { ReviveApi } from '@shared/ipc'

/** In-memory stand-in for the preload bridge. */
export function installMockRevive(initial: Partial<Settings> = {}): { settings: () => Settings } {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial }
  const api: ReviveApi = {
    invoke: (async (channel: string, args?: unknown) => {
      if (channel === 'settings:get') return settings
      if (channel === 'settings:set') {
        settings = { ...settings, ...(args as Partial<Settings>) }
        return settings
      }
      throw new Error(`unmocked ${channel}`)
    }) as ReviveApi['invoke'],
    on: () => () => {}
  }
  Object.defineProperty(window, 'revive', { value: api, configurable: true })
  return { settings: () => settings }
}
