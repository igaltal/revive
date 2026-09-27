import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { walk } from '../fs-walk'
import type { AgentAdapter } from './agent-adapter'

/**
 * Offline stand-in for Claude, used only by end-to-end tests of unpackaged
 * builds (REVIVE_TEST_AGENT=<manifest file>). Reads nothing sensitive, costs nothing.
 */
export function fakeAdapter(manifestFile: string): AgentAdapter {
  return {
    id: 'fake',
    async scan(folder, { onEvent, signal }) {
      for (const f of (await walk(folder)).files) {
        if (signal.aborted) return { ok: false, code: 'cancelled', costUsd: 0 }
        onEvent({ kind: 'read', path: f.rel })
        await new Promise((r) => setTimeout(r, 150))
      }
      await copyFile(manifestFile, join(folder, '.revive', 'manifest.json'))
      return { ok: true, costUsd: 0.01 }
    },
    // Keeps the fixture's own sentences; only the cost shows the step ran.
    async describe() {
      return { ok: true, costUsd: 0.02, descriptions: [] }
    }
  }
}
