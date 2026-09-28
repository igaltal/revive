import { CLIENT_STREAM_SCHEMAS, METHODS, availableOn, type AppMethodName, type ClientStreamName, type CoreMethodName, type MethodInput, type MethodName, type MethodOutput, type TransportKind } from '@shared/contract'
import { METHOD_NAMES, CLIENT_STREAMS } from '@shared/contract-names'
import { parseSessionId } from '@shared/runtime'
import type { SessionHub } from '../services/sessions/session-hub'

export interface CallContext {
  transport: TransportKind
  /** Who asked: a paired device, or this computer's own window. */
  device: { id: string; name: string }
}

type HandlerMap<K extends MethodName> = { [M in K]: (input: MethodInput<M>, ctx: CallContext) => MethodOutput<M> | Promise<MethodOutput<M>> }
/** One function per contract method. The mapped type makes a missing or extra one a compile error. */
export type Handlers = HandlerMap<MethodName>
/** Revive's core: what the services do (and what a client forwards to its Host). */
export type CoreHandlers = HandlerMap<CoreMethodName>
/** This app's own controls: Host mode and the client connection. */
export type AppHandlers = HandlerMap<AppMethodName>

/** For setups with no Host or client controls (tests, headless): every app method is unavailable. */
export function noAppHandlers(): AppHandlers {
  const refuse = () => {
    throw new ContractError('not_available', 'Not available here')
  }
  return Object.fromEntries(METHOD_NAMES.filter((m) => (METHODS[m] as { app: boolean }).app).map((m) => [m, refuse])) as unknown as AppHandlers
}

export class ContractError extends Error {
  constructor(
    readonly code: 'unknown_method' | 'not_available' | 'bad_input' | 'bad_output',
    message: string
  ) {
    super(message)
  }
}

const isMethod = (name: string): name is MethodName => (METHOD_NAMES as readonly string[]).includes(name)

/**
 * The only way into a handler, for every transport: the method must be in
 * the registry and allowed on this transport, and the input must match its
 * schema. Outputs are checked against theirs when `checkOutputs` is on
 * (tests and unpackaged builds), so a drift shows up before a client sees it.
 */
export async function dispatch(handlers: Handlers, name: string, raw: unknown, ctx: CallContext, checkOutputs: boolean): Promise<unknown> {
  if (!isMethod(name)) throw new ContractError('unknown_method', `Unknown method: ${name}`)
  if (!availableOn(ctx.transport, name)) throw new ContractError('not_available', `${name} is only available on the computer running Revive`)
  const def = METHODS[name]
  const parsed = def.input.safeParse(raw)
  if (!parsed.success) throw new ContractError('bad_input', `${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`)
  const handler = handlers[name] as (input: unknown, ctx: CallContext) => unknown
  const out = await handler(parsed.data, ctx)
  if (checkOutputs) {
    const check = def.output.safeParse(out)
    if (!check.success) throw new ContractError('bad_output', `${name} returned something outside the contract: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return out
}

/** Where keystrokes and resizes go: this computer's sessions, or the Host's in client mode. */
export interface SessionSink {
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
}

export function hubSink(hub: SessionHub): SessionSink {
  const get = (id: string) => {
    const ref = parseSessionId(id)
    return ref ? hub.get(ref) : undefined
  }
  return {
    write: (id, data) => get(id)?.write(data),
    resize: (id, cols, rows) => get(id)?.resize(cols, rows)
  }
}

/** Keystrokes and resizes into a session. Invalid messages are dropped, never thrown back. */
export function handleClientStream(sink: SessionSink, stream: string, raw: unknown): boolean {
  if (!(CLIENT_STREAMS as readonly string[]).includes(stream)) return false
  const parsed = CLIENT_STREAM_SCHEMAS[stream as ClientStreamName].safeParse(raw)
  if (!parsed.success) return false
  if ('data' in parsed.data) sink.write(parsed.data.sessionId, parsed.data.data)
  else sink.resize(parsed.data.sessionId, parsed.data.cols, parsed.data.rows)
  return true
}

/**
 * Records every mutating call in the action log, with the device that asked,
 * then runs it. Wraps the handlers that actually do the work (on the Host);
 * calls forwarded to another computer are logged there, not here.
 */
export function withActionLog<H extends Partial<Handlers>>(handlers: H, log: { record(e: { deviceId: string; deviceName: string; method: string; input: unknown }): void }): H {
  const wrapped = { ...handlers } as Record<string, (input: unknown, ctx: CallContext) => unknown>
  for (const name of METHOD_NAMES) {
    const def: { mutates: boolean } = METHODS[name]
    const inner = (handlers as Record<string, ((input: unknown, ctx: CallContext) => unknown) | undefined>)[name]
    if (!def.mutates || !inner) continue
    wrapped[name] = (input, ctx) => {
      log.record({ deviceId: ctx.device.id, deviceName: ctx.device.name, method: name, input })
      return inner(input, ctx)
    }
  }
  return wrapped as unknown as H
}
