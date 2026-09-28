import { describe, expect, it } from 'vitest'
import { TmuxNames, tmuxName } from './tmux-names'

const VALID = /^[a-z0-9-]+$/

describe('tmux session names', () => {
  it('plain ids stay readable', () => {
    expect(tmuxName({ projectId: 'bakery-site', kind: 'claude' })).toBe('revive-bakery-site-claude')
    expect(new TmuxNames().identity('revive-bakery-site-claude')).toEqual({ projectId: 'bakery-site', kind: 'claude' })
  })

  it('Hebrew, spaces and capitals become a short stable hash, valid for tmux, and map back', () => {
    const names = new TmuxNames()
    const ids = ['מאפייה שכונתית', 'my app', 'Bakery', 'a.b', 'אתר של נועה', ' spaced ', 'h0123456789']
    const seen = new Set<string>()
    for (const projectId of ids) {
      for (const kind of ['shell', 'claude', 'codex', 'run'] as const) {
        const n = names.name({ projectId, kind })
        expect(n, projectId).toMatch(VALID)
        expect(n).toMatch(/^revive-h[0-9a-f]{10}-/)
        expect(tmuxName({ projectId, kind })).toBe(n) // stable
        expect(names.identity(n)).toEqual({ projectId, kind })
        seen.add(n)
      }
    }
    expect(seen.size).toBe(ids.length * 4)
  })

  it('a hashed name it has never seen is unknown until remembered (from the session itself)', () => {
    const n = tmuxName({ projectId: 'מאפייה', kind: 'shell' })
    const fresh = new TmuxNames()
    expect(fresh.identity(n)).toBeNull()
    fresh.remember(n, { projectId: 'מאפייה', kind: 'shell' })
    expect(fresh.identity(n)).toEqual({ projectId: 'מאפייה', kind: 'shell' })
    // A forged identity for that name is refused.
    fresh.remember(tmuxName({ projectId: 'x', kind: 'shell' }), { projectId: 'y', kind: 'shell' })
    expect(fresh.identity(tmuxName({ projectId: 'x', kind: 'shell' }))).toEqual({ projectId: 'x', kind: 'shell' })
  })

  it('names that aren\'t Revive\'s are unknown', () => {
    const names = new TmuxNames()
    expect(names.identity('work')).toBeNull()
    expect(names.identity('revive-app-bash')).toBeNull()
  })
})
