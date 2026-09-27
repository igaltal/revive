import { BrowserWindow } from 'electron'
import { guardPreviewContents, isLocalUrl, previewSession } from './preview-session'

const SIZE = { width: 1280, height: 800 }
const LOAD_TIMEOUT_MS = 20_000
/** Give the page a moment to draw fonts and pictures after it loads. */
const SETTLE_MS = 1500

/** Takes a picture of a local page offscreen, whether or not the preview is visible. */
export async function capturePage(url: string): Promise<Buffer | null> {
  if (!isLocalUrl(url)) return null
  const win = new BrowserWindow({
    show: false,
    ...SIZE,
    webPreferences: { offscreen: true, session: previewSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    guardPreviewContents(win.webContents)
    win.webContents.setAudioMuted(true)
    win.webContents.setFrameRate(10)
    await Promise.race([win.loadURL(url).catch(() => {}), new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS))])
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    const image = await win.webContents.capturePage()
    return image.isEmpty() ? null : image.toPNG()
  } catch {
    return null
  } finally {
    win.destroy()
  }
}
