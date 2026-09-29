import { readFileSync } from 'node:fs'
import type { Manifest } from '@shared/manifest'
import type { AgentAdapter } from './agent-adapter'

/**
 * Offline stand-in for Claude, used only by end-to-end tests of unpackaged
 * builds (REVIVE_TEST_AGENT=<manifest file>). Revive still finds the projects
 * itself; this only supplies the words, from the fixture manifest (by id),
 * after a short pause so progress can be seen. Costs nothing.
 */
export function fakeAdapter(manifestFile: string): AgentAdapter {
  const fixture = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
  return {
    id: 'fake',
    ready: async () => ({ ok: true }),
    async understand(projects, { signal }) {
      await new Promise((r) => setTimeout(r, 300))
      if (signal.aborted) return { ok: false, code: 'cancelled', costUsd: null }
      return {
        ok: true,
        costUsd: 0.01,
        projects: projects.map((p) => {
          const f = fixture.projects.find((x) => x.id === p.id)
          return {
            id: p.id,
            name: f?.name ?? p.id,
            en: f?.description.en || `A project called ${p.id}.`,
            he: f?.description.he || `פרויקט בשם ${p.id}.`,
            keys: p.digest.keys.map((key) => {
              const k = f?.keys.find((x) => x.key === key)
              return { key, en: k?.purpose.en ?? 'Used by the project', he: k?.purpose.he ?? 'בשימוש הפרויקט' }
            }),
            notes: f?.notes.slice(0, 3) ?? []
          }
        })
      }
    }
  }
}
