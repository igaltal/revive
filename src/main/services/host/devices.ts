import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

const DeviceRecord = z.object({
  id: z.string(),
  name: z.string(),
  /** sha256 of the token. The token itself is never stored on the Host. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable()
})
export type DeviceRecord = z.infer<typeof DeviceRecord>
const DevicesFile = z.object({ devices: z.array(DeviceRecord) })

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex')

/**
 * Paired devices, in userData/devices.json. Each device has its own token;
 * the Host keeps only its hash. Revoked devices stay listed in the file (so
 * the log keeps its names) and their tokens never work again.
 */
export class DeviceRegistry {
  private devices: DeviceRecord[]

  constructor(private readonly file: string) {
    this.devices = this.load()
  }

  /** Issues a new device and its token. The token is returned once, here, and never again. */
  add(name: string): { device: DeviceRecord; token: string } {
    const token = randomBytes(32).toString('base64url')
    const device: DeviceRecord = { id: randomUUID(), name, tokenHash: hash(token), createdAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null }
    this.devices.push(device)
    this.save()
    return { device, token }
  }

  /** The active device this token belongs to, or null. Compares hashes in constant time. */
  verify(token: string): DeviceRecord | null {
    const given = Buffer.from(hash(token), 'hex')
    for (const d of this.devices) {
      if (d.revokedAt) continue
      if (timingSafeEqual(given, Buffer.from(d.tokenHash, 'hex'))) return d
    }
    return null
  }

  get(id: string): DeviceRecord | undefined {
    return this.devices.find((d) => d.id === id)
  }

  active(): DeviceRecord[] {
    return this.devices.filter((d) => !d.revokedAt)
  }

  touch(id: string): void {
    const d = this.get(id)
    if (!d) return
    d.lastSeenAt = new Date().toISOString()
    this.save()
  }

  revoke(id: string): boolean {
    const d = this.get(id)
    if (!d || d.revokedAt) return false
    d.revokedAt = new Date().toISOString()
    this.save()
    return true
  }

  private load(): DeviceRecord[] {
    try {
      return DevicesFile.parse(JSON.parse(readFileSync(this.file, 'utf8'))).devices
    } catch {
      return []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ devices: this.devices }, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
