import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { parseManifest, type Manifest, type Project } from '@shared/manifest'
import { estimateCost, totalCost, UNDERSTAND_BATCH, type ScanCostPart, type ScanDone, type ScanProgress, type ScanSummary } from '@shared/scan'
import { redact } from '@shared/redact'
import { mergeAfterScan, readManifest, writeManifest } from '../manifest-store'
import { ensureReviveDir } from '../versions/snapshot'
import { detectProjects, type DetectedProject } from './detect'
import type { AgentAdapter, Understanding } from './agent-adapter'

/**
 * Reading a folder, in four steps:
 *
 * 1. Find the projects, on this computer: what each is made of, how it runs,
 *    which port, which keys (names only). Seconds, no AI, no cost.
 * 2. Compare with last time: a project whose files haven't changed keeps what
 *    was said about it.
 * 3. Put the new and changed ones into plain words: Claude gets a summary
 *    Revive made (never the files, no tools, a few projects per call, three
 *    calls at once) and answers with a name, one sentence in English and in
 *    Hebrew, what each key is for, and a few notes.
 * 4. Merge with what the person set by hand, and write .revive/manifest.json.
 *
 * Nothing but .revive/ is ever written, and Claude can't touch the folder at
 * all, so no version needs saving before a reading.
 */

const StateSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), z.object({ path: z.string(), fingerprint: z.string() }))
})
type ScanState = z.infer<typeof StateSchema>

const statePath = (folder: string) => join(folder, '.revive', 'scan-state.json')

async function readState(folder: string): Promise<ScanState> {
  try {
    return StateSchema.parse(JSON.parse(await readFile(statePath(folder), 'utf8')))
  } catch {
    return { version: 1, projects: {} }
  }
}

async function writeState(folder: string, state: ScanState): Promise<void> {
  const tmp = `${statePath(folder)}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n')
  await rename(tmp, statePath(folder))
}

/** A project needs Claude when it's new, its files changed, or nothing was ever said about it. */
export function needsUnderstanding(p: DetectedProject, prev: Project | undefined, state: ScanState): boolean {
  const known = state.projects[p.id]
  if (!prev || !known || known.path !== p.path || known.fingerprint !== p.fingerprint) return true
  return !prev.description.en.trim() || !prev.description.he.trim()
}

const EMPTY = { en: '', he: '' }

/** One project in the manifest: the facts Revive found, the words Claude wrote (or what was said before). */
export function toProject(p: DetectedProject, words: Understanding | undefined, prev: Project | undefined): Project {
  const prevKey = (k: string) => prev?.keys.find((x) => x.key === k)?.purpose
  const notes = words?.notes ?? prev?.notes.filter((n) => !/only in iCloud/.test(n)) ?? []
  const cloud = p.cloudOnly > 0 ? [`${p.cloudOnly} ${p.cloudOnly === 1 ? 'file is' : 'files are'} only in iCloud; Revive didn't download ${p.cloudOnly === 1 ? 'it' : 'them'} to read.`] : []
  return {
    id: p.id,
    name: words?.name ?? prev?.name ?? p.name,
    path: p.path,
    description: words ? { en: words.en, he: words.he } : (prev?.description ?? EMPTY),
    stack: p.stack,
    status: 'unknown',
    run: { install: p.run.install, dev: p.run.dev, port: p.run.port, url: p.run.port ? `http://localhost:${p.run.port}` : null, verified_at: null },
    keys: p.keys.map((k) => {
      const w = words?.keys.find((x) => x.key === k.key)
      return { key: k.key, required: k.required, purpose: w ? { en: w.en, he: w.he } : (prevKey(k.key) ?? EMPTY) }
    }),
    notes: [...notes, ...cloud].slice(0, 5),
    user_locked: []
  }
}

