import type { ServerStreamName, ServerStreamPayload } from '@shared/contract'
import type { RuntimeBus } from '../services/runtime-bus'
import { sessionId } from '@shared/runtime'

type Listener = <S extends ServerStreamName>(stream: S, payload: ServerStreamPayload<S>) => void

/**
 * Everything main pushes to clients, by contract stream name. The IPC
 * adapter and the WebSocket server both subscribe here.
 */
export class ServerStreams {
  private readonly listeners = new Set<Listener>()

  emit<S extends ServerStreamName>(stream: S, payload: ServerStreamPayload<S>): void {
    for (const l of this.listeners) {
      try {
        l(stream, payload)
      } catch {
        // One broken client never stops the others.
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Runtime state events and session output go out on their own streams. */
  bridge(bus: RuntimeBus): () => void {
    return bus.subscribe((e) => {
      if (e.type === 'process.output') this.emit('session:output', { sessionId: sessionId(e.session), offset: e.offset, epoch: e.epoch, data: e.data })
      else this.emit('runtime:event', e)
    })
  }
}
