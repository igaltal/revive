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

import { resolve } from 'node:path'

/** Launches the built app with throwaway settings and the offline stand-in for Claude. */
export function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  const base = { ...process.env } as Record<string, string>
  return electron.launch({
    args: ['.'],
    env: { ...base, REVIVE_USER_DATA: userData, REVIVE_TEST_AGENT: resolve('fixtures/sample-folder.manifest.json'), ...env }
  })
}

/** The native folder dialog can't be clicked by Playwright; answer it from the main process. */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}
