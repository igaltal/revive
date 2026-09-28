import { CLIENT_STREAM_SCHEMAS, METHODS, availableOn, type ClientStreamName, type MethodInput, type MethodName, type MethodOutput, type TransportKind } from '@shared/contract'
import { METHOD_NAMES, CLIENT_STREAMS } from '@shared/contract-names'
import { parseSessionId } from '@shared/runtime'
import type { SessionHub } from '../services/sessions/session-hub'

export interface CallContext {
  transport: TransportKind
}

/** One function per contract method. The mapped type makes a missing or extra one a compile error. */
export type Handlers = { [M in MethodName]: (input: MethodInput<M>, ctx: CallContext) => MethodOutput<M> | Promise<MethodOutput<M>> }

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

/** Keystrokes and resizes into a session. Invalid messages are dropped, never thrown back. */
export function handleClientStream(hub: SessionHub, stream: string, raw: unknown): boolean {
  if (!(CLIENT_STREAMS as readonly string[]).includes(stream)) return false
  const parsed = CLIENT_STREAM_SCHEMAS[stream as ClientStreamName].safeParse(raw)
  if (!parsed.success) return false
  const ref = parseSessionId(parsed.data.sessionId)
  const session = ref ? hub.get(ref) : undefined
  if (!session) return false
  if ('data' in parsed.data) session.write(parsed.data.data)
  else session.resize(parsed.data.cols, parsed.data.rows)
  return true
}
