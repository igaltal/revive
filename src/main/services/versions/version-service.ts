import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { summarize, VERSION_ID, type RestorePreview, type RestoreResult, type TrashInfo, type VersionKind, type VersionRecord, type VersionSummary } from '@shared/versions'
import type { Project } from '@shared/manifest'
import type { RuntimeBus } from '../runtime-bus'
import { readManifest, updateProject } from '../../manifest-store'
import { emptyTrash, moveAside, planRestore, readVersions, restoreFiles, saveVersion, snapshotParts, trashInfo } from '../../versions/snapshot'

/** Inputs are checked here, whichever transport they came through. Bad input rejects; it never throws synchronously. */
export const VersionInput = z.object({ versionId: z.string().regex(VERSION_ID) })
export const EmptyTrashInput = z.object({ confirm: z.literal(true) })

export const RESTORE_TITLE = { en: 'Before going back to an earlier version', he: 'לפני החזרה לגרסה קודמת' }
export const UNDO_TITLE = { en: 'Before undoing a go back', he: 'לפני ביטול החזרה' }
export const MANUAL_TITLE = { en: 'Saved by you', he: 'נשמרה ידנית' }

export interface VersionServiceDeps {
  bus: RuntimeBus
  /** The chosen folder. */
  folder: () => Promise<string>
  runner: { get(projectId: string): { status: string } | null; stop(projectId: string): Promise<unknown> }
  /** True while a scan is reading the folder: versions wait for it. */
  scanning: () => boolean
}

const RUNNING = new Set(['installing', 'starting', 'checking', 'running'])

/** A project is touched by a change when the path is inside its folder. */
const touches = (p: Project, rel: string) => p.path === '.' || rel === p.path || rel.startsWith(`${p.path}/`)

/**
 * Saved versions: list, save, go back, undo, and the trash. Plain TypeScript;
 * the IPC handlers (and a future network server) are thin adapters.
 *
 * Going back never loses anything: the folder is saved first (that saved
 * version is the undo), files made since are moved to .revive/trash rather
 * than deleted, and keys (.env), dependencies and ignored files are never
 * part of a version, so they are never touched.
 */
export class VersionService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: VersionServiceDeps) {}

  async list(): Promise<VersionSummary[]> {
    return (await readVersions(await this.deps.folder())).map(summarize).reverse()
  }

  save(): Promise<VersionSummary> {
    return this.serial(async () => this.record(await saveVersion(await this.deps.folder(), MANUAL_TITLE, 'manual')))
  }

  /** What going back would change. Nothing is written. */
  async preview(input: unknown): Promise<RestorePreview | null> {
    const { versionId } = VersionInput.parse(input)
    return this.serial(async () => {
      const folder = await this.deps.folder()
      const target = (await readVersions(folder)).find((v) => v.id === versionId)
      if (!target) return null
      const now: VersionRecord = { ...target, id: 'now', parts: await snapshotParts(folder) }
      const plan = await planRestore(folder, now, target)
      const projects = await this.projects(folder)
      const affected = projects.filter((p) => [...plan.write, ...plan.remove].some((rel) => touches(p, rel)))
      return {
        versionId,
        changedFiles: plan.write.length,
        newFiles: plan.remove.length,
        sample: [...plan.write, ...plan.remove].slice(0, 20),
        willStop: affected.filter((p) => RUNNING.has(this.deps.runner.get(p.id)?.status ?? '')).map((p) => p.id)
      }
    })
  }

  /** Brings back a saved version of the whole folder. */
  async restore(input: unknown): Promise<RestoreResult> {
    return this.bringBack(VersionInput.parse(input).versionId, RESTORE_TITLE, 'restore')
  }

  /** Undoes a go back: brings back the version saved just before it. */
  async undo(input: unknown): Promise<RestoreResult> {
    return this.bringBack(VersionInput.parse(input).versionId, UNDO_TITLE, 'undo')
  }

  async trash(): Promise<TrashInfo> {
    return trashInfo(await this.deps.folder())
  }

  /** Permanently removes what earlier restores moved aside. Needs `{ confirm: true }`. */
  async emptyTrash(input: unknown): Promise<TrashInfo> {
    EmptyTrashInput.parse(input)
    return this.serial(async () => {
      const folder = await this.deps.folder()
      const removedItems = await emptyTrash(folder)
      this.deps.bus.emit({ type: 'trash.emptied', removedItems })
      return trashInfo(folder)
    })
  }

  /** Resolves when no version operation is running (a scan waits for this). */
  async whenIdle(): Promise<void> {
    await this.queue
  }

  /** For the scan pipeline, which saves its own version first. */
  announce(record: VersionRecord): void {
    this.record(record)
  }

  private bringBack(versionId: string, title: VersionRecord['title'], kind: VersionKind): Promise<RestoreResult> {
    if (this.deps.scanning()) return Promise.resolve({ ok: false, code: 'busy' })
    return this.serial(async (): Promise<RestoreResult> => {
      const folder = await this.deps.folder()
      const target = (await readVersions(folder)).find((v) => v.id === versionId)
      if (!target) return { ok: false, code: 'not_found' }
      const projects = await this.projects(folder)

      // 1. Stop what's running in the projects this will change, so no dev server writes mid-restore.
      //    Compare against a snapshot first, to know which projects those are.
      const probe = await planRestore(folder, { ...target, id: 'now', parts: await snapshotParts(folder) }, target)
      const touched = (plan: typeof probe) => projects.filter((p) => [...plan.write, ...plan.remove].some((rel) => touches(p, rel)))
      const stoppedProjects: string[] = []
      for (const p of touched(probe)) {
        if (RUNNING.has(this.deps.runner.get(p.id)?.status ?? '')) {
          await this.deps.runner.stop(p.id)
          stoppedProjects.push(p.id)
        }
      }

      // 2. Save the folder as it is now. Going back to this version is the undo.
      let before: VersionRecord
      try {
        before = await saveVersion(folder, title, kind, { restoredFrom: versionId })
      } catch (e) {
        return { ok: false, code: 'failed', detail: String((e as Error).message ?? e) }
      }
      this.record(before)

      // 3. Put files back; move files made since into the trash (never delete).
      const plan = await planRestore(folder, before, target)
      const movedToTrash = await moveAside(folder, 'trash', plan.remove)
      const { restored } = await restoreFiles(folder, target, plan.write)

      // 4. The code changed, so "checked and working" no longer holds for those projects.
      const affected = touched(plan)
      for (const p of affected) {
        await updateProject(folder, p.id, (x) => {
          x.status = 'unknown'
          x.run.verified_at = null
        })
      }
      if (affected.length) this.deps.bus.emit({ type: 'manifest.changed' })

      const changedFiles = restored.length + movedToTrash.length
      this.deps.bus.emit({ type: 'version.restored', how: kind === 'undo' ? 'undo' : 'restore', versionId, undoVersionId: before.id, changedFiles, stoppedProjects })
      return {
        ok: true,
        versionId,
        undoVersionId: before.id,
        changedFiles,
        movedToTrash,
        stoppedProjects,
        missingProjects: projects.filter((p) => !existsSync(join(folder, p.path))).map((p) => p.id)
      }
    })
  }

  private record(record: VersionRecord): VersionSummary {
    const summary = summarize(record)
    this.deps.bus.emit({ type: 'version.saved', version: summary })
    return summary
  }

  private async projects(folder: string): Promise<Project[]> {
    const r = await readManifest(folder)
    return r?.ok ? r.manifest.projects : []
  }

  /** One version operation at a time. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }
}
