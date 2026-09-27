import { realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { FolderCheck } from '@shared/folder'
import type { SettingsStore } from '../settings-store'
import { addRecent, checkFolder } from '../folders'
import { readManifest, updateProject } from '../manifest-store'
import type { ProjectSource, ResolvedProject, RunRecord } from './runner/runner'

/**
 * The folder the user chose, and the projects in it. Clients never name a
 * folder or a path: they name a project id, and this resolves it.
 */
export class Workspace implements ProjectSource {
  constructor(
    private readonly settings: SettingsStore,
    /** Called before the folder changes, so nothing keeps running in the old one. */
    private readonly beforeChange: () => Promise<void>
  ) {}

  async current(): Promise<string> {
    const folder = this.settings.get().lastFolder
    if (!folder) throw new Error('No folder chosen')
    const check = await checkFolder(folder)
    if (!check.ok) throw new Error(`Folder unavailable: ${check.problem}`)
    return check.path
  }

  /** Validates, then remembers the folder as current and recent. */
  async choose(path: string): Promise<FolderCheck> {
    const check = await checkFolder(path)
    if (!check.ok) return check
    if (check.path !== this.settings.get().lastFolder) await this.beforeChange()
    this.settings.update({ lastFolder: check.path, recentFolders: addRecent(this.settings.get().recentFolders, check.path) })
    return check
  }

  async projectIds(): Promise<{ folder: string; projectIds: Set<string> } | null> {
    try {
      const folder = await this.current()
      const r = await readManifest(folder)
      return r?.ok ? { folder, projectIds: new Set(r.manifest.projects.map((p) => p.id)) } : null
    } catch {
      return null
    }
  }

  async resolve(projectId: string): Promise<ResolvedProject> {
    const folder = await this.current()
    const r = await readManifest(folder)
    if (!r?.ok) throw new Error('No readable project list')
    const project = r.manifest.projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Unknown project: ${projectId}`)
    // The manifest path is relative and checked by the schema; symlinks must not lead outside either.
    const dir = await realpath(resolve(folder, project.path))
    if (dir !== folder && !dir.startsWith(folder + sep)) throw new Error('Project folder is outside the chosen folder')
    if (!(await stat(dir)).isDirectory()) throw new Error('Project folder is missing')
    return { dir, project }
  }

  async record(projectId: string, rec: RunRecord): Promise<void> {
    await updateProject(await this.current(), projectId, (p) => {
      if (rec.status) p.status = rec.status
      if (rec.verifiedAt) p.run.verified_at = rec.verifiedAt
      if (rec.port !== undefined) p.run.port = rec.port
      if (rec.url !== undefined) p.run.url = rec.url
    })
  }
}
