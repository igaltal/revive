import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Files that ship next to the app: tmux.conf, the menu bar icons and the
 * bundled tmux. In the packaged app they're in Contents/Resources; in
 * development, in the repo's resources/ folder.
 */
export function resourcePath(name: string, packaged: boolean, resourcesPath = process.resourcesPath): string {
  return packaged ? join(resourcesPath, name) : join(import.meta.dirname, '../../resources', name)
}

/** The tmux that ships inside Revive.app (built by scripts/build-tmux.sh), if it's there. */
export function bundledTmux(packaged: boolean, resourcesPath = process.resourcesPath): string | null {
  const file = resourcePath('bin/tmux', packaged, resourcesPath)
  return existsSync(file) ? file : null
}

/**
 * Revive's tmux socket. A Revive running on its own data folder (tests, a
 * second copy) gets its own socket too, so it never sees the real one's sessions.
 */
export function tmuxSocketName(customUserData: string | undefined): string {
  return customUserData ? `revive-${createHash('sha256').update(customUserData).digest('hex').slice(0, 10)}` : 'revive'
}
