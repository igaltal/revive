import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** What Electron offers for this (app.isInApplicationsFolder, app.moveToApplicationsFolder) and a dialog. */
export interface MoveDeps {
  packaged: boolean
  inApplications: () => boolean
  move: () => boolean
  /** Returns the button index (0 move, 1 not now) and whether "don't ask again" was ticked. */
  ask: () => Promise<{ response: number; checkboxChecked: boolean }>
  /** Where "don't ask again" is remembered. */
  file: string
  /** Tests of the packaged app run it from a temporary folder on purpose. */
  skip: boolean
}

/**
 * Launched from the disk image or Downloads: offer to move Revive into
 * /Applications (where updates can replace it and it survives the DMG being
 * ejected). Asked once per launch until moved, unless "don't ask again".
 * Returns true when the app is being moved (Electron relaunches it from there).
 */
export async function offerMoveToApplications(d: MoveDeps): Promise<boolean> {
  if (!d.packaged || d.skip || d.inApplications()) return false
  if (declined(d.file)) return false
  const { response, checkboxChecked } = await d.ask()
  if (response === 0) {
    try {
      return d.move()
    } catch {
      return false
    }
  }
  if (checkboxChecked) {
    mkdirSync(dirname(d.file), { recursive: true })
    writeFileSync(d.file, JSON.stringify({ moveToApplications: 'declined' }))
  }
  return false
}

function declined(file: string): boolean {
  try {
    return existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as { moveToApplications?: string }).moveToApplications === 'declined'
  } catch {
    return false
  }
}

export function installFile(userData: string): string {
  return join(userData, 'install.json')
}
