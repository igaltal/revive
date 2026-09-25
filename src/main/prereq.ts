import type { PrereqReport, ToolStatus } from '@shared/prereq'
import type { Exec } from './exec'

const VERSION = /(\d+\.\d+(?:\.\d+)?)/

async function version(exec: Exec, file: string, args = ['--version']): Promise<ToolStatus> {
  const r = await exec(file, args, { timeoutMs: 8000 })
  if (r.code !== 0) return { installed: false, version: null }
  return { installed: true, version: VERSION.exec(r.stdout + r.stderr)?.[1] ?? null }
}

/** Reads only the `loggedIn` flag. Email and organization in the same output are ignored. */
export function parseAuthStatus(stdout: string): 'yes' | 'no' | 'unknown' {
  try {
    const data: unknown = JSON.parse(stdout)
    if (typeof data === 'object' && data !== null && 'loggedIn' in data) {
      return (data as { loggedIn: unknown }).loggedIn === true ? 'yes' : 'no'
    }
  } catch {
    // fall through
  }
  return 'unknown'
}

export async function claudeSignedIn(exec: Exec): Promise<'yes' | 'no' | 'unknown'> {
  const r = await exec('claude', ['auth', 'status', '--json'], { timeoutMs: 15_000 })
  // `auth status` exits non-zero when signed out but still prints JSON.
  return parseAuthStatus(r.stdout)
}

/**
 * On a Mac without developer tools, /usr/bin/git is a stub that pops up an
 * install dialog when run. Check for the tools first so we never trigger it.
 */
async function gitStatus(exec: Exec): Promise<ToolStatus> {
  const which = await exec('/usr/bin/which', ['git'])
  const gitPath = which.stdout.trim()
  if (which.code !== 0 || !gitPath) return { installed: false, version: null }
  if (gitPath === '/usr/bin/git') {
    const devTools = await exec('/usr/bin/xcode-select', ['-p'])
    if (devTools.code !== 0) return { installed: false, version: null }
  }
  return version(exec, gitPath)
}

export async function checkPrereqs(exec: Exec): Promise<PrereqReport> {
  const [claude, git, node, codex] = await Promise.all([
    version(exec, 'claude'),
    gitStatus(exec),
    version(exec, 'node'),
    version(exec, 'codex')
  ])
  const signedIn = claude.installed ? await claudeSignedIn(exec) : 'unknown'
  return { claude: { ...claude, signedIn }, git, node, codex, checkedAt: new Date().toISOString() }
}
