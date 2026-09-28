/** Keys a phone keyboard doesn't have, and what each sends to the terminal. */
export const KEY_ROW = ['esc', 'tab', 'ctrl', 'left', 'up', 'down', 'right', 'enter'] as const
export type RowKey = (typeof KEY_ROW)[number]

const ARROW: Record<'up' | 'down' | 'right' | 'left', string> = { up: 'A', down: 'B', right: 'C', left: 'D' }

/**
 * The bytes for one key. Arrows follow the terminal's cursor mode: normal
 * (ESC [ A) or application (ESC O A), which full-screen programs switch on.
 */
export function keySequence(key: Exclude<RowKey, 'ctrl'>, opts: { applicationCursor: boolean }): string {
  if (key === 'esc') return '\x1b'
  if (key === 'tab') return '\t'
  if (key === 'enter') return '\r'
  return `${opts.applicationCursor ? '\x1bO' : '\x1b['}${ARROW[key]}`
}

/** Ctrl + a key: letters and @[\]^_ become control codes (Ctrl C → 0x03); anything else is sent as is. */
export function withCtrl(data: string): string {
  if (data.length !== 1) return data
  const c = data.toUpperCase().charCodeAt(0)
  if (c >= 64 && c <= 95) return String.fromCharCode(c - 64)
  if (data === ' ') return '\x00'
  if (data === '?') return '\x7f'
  return data
}

export const FONT_SIZES = { min: 9, max: 24, default: 13 } as const
export const clampFont = (n: number) => Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, Math.round(n)))
