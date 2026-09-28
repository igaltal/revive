export interface ToolStatus {
  installed: boolean
  version: string | null
}

export interface PrereqReport {
  claude: ToolStatus & { signedIn: 'yes' | 'no' | 'unknown' }
  git: ToolStatus
  node: ToolStatus
  /** Optional; detected and shown, never required. */
  codex: ToolStatus
  checkedAt: string
}

/** Claude Code installed and signed in, plus git for saved versions. */
export function isReady(r: PrereqReport): boolean {
  return r.claude.installed && r.claude.signedIn === 'yes' && r.git.installed
}

/** The official native installer (code.claude.com/docs/en/setup). Never built from user input. */
export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'
export const CLAUDE_SIGN_IN_COMMAND = 'claude auth login'

export const HELP_PAGES = {
  'claude-install': 'https://code.claude.com/docs/en/setup',
  'claude-sign-in': 'https://code.claude.com/docs/en/authentication',
  git: 'https://git-scm.com/download/mac',
  node: 'https://nodejs.org/en/download',
  tailscale: 'https://tailscale.com/download/mac',
  codex: 'https://github.com/openai/codex#installing-and-running-codex-cli'
} as const
export type HelpTopic = keyof typeof HELP_PAGES

export type TaskPhase = 'running' | 'done' | 'failed'
export interface TaskUpdate {
  task: 'install-claude' | 'sign-in'
  phase: TaskPhase
  /** Output line, already masked. */
  line?: string
}
