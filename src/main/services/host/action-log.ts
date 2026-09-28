import { appendFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ActivityEntry } from '@shared/host'
import { redact } from '@shared/redact'

/**
 * Input fields that may appear in the log, and only as short plain values.
 * Everything else is listed by name only, so file contents, terminal input,
 * pairing codes and secret values can never be written.
 */
const SAFE_FIELDS = new Set(['projectId', 'versionId', 'scanId', 'sessionId', 'kind', 'topic', 'confirm', 'on', 'allow', 'requestId', 'deviceId', 'path', 'address', 'deviceName'])
const MAX_VALUE = 120

export function summarizeInput(input: unknown): ActivityEntry['summary'] {
  if (input === undefined || input === null || typeof input !== 'object') return {}
  const out: ActivityEntry['summary'] = {}
  const other: string[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SAFE_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      out[key] = typeof value === 'string' ? redact(value).slice(0, MAX_VALUE) : value
    } else {
      other.push(key)
    }
  }
  if (other.length) out['fields'] = other.sort().join(', ')
  return out
}

/**
 * Every change any device asks for, one JSON line each, in
 * userData/action-log.jsonl. Only ever appended to.
 */
export class ActionLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true })
  }

  record(entry: Omit<ActivityEntry, 'at' | 'summary'> & { input: unknown }): void {
    const line: ActivityEntry = { at: new Date().toISOString(), deviceId: entry.deviceId, deviceName: entry.deviceName, method: entry.method, summary: summarizeInput(entry.input) }
    appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 })
  }

  /** The latest entries, newest first. Reads only the end of the file. */
  latest(limit: number): ActivityEntry[] {
    if (!existsSync(this.file)) return []
    const size = statSync(this.file).size
    const bytes = Math.min(size, 512 * 1024)
    const buf = Buffer.alloc(bytes)
    const fd = openSync(this.file, 'r')
    try {
      readSync(fd, buf, 0, bytes, size - bytes)
    } finally {
      closeSync(fd)
    }
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    if (bytes < size) lines.shift() // the first line may be cut
    const entries: ActivityEntry[] = []
    for (const l of lines.reverse()) {
      try {
        entries.push(JSON.parse(l) as ActivityEntry)
      } catch {
        // skip a damaged line
      }
      if (entries.length >= limit) break
    }
    return entries
  }
}
