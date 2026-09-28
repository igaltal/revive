import { z } from 'zod'

export const STATUSES = ['running', 'verified', 'broken', 'unknown'] as const
export type Status = (typeof STATUSES)[number]

const IsoDate = z.iso.datetime({ offset: true })
const Localized = z.object({ en: z.string(), he: z.string() })

/** A folder path inside the chosen folder: relative, no escaping upwards. */
const RelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split(/[\\/]/).includes('..'), 'must be a relative path inside the folder')

export const KeySchema = z.object({
  key: z.string().min(1),
  purpose: Localized,
  required: z.boolean()
})

export const RunSchema = z.object({
  install: z.string().nullable(),
  dev: z.string().nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  url: z.string().nullable(),
  verified_at: IsoDate.nullable()
})

export const ProjectSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1),
  path: RelativePath,
  description: Localized,
  stack: z.array(z.string()),
  status: z.enum(STATUSES),
  run: RunSchema,
  keys: z.array(KeySchema),
  notes: z.array(z.string()),
  user_locked: z.array(z.string())
})

export const ManifestSchema = z
  .object({
    version: z.literal(2),
    scanned_at: IsoDate,
    projects: z.array(ProjectSchema),
    loose_files: z.array(z.string()),
    suggested_reorg: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() }))
  })
  .refine((m) => new Set(m.projects.map((p) => p.id)).size === m.projects.length, 'project ids must be unique')

export type Manifest = z.infer<typeof ManifestSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectKey = z.infer<typeof KeySchema>

/** Written to .revive/schema.json before every scan so Claude writes the right shape. */
export function manifestJsonSchema(): unknown {
  return z.toJSONSchema(ManifestSchema, { target: 'draft-2020-12', io: 'input' })
}

export type ParseResult = { ok: true; manifest: Manifest } | { ok: false; issues: string[] }

export function parseManifest(raw: unknown): ParseResult {
  const r = ManifestSchema.safeParse(raw)
  if (r.success) return { ok: true, manifest: r.data }
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}

/** Fields a user can lock so a new scan never changes them. */
export const LOCKABLE_FIELDS = [
  'name',
  'description',
  'description.en',
  'description.he',
  'stack',
  'run.install',
  'run.dev',
  'run.port',
  'run.url',
  'keys',
  'notes'
] as const

/** The stored manifest of the current folder, as a client sees it. */
export type ManifestState = { state: 'none' } | { state: 'ok'; manifest: Manifest } | { state: 'invalid'; issues: string[] }
