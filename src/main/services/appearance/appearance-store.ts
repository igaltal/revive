import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppearancePatchSchema, AppearanceSchema, DEFAULT_APPEARANCE, MAX_PHOTO_BYTES, MAX_PHOTOS, PHOTO_ID, type Appearance, type AppearancePatch, type Photo } from '@shared/appearance'

/**
 * How Revive looks, one set per device: `appearance.json` in userData, plus
 * each device's photos under `photos/<device>/`. The device is always the
 * one making the call (from its token), never a name in the request, so one
 * device can't read or change another's look or photos.
 */
export class AppearanceStore {
  private readonly file: string
  private readonly photosRoot: string
  private all: Record<string, Appearance>

  constructor(userData: string) {
    this.file = join(userData, 'appearance.json')
    this.photosRoot = join(userData, 'photos')
    this.all = this.load()
  }

  get(deviceId: string): Appearance {
    return structuredClone(this.all[deviceId] ?? DEFAULT_APPEARANCE)
  }

  set(deviceId: string, patch: AppearancePatch): Appearance {
    const parsed = AppearancePatchSchema.parse(patch)
    const current = this.get(deviceId)
    const next = AppearanceSchema.parse({ ...current, ...parsed })
    // A background must be one of this device's own photos.
    if (next.background && !next.photos.some((p) => p.id === next.background)) next.background = null
    this.all[deviceId] = next
    this.save()
    return structuredClone(next)
  }

  /** Stores a JPEG for this device. Refuses anything that isn't one, or too many. */
  addPhoto(deviceId: string, jpeg: Buffer, worst: string): Photo {
    if (jpeg.length > MAX_PHOTO_BYTES) throw new Error('photo too large')
    // JPEG starts with FF D8 FF and ends with FF D9.
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) throw new Error('not a JPEG')
    const current = this.get(deviceId)
    if (current.photos.length >= MAX_PHOTOS) throw new Error('too many photos')
    const photo: Photo = { id: randomBytes(12).toString('hex'), worst: worst.toLowerCase(), addedAt: new Date().toISOString() }
    const file = this.photoFile(deviceId, photo.id)!
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, jpeg, { mode: 0o600 })
    this.all[deviceId] = { ...current, photos: [...current.photos, photo] }
    this.save()
    return photo
  }

  removePhoto(deviceId: string, id: string): Appearance {
    const current = this.get(deviceId)
    const file = this.photoFile(deviceId, id)
    if (file && existsSync(file)) unlinkSync(file)
    const next: Appearance = { ...current, photos: current.photos.filter((p) => p.id !== id), background: current.background === id ? null : current.background }
    this.all[deviceId] = next
    this.save()
    return structuredClone(next)
  }

  /** The file of one of this device's photos, or null when it isn't this device's. */
  photoFile(deviceId: string, id: string): string | null {
    if (!PHOTO_ID.test(id)) return null
    return join(this.photosRoot, dirFor(deviceId), `${id}.jpg`)
  }

  ownsPhoto(deviceId: string, id: string): boolean {
    return (this.all[deviceId]?.photos ?? []).some((p) => p.id === id)
  }

  /** Devices that have a look of their own. */
  devices(): string[] {
    return Object.keys(this.all)
  }

  /** A revoked device's look and photos go with it. */
  forget(deviceId: string): void {
    if (!(deviceId in this.all)) return
    delete this.all[deviceId]
    rmSync(join(this.photosRoot, dirFor(deviceId)), { recursive: true, force: true })
    this.save()
  }

  private load(): Record<string, Appearance> {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { devices?: Record<string, unknown> }
      const out: Record<string, Appearance> = {}
      for (const [id, value] of Object.entries(raw.devices ?? {})) {
        // Fields added in newer versions get their defaults; a damaged entry falls back to the defaults.
        const parsed = AppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, ...(value as object) })
        if (parsed.success) out[id] = parsed.data
      }
      return out
    } catch {
      return {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ devices: this.all }, null, 2))
    renameSync(tmp, this.file)
  }
}

/** A folder name for a device id: fixed length, nothing to escape. */
function dirFor(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex').slice(0, 20)
}
