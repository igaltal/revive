import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import type { Manifest } from '@shared/manifest'
import { PROJECT_MARKERS, type ScanDone, type ScanProgress } from '@shared/scan'
import { redact } from '@shared/redact'
import { backupManifest, manifestPath, mergeAfterScan, readManifest, restoreManifestBackup, writeManifest, writeSchema } from '../manifest-store'
import { ensureReviveDir, moveAside, restoreFiles, saveVersion } from '../versions/snapshot'
import { diffFingerprints, fingerprint, isClean } from './fs-fingerprint'
import type { AgentAdapter } from './agent-adapter'

export const SCAN_VERSION_TITLE = { en: 'Before reading the folder', he: 'לפני קריאת התיקייה' }

/** Keeps a rejected manifest for inspection instead of deleting it (it's Revive's own file). */
async function setAsideRejected(folder: string): Promise<void> {
  if (existsSync(manifestPath(folder))) await rename(manifestPath(folder), join(folder, '.revive', 'manifest.rejected.json'))
  await restoreManifestBackup(folder)
}

export async function runScan(
  folder: string,
  deps: { adapter: AgentAdapter; model: string; scanId: string; signal: AbortSignal; onProgress: (p: ScanProgress) => void }
): Promise<ScanDone> {
  const { scanId } = deps
  const progress: ScanProgress = { scanId, phase: 'saving', filesRead: 0, projectsFound: [], recent: [] }
  const emit = () => deps.onProgress({ ...progress, projectsFound: [...progress.projectsFound], recent: [...progress.recent] })
  emit()

  await ensureReviveDir(folder)
  const previousRead = await readManifest(folder)
  const previous: Manifest | null = previousRead?.ok ? previousRead.manifest : null

  // 1. Nothing happens without a saved version first.
  let version
  try {
    await writeSchema(folder)
    await backupManifest(folder)
    version = await saveVersion(folder, SCAN_VERSION_TITLE, 'scan')
  } catch (e) {
    return { scanId, ok: false, costUsd: null, error: { code: 'version_failed', detail: [redact(String((e as Error).message ?? e))] } }
  }
  const before = await fingerprint(folder)

  // 2. Claude reads the folder.
  progress.phase = 'reading'
  emit()
  const result = await deps.adapter.scan(folder, {
    model: deps.model,
    signal: deps.signal,
    onEvent: (e) => {
      if (e.kind !== 'read' || !e.path) return
      progress.filesRead += 1
      progress.recent = [...progress.recent, e.path].slice(-8)
      if ((PROJECT_MARKERS as readonly string[]).includes(basename(e.path))) {
        const dir = dirname(e.path) === '.' ? '.' : posix.normalize(dirname(e.path))
        if (!progress.projectsFound.includes(dir)) progress.projectsFound.push(dir)
      }
      emit()
    }
  })

  // 3. Check that nothing outside .revive/ changed, whatever happened above.
  progress.phase = 'checking'
  emit()
  const diff = diffFingerprints(before, await fingerprint(folder))
  if (!isClean(diff)) {
    const { restored, notInVersion } = await restoreFiles(folder, version, [...diff.modified, ...diff.removed])
    const quarantined = await moveAside(folder, 'quarantine', diff.added)
    await setAsideRejected(folder)
    return {
      scanId,
      ok: false,
      costUsd: result.costUsd,
      error: { code: 'modified_outside', restored, quarantined, unrestorable: notInVersion }
    }
  }

  if (!result.ok) {
    await restoreManifestBackup(folder)
    return { scanId, ok: false, costUsd: result.costUsd, error: { code: result.code, detail: result.detail } }
  }

  // 4. Validate what Claude wrote; keep the last good list if it's unusable.
  const next = await readManifest(folder)
  if (!next || !next.ok) {
    await setAsideRejected(folder)
    return { scanId, ok: false, costUsd: result.costUsd, error: { code: 'invalid_manifest', detail: next ? next.issues.slice(0, 20) : ['No manifest was written.'] } }
  }

  // 5. Claude describes, Revive decides (locked fields, status).
  const merged = mergeAfterScan(previous, next.manifest)
  await writeManifest(folder, merged)
  progress.phase = 'done'
  emit()
  return { scanId, ok: true, manifest: merged, costUsd: result.costUsd, versionId: version.id }
}
