import { shell, WebContentsView, type BrowserWindow } from 'electron'
import type { Bounds, PreviewDevice } from '@shared/ipc'
import type { RuntimeBus } from '../runtime-bus'
import type { Runner } from '../runner/runner'
import { guardPreviewContents, isLocalUrl, previewSession } from './preview-session'
import { fitBounds } from './fit'

/**
 * The live preview: one WebContentsView laid over the spot the renderer
 * reserves for it. Local to this app; other clients open the URL stored in
 * the manifest instead.
 */
export class PreviewManager {
  private view: WebContentsView | null = null
  private shown: { projectId: string; url: string } | null = null
  /** Something is drawn over the preview's spot: keep the native view hidden. */
  private covered = false
  /** A cover is picturing the view: a hide now would leave an empty picture, so it waits for the cover. */
  private capturing = false

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly runner: Runner,
    bus: RuntimeBus,
    /** Stores a picture of what the preview showed, as the project's latest picture. */
    private readonly onSnapshot: (projectId: string, png: Buffer) => Promise<void> = async () => {}
  ) {
    // When the project stops, its picture goes away with it.
    bus.subscribe((e) => {
      if (e.type === 'status.changed' && e.state.projectId === this.shown?.projectId && e.state.status !== 'running') {
        this.detach()
        this.shown = null
        void this.view?.webContents.loadURL('about:blank').catch(() => {})
      }
    })
  }

  show(projectId: string, bounds: Bounds, device: PreviewDevice): void {
    // A native view always draws on top of the page, so it stays hidden while anything covers it.
    if (this.covered) return
    const state = this.runner.get(projectId)
    const win = this.getWindow()
    if (!win || win.isDestroyed() || state?.status !== 'running' || !state.url || !isLocalUrl(state.url)) return this.hide()

    if (!this.view) {
      this.view = new WebContentsView({ webPreferences: { session: previewSession(), sandbox: true, contextIsolation: true, nodeIntegration: false } })
      this.view.setBackgroundColor('#FFFFFF')
      guardPreviewContents(this.view.webContents)
    }
    if (!win.contentView.children.includes(this.view)) win.contentView.addChildView(this.view)
    this.view.setBounds(fitBounds(bounds, device))
    if (this.shown?.projectId !== projectId || this.shown.url !== state.url) {
      this.shown = { projectId, url: state.url }
      void this.view.webContents.loadURL(state.url).catch(() => {})
    }
  }

  /**
   * A dialog, menu or sheet is about to open over the preview. Takes a picture
   * of what the preview shows right now (it becomes the latest picture, shown
   * in the view's place), then hides the view. Resolves once it's hidden.
   */
  async cover(): Promise<void> {
    this.covered = true
    const win = this.getWindow()
    if (this.view && this.shown && win && !win.isDestroyed() && win.contentView.children.includes(this.view)) {
      this.capturing = true
      try {
        const image = await this.view.webContents.capturePage()
        if (!image.isEmpty()) await this.onSnapshot(this.shown.projectId, image.toPNG())
      } catch {
        // The last picture stays; covering must never fail.
      } finally {
        this.capturing = false
      }
    }
    this.detach()
  }

  /** The last overlay closed. The renderer shows the view again at its current spot. */
  uncover(): void {
    this.covered = false
  }

  hide(): void {
    if (this.capturing) return
    this.detach()
  }

  private detach(): void {
    const win = this.getWindow()
    if (this.view && win && !win.isDestroyed() && win.contentView.children.includes(this.view)) win.contentView.removeChildView(this.view)
  }

  reload(): void {
    this.view?.webContents.reload()
  }

  async openInBrowser(projectId: string): Promise<void> {
    const url = this.runner.get(projectId)?.url
    if (url && isLocalUrl(url)) await shell.openExternal(url)
  }

  /** The window is gone: drop the view with it. */
  reset(): void {
    this.view = null
    this.shown = null
  }
}
