/**
 * Host mode (this computer shares itself) and client mode (this app is a
 * window onto another computer). See docs/HOST_PRD.md, H1, H7, H8.
 */

export interface PairingCode {
  /** Six digits, single use. */
  code: string
  expiresAt: string
  /** The pairing link the QR code holds. */
  link: string
  /** The QR code of `link`, as SVG markup. */
  qrSvg: string
}

export interface PairingRequest {
  id: string
  deviceName: string
  at: string
}

export interface DeviceInfo {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
  /** Connected right now. */
  online: boolean
}

export interface HostStatus {
  /** Whether this computer is shared with paired devices. */
  sharing: boolean
  /** The local port the Host listens on (127.0.0.1 only). */
  port: number | null
  hostName: string
  tailscale: {
    state: 'missing' | 'available' | 'serving' | 'error'
    /** https address on the tailnet, once `tailscale serve` runs. */
    address: string | null
    detail?: string
  }
  /** Minutes until the Mac sleeps on its own (0 = never), null if unknown. */
  sleepMinutes: number | null
  startAtLogin: boolean
  pairing: PairingCode | null
  /** Pairing is locked after too many wrong codes, until this time. */
  lockedUntil: string | null
  requests: PairingRequest[]
  devices: DeviceInfo[]
}

export type ClientState = 'local' | 'pairing' | 'waiting' | 'open' | 'reconnecting' | 'rejected'
export type ClientProblem = 'bad_code' | 'locked' | 'expired' | 'denied' | 'unreachable' | 'revoked' | 'no_keychain'

export interface ActivityEntry {
  at: string
  /** 'local' for this computer's own window. */
  deviceId: string
  deviceName: string
  method: string
  /** What was asked, without file contents or secret values. */
  summary: Record<string, string | number | boolean>
}

/** Where this machine's device id comes from when a call didn't arrive over the network. */
export const LOCAL_DEVICE = { id: 'local', name: 'This computer' } as const
