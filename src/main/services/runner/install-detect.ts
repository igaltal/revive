import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Whether the project's parts still need downloading before it can start.
 * Only well-known layouts are judged; anything else is assumed ready, and a
 * failed start that points at missing parts forces the install next time.
 */
export function needsInstall(dir: string, installCommand: string | null): boolean {
  if (!installCommand) return false
  if (existsSync(join(dir, 'package.json'))) return !existsSync(join(dir, 'node_modules'))
  if (existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'pyproject.toml'))) {
    return !existsSync(join(dir, '.venv')) && !existsSync(join(dir, 'venv'))
  }
  return false
}
