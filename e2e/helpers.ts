import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'revive-e2e-'))
}

/** A throwaway copy of the fixture folder, so tests never touch the repo. */
export function sampleFolder(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'revive-folder-')), 'my-ai-projects')
  cpSync('fixtures/sample-folder', dir, { recursive: true })
  return dir
}

export function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], env: { ...process.env, REVIVE_USER_DATA: userData } })
}

/** The native folder dialog can't be clicked by Playwright; answer it from the main process. */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}
