import { stripAnsi } from '@shared/ansi'
import type { BrokenReason } from '@shared/runtime'

export interface ExplainInput {
  /** Output of the failed step, masked. */
  log: string[]
  step: 'install' | 'dev' | 'serve'
  timedOut: boolean
  /** Key names the manifest lists for this project. */
  keys: string[]
  /** Programs the commands start with (npm, python, …). */
  tools: string[]
}

/**
 * Turns a failure into one known cause. Rules only; the agent-based
 * "Fix it for me" plugs into the same interface in a later phase.
 */
export interface ErrorExplainer {
  explain(input: ExplainInput): BrokenReason
}

const PORT_BUSY = /EADDRINUSE|address already in use|port \d+ is (?:already )?in use|port is already allocated/i
const DEPS_MISSING = /cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|No module named|could not resolve dependenc|missing script/i
const NOT_FOUND = [/command not found:\s*([\w.-]+)/i, /([\w.-]+): command not found/i, /spawn ([\w.-]+) ENOENT/i, /([\w.-]+): No such file or directory/i]
const KEY_TROUBLE = /missing|undefined|not set|not defined|required|invalid|no .*key|empty/i

/** Programs a person installs themselves, as opposed to a project's own parts. */
const SYSTEM_TOOLS = new Set(['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'python', 'python3', 'pip', 'pip3', 'uv', 'poetry'])

export const ruleExplainer: ErrorExplainer = {
  explain({ log, step, timedOut, keys, tools }) {
    const lines = log.map(stripAnsi)
    const text = lines.join('\n')

    for (const re of NOT_FOUND) {
      const m = re.exec(text)
      if (!m) continue
      const tool = m[1]!.toLowerCase()
      if (SYSTEM_TOOLS.has(tool) || tools.includes(tool)) return { code: 'tool_missing', tool }
      return { code: 'deps_missing' }
    }
    if (PORT_BUSY.test(text)) return { code: 'port_busy' }
    for (const key of keys) {
      if (lines.some((l) => l.includes(key) && KEY_TROUBLE.test(l))) return { code: 'missing_key', key }
    }
    if (DEPS_MISSING.test(text)) return { code: 'deps_missing' }
    if (step === 'install') return { code: 'install_failed' }
    if (timedOut) return { code: 'timeout' }
    return { code: 'unknown' }
  }
}
