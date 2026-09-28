import { createHash } from 'node:crypto'
import { SESSION_KINDS, type SessionKind, type SessionRef } from '@shared/runtime'

const PLAIN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HASHED = /^revive-h([0-9a-f]{10})-([a-z]+)$/

/**
 * tmux session names: `revive-<projectId>-<kind>`, only [a-z0-9-]. A project
 * id with anything else (Hebrew, spaces, capitals, dots) becomes a short
 * stable hash instead: `revive-h<10 hex>-<kind>`. The identity itself is also
 * stored on the session (tmux user options), so names always round trip.
 */
export function tmuxName(ref: SessionRef): string {
  const id = ref.projectId
  if (PLAIN.test(id) && id.length <= 60 && !/^h[0-9a-f]{10}$/.test(id)) return `revive-${id}-${ref.kind}`
  return `revive-h${createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 10)}-${ref.kind}`
}

/** Remembers names made here, so a hashed name maps back to its project id. */
export class TmuxNames {
  private readonly known = new Map<string, SessionRef>()

  name(ref: SessionRef): string {
    const n = tmuxName(ref)
    this.known.set(n, { projectId: ref.projectId, kind: ref.kind })
    return n
  }

  /** The identity behind a name: from this map, or read back from a plain name. Null if unknown. */
  identity(name: string): SessionRef | null {
    const hit = this.known.get(name)
    if (hit) return hit
    if (HASHED.test(name)) return null
    const m = /^revive-(.+)-([a-z]+)$/.exec(name)
    if (!m || !(SESSION_KINDS as readonly string[]).includes(m[2]!)) return null
    const ref = { projectId: m[1]!, kind: m[2] as SessionKind }
    return tmuxName(ref) === name ? ref : null
  }

  remember(name: string, ref: SessionRef): void {
    if (tmuxName(ref) === name) this.known.set(name, ref)
  }
}
