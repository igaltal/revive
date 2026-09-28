import type { DesktopBridge } from '../shared/transport'

declare global {
  interface Window {
    revive: DesktopBridge
  }
}
