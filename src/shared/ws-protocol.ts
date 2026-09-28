/**
 * The wire format between WsTransport and main's WebSocket server.
 * Text frames carry JSON calls, results and stream events; binary frames
 * carry session output. Works in browsers and Node (no Buffer).
 */
export const WS_PROTOCOL = 'revive.v1'
/** The device token travels as a second subprotocol: browsers can't set headers on a WebSocket. */
export const WS_TOKEN_PREFIX = 'revive.token.'
/** Close code for a device that was revoked (or whose token isn't valid any more). */
export const CLOSE_REVOKED = 4401

export type ClientMessage =
  | { t: 'call'; id: number; m: string; i: unknown }
  /** Start streaming a session's output from `o` (bytes); the server first sends what's buffered. */
  | { t: 'watch'; s: string; o: number; e?: string }
  | { t: 'unwatch'; s: string }
  | { t: 'input'; s: string; d: string }
  | { t: 'resize'; s: string; c: number; r: number }
  /** Stream every session's output, each from wherever it is now (the desktop client's main process). */
  | { t: 'watchAll' }
  /** Heartbeat; the server answers pong. */
  | { t: 'ping' }

export type ServerMessage =
  | { t: 'ret'; id: number; ok: true; v: unknown }
  | { t: 'ret'; id: number; ok: false; e: { code: string; message: string } }
  | { t: 'ev'; s: string; p: unknown }
  | { t: 'pong' }

export interface OutputFrameHeader {
  /** Session id. */
  s: string
  /** Where the data starts in the session buffer (bytes). */
  o: number
  /** The buffer's lifetime. */
  e: string
  /** Output before `o` that this client hadn't seen was dropped from the buffer. */
  tr?: boolean
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** [u32 header length, big-endian][header JSON][output, UTF-8] */
export function encodeOutputFrame(header: OutputFrameHeader, data: string): Uint8Array {
  const h = encoder.encode(JSON.stringify(header))
  const d = encoder.encode(data)
  const out = new Uint8Array(4 + h.length + d.length)
  new DataView(out.buffer).setUint32(0, h.length)
  out.set(h, 4)
  out.set(d, 4 + h.length)
  return out
}

export function decodeOutputFrame(frame: ArrayBuffer | Uint8Array): { header: OutputFrameHeader; data: string } {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  const header = JSON.parse(decoder.decode(bytes.subarray(4, 4 + len))) as OutputFrameHeader
  return { header, data: decoder.decode(bytes.subarray(4 + len)) }
}

export const byteLength = (text: string) => encoder.encode(text).length
