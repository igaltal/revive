import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Exec } from './exec'

const MARK = '__REVIVE_PATH__'

/** Where the tools we need usually live on a Mac, in case the shell can't tell us. */
export function fallbackDirs(home = homedir()): string[] {
  return [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
}

export function parseShellPath(output: string): string | null {
  const start = output.indexOf(MARK)
  const end = output.indexOf(MARK, start + MARK.length)
  if (start === -1 || end === -1) return null
  const value = output.slice(start + MARK.length, end).trim()
  return value.length > 0 ? value : null
}

export function mergePaths(...lists: Array<string | undefined | null>): string {
  const seen = new Set<string>()
  for (const list of lists) {
    for (const dir of (list ?? '').split(':')) if (dir) seen.add(dir)
  }
  return [...seen].join(':')
}

/**
 * Apps opened from Finder get a minimal PATH, so `claude`, `node` and Homebrew
 * tools are invisible. Ask the user's login shell for its PATH once at startup.
 */
export async function loadShellPath(exec: Exec): Promise<void> {
  const shell = process.env['SHELL'] || '/bin/zsh'
  const result = await exec(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], { timeoutMs: 5000 })
  const fromShell = result.code === 0 ? parseShellPath(result.stdout) : null
  process.env['PATH'] = mergePaths(fromShell, process.env['PATH'], fallbackDirs().join(':'))
}
