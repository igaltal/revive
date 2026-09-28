import { randomBytes } from 'node:crypto'
import { SESSION_OUTPUT_BYTES } from '@shared/runtime'

/**
 * The tail of one session's output, capped in bytes. Offsets count every
 * byte ever written to the session and never go back, so a client can ask
 * "everything after offset N" at any time, even across restarts of the
 * process behind the session.
 */
export class OutputBuffer {
  /**
   * This buffer's lifetime. Offsets only mean something within one epoch: after
   * a Revive restart the buffer is rebuilt (from tmux's history) under a new one.
   */
  readonly epoch = randomBytes(6).toString('hex')
  private chunks: Array<{ start: number; bytes: Buffer }> = []
  private size = 0
  private end = 0

  constructor(private readonly cap = SESSION_OUTPUT_BYTES) {}

  /** Appends text and returns the offset it starts at. */
  append(text: string): number {
    const start = this.end
    const bytes = Buffer.from(text, 'utf8')
    if (bytes.length === 0) return start
    this.chunks.push({ start, bytes })
    this.size += bytes.length
    this.end += bytes.length
    // Whole chunks are dropped, so a stored chunk never starts mid-character.
    while (this.size > this.cap && this.chunks.length > 1) this.size -= this.chunks.shift()!.bytes.length
    return start
  }

  /** The offset of the oldest byte still kept. */
  get startOffset(): number {
    return this.chunks[0]?.start ?? this.end
  }

  get endOffset(): number {
    return this.end
  }

  read(fromOffset: number): { data: string; fromOffset: number; nextOffset: number; truncated: boolean } {
    const from = Math.max(0, Math.min(Math.floor(fromOffset), this.end))
    const truncated = from < this.startOffset
    const parts: Buffer[] = []
    let actual = this.end
    for (const c of this.chunks) {
      const chunkEnd = c.start + c.bytes.length
      if (chunkEnd <= from) continue
      if (parts.length === 0) actual = Math.max(c.start, from)
      parts.push(c.start >= from ? c.bytes : c.bytes.subarray(from - c.start))
    }
    return { data: Buffer.concat(parts).toString('utf8'), fromOffset: actual, nextOffset: this.end, truncated }
  }
}
