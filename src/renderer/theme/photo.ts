import { MAX_PHOTO_BYTES } from '@shared/appearance'
import { luminance, toHex } from './contrast'

/**
 * Makes a picked photo small enough to store (JPEG, at most 1920 px on its
 * long side, under the size limit) and finds its brightest spot after a
 * blur, which is what the dimming is computed from. Runs on the device:
 * the Host only ever receives the small JPEG.
 */
export async function preparePhoto(file: Blob): Promise<{ jpegBase64: string; worst: string; dataUrl: string }> {
  const src = await readAsDataUrl(file)
  const img = await load(src)
  const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)

  let dataUrl = ''
  for (const quality of [0.82, 0.72, 0.6, 0.5, 0.4]) {
    dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (base64Bytes(dataUrl) <= MAX_PHOTO_BYTES) break
  }
  if (base64Bytes(dataUrl) > MAX_PHOTO_BYTES) throw new Error('photo too large')
  return { jpegBase64: dataUrl.slice(dataUrl.indexOf(',') + 1), worst: brightestSpot(img), dataUrl }
}

/** The photo averaged down to 24 × 24 (roughly what the background blur does), then its brightest cell. */
export function brightestSpot(img: CanvasImageSource): string {
  const c = document.createElement('canvas')
  c.width = 24
  c.height = 24
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, 24, 24)
  const data = ctx.getImageData(0, 0, 24, 24).data
  return brightestOf(data)
}

/** The brightest of RGBA pixels, as a hex color. */
export function brightestOf(data: ArrayLike<number>): string {
  let best = { r: 0, g: 0, b: 0, a: 1 }
  let bestL = -1
  for (let i = 0; i + 3 < data.length; i += 4) {
    const px = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: 1 }
    const l = luminance(px)
    if (l > bestL) {
      bestL = l
      best = px
    }
  }
  return toHex(best)
}

function base64Bytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.floor((b64.length * 3) / 4)
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('could not read the photo'))
    r.readAsDataURL(file)
  })
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('not a picture'))
    img.src = src
  })
}
