import { randomInt, randomUUID } from 'node:crypto'
import type { DeviceRegistry } from './devices'

export const PAIRING = {
  codeTtlMs: 5 * 60_000,
  /** How long an allowed-or-not question waits on the Host. */
  requestTtlMs: 5 * 60_000,
  maxWrongTries: 5,
  lockMs: 10 * 60_000
} as const

export type SubmitResult = { ok: true; requestId: string } | { ok: false; reason: 'locked' | 'bad_code' | 'expired' | 'no_pairing' }

export type PollResult =
  | { state: 'pending' }
  | { state: 'approved'; deviceId: string; token: string }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'unknown' }

interface Request {
  id: string
  deviceName: string
  at: number
  state: 'pending' | 'approved' | 'denied'
  /** Handed to the device once, on its next poll, then forgotten. */
  issued?: { deviceId: string; token: string }
}

/** Printable text only, at most 60 characters: it's shown on the Host's screen. */
const cleanName = (name: string) =>
  [...name]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 60) || 'Unnamed device'

/**
 * Pairing a new device:
 * 1. The Host shows a six-digit code (single use, five minutes).
 * 2. The device sends the code and its name. Five wrong codes lock pairing for ten minutes.
 * 3. The Host asks "Allow <name> to connect?". Nothing is issued until the user allows it.
 * 4. The device's next poll receives its token, once.
 */
export class Pairing {
  private code: { value: string; expiresAt: number } | null = null
  private wrong = 0
  private lockedUntil = 0
  private readonly requests = new Map<string, Request>()

  constructor(
    private readonly devices: DeviceRegistry,
    private readonly onChange: () => void = () => {},
    private readonly now: () => number = Date.now
  ) {}

  /** A new code; any earlier one stops working. */
  start(): { code: string; expiresAt: number } {
    this.code = { value: String(randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: this.now() + PAIRING.codeTtlMs }
    this.onChange()
    return { code: this.code.value, expiresAt: this.code.expiresAt }
  }

  cancel(): void {
    this.code = null
    this.onChange()
  }

  /** The code on screen now, if it's still valid. */
  current(): { code: string; expiresAt: number } | null {
    if (!this.code || this.code.expiresAt <= this.now()) return null
    return { code: this.code.value, expiresAt: this.code.expiresAt }
  }

  locked(): number | null {
    return this.lockedUntil > this.now() ? this.lockedUntil : null
  }

  submit(code: string, deviceName: string): SubmitResult {
    const now = this.now()
    if (this.lockedUntil > now) return { ok: false, reason: 'locked' }
    if (!this.code) return this.wrongTry('no_pairing')
    if (this.code.expiresAt <= now) {
      const same = code === this.code.value
      this.code = null
      this.onChange()
      return same ? { ok: false, reason: 'expired' } : this.wrongTry('bad_code')
    }
    if (code !== this.code.value) return this.wrongTry('bad_code')

    // Right code: it's used up, whatever the Host answers.
    this.code = null
    this.wrong = 0
    const request: Request = { id: randomUUID(), deviceName: cleanName(deviceName), at: now, state: 'pending' }
    this.requests.set(request.id, request)
    this.onChange()
    return { ok: true, requestId: request.id }
  }

  /** Waiting for the user on the Host. */
  pending(): Array<{ id: string; deviceName: string; at: number }> {
    this.expireRequests()
    return [...this.requests.values()].filter((r) => r.state === 'pending').map(({ id, deviceName, at }) => ({ id, deviceName, at }))
  }

  /** The user's answer on the Host. Only now is a device (and its token) created. */
  answer(requestId: string, allow: boolean): boolean {
    this.expireRequests()
    const r = this.requests.get(requestId)
    if (!r || r.state !== 'pending') return false
    if (allow) {
      const { device, token } = this.devices.add(r.deviceName)
      r.issued = { deviceId: device.id, token }
      r.state = 'approved'
    } else {
      r.state = 'denied'
    }
    this.onChange()
    return true
  }

  /** The device asks how its request went. An approved token is handed out once. */
  poll(requestId: string): PollResult {
    const r = this.requests.get(requestId)
    if (!r) return { state: 'unknown' }
    if (r.state === 'pending') {
      if (this.now() - r.at > PAIRING.requestTtlMs) {
        this.requests.delete(requestId)
        this.onChange()
        return { state: 'expired' }
      }
      return { state: 'pending' }
    }
    this.requests.delete(requestId)
    if (r.state === 'denied' || !r.issued) return { state: 'denied' }
    return { state: 'approved', ...r.issued }
  }

  private wrongTry(reason: 'bad_code' | 'no_pairing'): SubmitResult {
    this.wrong += 1
    if (this.wrong >= PAIRING.maxWrongTries) {
      this.wrong = 0
      this.code = null
      this.lockedUntil = this.now() + PAIRING.lockMs
      this.onChange()
      return { ok: false, reason: 'locked' }
    }
    return { ok: false, reason }
  }

  private expireRequests(): void {
    const now = this.now()
    for (const [id, r] of this.requests) if (r.state === 'pending' && now - r.at > PAIRING.requestTtlMs) this.requests.delete(id)
  }
}
