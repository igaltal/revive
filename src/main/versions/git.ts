import { simpleGit } from 'simple-git'

/** Revive's snapshots have their own author and never depend on the user's git identity. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Revive',
  GIT_AUTHOR_EMAIL: 'revive@localhost',
  GIT_COMMITTER_NAME: 'Revive',
  GIT_COMMITTER_EMAIL: 'revive@localhost'
}

export interface GitEnv {
  cwd: string
  gitDir?: string
  workTree?: string
  /** Omit to use the repository's own index (read-only lookups only). */
  indexFile?: string
}

/** The only git variables Revive sets; simple-git blocks all others. */
const GIT_VARS = [
  'GIT_INDEX_FILE',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_TERMINAL_PROMPT',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL'
] as const

const PASS_THROUGH = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'])

/** A minimal environment: no inherited git location, pager, editor or credentials helper. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && (PASS_THROUGH.has(k) || k.startsWith('LC_'))) env[k] = v
  }
  return env
}

export function git(e: GitEnv) {
  const env: Record<string, string> = { ...baseEnv(), ...IDENTITY, GIT_TERMINAL_PROMPT: '0' }
  if (e.indexFile) env['GIT_INDEX_FILE'] = e.indexFile
  if (e.gitDir) env['GIT_DIR'] = e.gitDir
  if (e.workTree) env['GIT_WORK_TREE'] = e.workTree
  return simpleGit({ baseDir: e.cwd, trimmed: true, allowEnvironment: GIT_VARS }).env(env)
}

/** Git pathspec magic: exclude a glob, or an exact path. */
export const excludeGlob = (g: string) => `:(exclude,glob)${g}`
export const excludeLiteral = (p: string) => `:(exclude,literal)${p}`
