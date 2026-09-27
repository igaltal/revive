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

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly runner: Runner,
    bus: RuntimeBus
  ) {
    // When the project stops, its picture goes away with it.
    bus.subscribe((e) => {
      if (e.type === 'status.changed' && e.state.projectId === this.shown?.projectId && e.state.status !== 'running') {
        this.hide()
        this.shown = null
        void this.view?.webContents.loadURL('about:blank').catch(() => {})
      }
    })
  }

  show(projectId: string, bounds: Bounds, device: PreviewDevice): void {
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

  hide(): void {
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
