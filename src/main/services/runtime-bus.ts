import type { OutputEvent, RuntimeEvent, StateEvent, StateEventInput } from '@shared/runtime'

type Listener = (event: RuntimeEvent) => void

/**
 * The single stream of runner, terminal and version activity. Services
 * publish here; transports (Electron IPC today, a network server later)
 * subscribe.
 *
 * Only state events are numbered and kept for replay. Output is broadcast
 * live and otherwise lives in each session's own buffer, so a noisy dev
 * server can never push a status change out of the replay window.
 */
export class RuntimeBus {
  private seq = 0
  private readonly history: StateEvent[] = []
  private readonly listeners = new Set<Listener>()

  constructor(private readonly keep = 2000) {}

  emit(input: StateEventInput): StateEvent {
    const event = { ...input, seq: ++this.seq, at: new Date().toISOString() } as StateEvent
    // Vitals arrive every few seconds: only the latest is worth replaying, and they must not
    // push status changes out of the replay window.
    if (event.type === 'vitals.updated') {
      const prev = this.history.findIndex((e) => e.type === 'vitals.updated')
      if (prev >= 0) this.history.splice(prev, 1)
    }
    this.history.push(event)
    if (this.history.length > this.keep) this.history.splice(0, this.history.length - this.keep)
    this.broadcast(event)
    return event
  }

  emitOutput(event: Omit<OutputEvent, 'type' | 'at'>): void {
    this.broadcast({ type: 'process.output', ...event, at: new Date().toISOString() })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** State events after `seq`, oldest first. */
  since(seq: number): StateEvent[] {
    return this.history.filter((e) => e.seq > seq)
  }

  get lastSeq(): number {
    return this.seq
  }

  private broadcast(event: RuntimeEvent): void {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch {
        // One broken subscriber never stops the others.
      }
    }
  }
}
