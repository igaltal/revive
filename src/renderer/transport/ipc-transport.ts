import { LOCAL_ASSET_ORIGIN } from '@shared/assets'
import { capabilitiesFor, type Capabilities, type ClientStatus, type ClientStreamName, type ClientStreamPayload, type MethodName } from '@shared/contract'
import { SERVER_STREAMS } from '@shared/contract-names'
import { BaseTransport, RemoteError, type CallEnvelope, type DesktopBridge } from '@shared/transport'

/**
 * The contract over Electron IPC (the preload bridge). Session output for
 * every session arrives live; a watch first reads the session's buffer.
 *
 * In client mode main forwards everything to the Host; this window then has
 * a remote client's capabilities, and catches up when main's connection
 * to the Host comes back.
 */
export class IpcTransport extends BaseTransport {
  readonly kind = 'ipc' as const
  private client: ClientStatus | null = null

  constructor(readonly bridge: DesktopBridge) {
    super()
    for (const stream of SERVER_STREAMS) bridge.on(stream, (payload) => this.receive(stream, payload))
    this.subscribe('client:status', (s) => this.clientStatus(s))
    void this.call('client:status', undefined)
      .then((s) => this.client ?? this.clientStatus(s as ClientStatus))
      .catch(() => {})
    void this.baseline().catch(() => {})
  }

  capabilities(): Capabilities {
    return this.client?.capabilities ?? capabilitiesFor('ipc')
  }

  private clientStatus(s: ClientStatus): void {
    const was = this.client?.state
    this.client = s
    if (s.state === 'reconnecting') this.setConnection('reconnecting')
    else if (s.state === 'rejected') this.setConnection('rejected')
    // Back from a drop: pick up missed state events and session output.
    else if (s.state === 'open' && (was === 'reconnecting' || was === 'rejected')) void this.resume().catch(() => {})
  }

  assetUrl(path: string): string {
    return `${LOCAL_ASSET_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
  }

  pathForFile(file: Blob & { name: string }): string {
    return this.bridge.pathForFile(file)
  }

  protected async call(method: MethodName, input: unknown): Promise<unknown> {
    const r = (await this.bridge.invoke(method, input)) as CallEnvelope
    if (!r.ok) throw new RemoteError(r.e.code, r.e.message)
    return r.v
  }

  protected post<S extends ClientStreamName>(stream: S, payload: ClientStreamPayload<S>): void {
    this.bridge.send(stream, payload)
  }

  protected startWatch(sessionId: string): void {
    this.fillFromBuffer(sessionId)
  }

  protected stopWatch(): void {}
}
