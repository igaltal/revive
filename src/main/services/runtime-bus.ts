import type { RuntimeEvent, RuntimeEventInput } from '@shared/runtime'

type Listener = (event: RuntimeEvent) => void

/**
 * The single stream of runner and terminal activity. Services publish here;
 * transports (Electron IPC today, a network server later) subscribe. A short
 * history lets a client that connects late catch up with `since(seq)`.
 */
export class RuntimeBus {
  private seq = 0
  private readonly history: RuntimeEvent[] = []
  private readonly listeners = new Set<Listener>()

  constructor(private readonly keep = 2000) {}

  emit(input: RuntimeEventInput): RuntimeEvent {
    const event = { ...input, seq: ++this.seq, at: new Date().toISOString() } as RuntimeEvent
    this.history.push(event)
    if (this.history.length > this.keep) this.history.splice(0, this.history.length - this.keep)
    for (const l of this.listeners) {
      try {
        l(event)
      } catch {
        // One broken subscriber never stops the others.
      }
    }
    return event
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  since(seq: number): RuntimeEvent[] {
    return this.history.filter((e) => e.seq > seq)
  }

  get lastSeq(): number {
    return this.seq
  }
}
