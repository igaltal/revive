import type { ReviveApi } from '../shared/ipc'

declare global {
  interface Window {
    revive: ReviveApi
  }
}