/** Runs `work` over `items` with at most `limit` at once. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!)
    })
  )
}

export async function runScan(
  folder: string,
  deps: {
    adapter: AgentAdapter
    model: string
    scanId: string
    signal: AbortSignal
    onProgress: (p: ScanProgress) => void
  }
): Promise<ScanDone> {
  const { scanId, signal } = deps
  const costParts: ScanCostPart[] = []
  const cost = () => ({ costUsd: totalCost(costParts), costParts: [...costParts] })
  const progress: ScanProgress = { scanId, phase: 'finding', projects: [], toUnderstand: 0, understood: 0, costUsd: null, estimateUsd: null }
  const emit = () => deps.onProgress({ ...progress, projects: progress.projects.map((p) => ({ ...p })) })
  const cancelled = (): ScanDone => ({ scanId, ok: false, ...cost(), error: { code: 'cancelled' } })
  emit()

  await ensureReviveDir(folder)
  const previousRead = await readManifest(folder)
  const previous: Manifest | null = previousRead?.ok ? previousRead.manifest : null
  const prevById = new Map(previous?.projects.map((p) => [p.id, p]) ?? [])
  const prevByPath = new Map(previous?.projects.map((p) => [p.path, p]) ?? [])
  const state = await readState(folder)

  // 1. Find the projects.
  const found = await detectProjects(folder, {
    signal,
    onProject: (p) => {
      progress.projects.push({ id: p.id, name: prevByPath.get(p.path)?.name ?? p.name, path: p.path, state: 'found', cloudOnly: p.cloudOnly })
      emit()
    }
  })
  if (signal.aborted) return cancelled()

  // 2. What changed since last time.
  const prevFor = (p: DetectedProject) => prevById.get(p.id) ?? prevByPath.get(p.path)
  const todo = found.projects.filter((p) => needsUnderstanding(p, prevFor(p), state))
  const setState = (id: string, s: ScanProgress['projects'][number]['state']) => {
    const row = progress.projects.find((r) => r.id === id)
    if (row) row.state = s
  }
  for (const p of found.projects) setState(p.id, todo.includes(p) ? 'waiting' : 'unchanged')
  progress.toUnderstand = todo.length
  progress.estimateUsd = estimateCost(deps.model, todo.length)
  progress.phase = 'understanding'
  emit()

  // 3. Put them into words.
  const words = new Map<string, Understanding>()
  const failed: string[] = []
  let stop: ScanDone | null = null
  if (todo.length > 0) {
    const ready = await deps.adapter.ready()
    if (!ready.ok) return { scanId, ok: false, ...cost(), error: { code: ready.code, detail: ready.detail } }
    const batches: DetectedProject[][] = []
    for (let i = 0; i < todo.length; i += UNDERSTAND_BATCH.size) batches.push(todo.slice(i, i + UNDERSTAND_BATCH.size))
    await pool(batches, UNDERSTAND_BATCH.parallel, async (batch) => {
      if (stop || signal.aborted) return
      for (const p of batch) setState(p.id, 'reading')
      emit()
      const r = await deps.adapter.understand(
        batch.map((p) => ({ id: p.id, path: p.path, stack: p.stack, commands: { install: p.run.install, dev: p.run.dev }, digest: p.digest })),
        { model: deps.model, signal }
      )
      costParts.push({ step: 'understand', model: deps.model, usd: r.costUsd })
      progress.costUsd = totalCost(costParts)
      if (r.ok) {
        for (const w of r.projects) if (batch.some((p) => p.id === w.id)) words.set(w.id, w)
      } else if (r.code === 'cancelled' || r.code === 'auth' || r.code === 'claude_missing' || r.code === 'unsafe_claude') {
        // These stop the whole reading; a limit or a bad answer only affects this batch.
        stop ??= r.code === 'cancelled' ? cancelled() : { scanId, ok: false, ...cost(), error: { code: r.code, detail: r.detail } }
      }
      for (const p of batch) {
        const ok = words.has(p.id)
        if (!ok) failed.push(p.id)
        setState(p.id, ok ? 'done' : 'failed')
        if (ok) progress.understood += 1
      }
      emit()
    })
  }
  if (signal.aborted) return cancelled()
  if (stop) return stop

  // 4. Merge with what the person set by hand, and write it down.
  const next: Manifest = {
    version: 2,
    scanned_at: new Date().toISOString(),
    projects: found.projects.map((p) => toProject(p, words.get(p.id), prevFor(p))),
    loose_files: found.looseFiles,
    suggested_reorg: previous?.suggested_reorg ?? []
  }
  const merged = mergeAfterScan(previous, next)
  const valid = parseManifest(merged)
  if (!valid.ok) return { scanId, ok: false, ...cost(), error: { code: 'invalid_manifest', detail: valid.issues.slice(0, 20).map((i) => redact(i)) } }
  progress.phase = 'checking'
  emit()
  await writeManifest(folder, valid.manifest)
  // Only projects that were put into words (or were already) count as known; failed ones are tried again next time.
  const known: ScanState = { version: 1, projects: {} }
  for (const p of found.projects) if (!failed.includes(p.id)) known.projects[p.id] = { path: p.path, fingerprint: p.fingerprint }
  await writeState(folder, known)

  const summary: ScanSummary = {
    found: found.projects.length,
    understood: words.size,
    unchanged: found.projects.length - todo.length,
    failed,
    withCloudOnly: found.projects.filter((p) => p.cloudOnly > 0).length,
    slowFolders: found.slowFolders
  }
  progress.phase = 'done'
  emit()
  return { scanId, ok: true, manifest: valid.manifest, ...cost(), summary }
}
