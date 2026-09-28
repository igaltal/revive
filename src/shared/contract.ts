import { z } from 'zod'
import { CLIENT_STREAMS, METHOD_NAMES, SERVER_STREAMS, type ClientStreamName, type MethodName, type ServerStreamName } from './contract-names'
import { ManifestSchema, type ManifestState } from './manifest'
import { SettingsPatchSchema, SettingsSchema, type Settings } from './settings'
import { HELP_PAGES, type HelpTopic, type PrereqReport, type TaskUpdate } from './prereq'
import type { FolderCheck, RecentFolder } from './folder'
import type { ScanDone, ScanProgress } from './scan'
import type { GuardState } from './guard'
import { parseSessionId, SESSION_KINDS, type RunState, type SessionOutput, type StateEvent } from './runtime'
import { VERSION_ID, type RestorePreview, type RestoreResult, type TrashInfo, type VersionSummary } from './versions'

/**
 * The one contract between Revive's core (main) and any client.
 *
 * Every method has a zod input and output schema. Main validates every input
 * whatever transport it came through, and (outside packaged builds) every
 * output too. IPC registration and the WebSocket server are both generated
 * from this registry: a method that isn't here doesn't exist.
 *
 * `remote: false` marks what only makes sense on the computer running Revive
 * (native dialogs, the native preview, installers). Remote clients get an
 * error for those, and capabilities() hides the features that need them.
 */

// ---------- shared pieces ----------

const Iso = z.string().min(1)
const ProjectId = z.string().min(1).max(80)
const SessionIdSchema = z
  .string()
  .max(120)
  .refine((id) => parseSessionId(id) !== null, 'unknown session')
const Localized = z.object({ en: z.string(), he: z.string() })

const ToolStatus = z.object({ installed: z.boolean(), version: z.string().nullable() })
export const PrereqReportSchema = z.object({
  claude: ToolStatus.extend({ signedIn: z.enum(['yes', 'no', 'unknown']) }),
  git: ToolStatus,
  node: ToolStatus,
  codex: ToolStatus,
  checkedAt: Iso
}) satisfies z.ZodType<PrereqReport>

export const TaskUpdateSchema = z.object({
  task: z.enum(['install-claude', 'sign-in']),
  phase: z.enum(['running', 'done', 'failed']),
  line: z.string().optional()
}) satisfies z.ZodType<TaskUpdate>

export const FolderCheckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), path: z.string(), name: z.string() }),
  z.object({ ok: z.literal(false), path: z.string(), problem: z.enum(['missing', 'not-directory', 'too-broad', 'unreadable']) })
]) satisfies z.ZodType<FolderCheck>

const RecentFolderSchema = z.object({ path: z.string(), name: z.string(), exists: z.boolean() }) satisfies z.ZodType<RecentFolder>

export const ManifestStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({ state: z.literal('ok'), manifest: ManifestSchema }),
  z.object({ state: z.literal('invalid'), issues: z.array(z.string()) })
]) satisfies z.ZodType<ManifestState>

const ScanPhase = z.enum(['saving', 'reading', 'checking', 'describing', 'done'])
export const ScanProgressSchema = z.object({
  scanId: z.string(),
  phase: ScanPhase,
  filesRead: z.number().int().min(0),
  projectsFound: z.array(z.string()),
  recent: z.array(z.string())
}) satisfies z.ZodType<ScanProgress>

const ScanCostPart = z.object({ step: z.enum(['index', 'describe']), model: z.string(), usd: z.number().nullable() })
const ScanError = z.object({
  code: z.enum(['version_failed', 'claude_missing', 'auth', 'unsafe_claude', 'modified_outside', 'invalid_manifest', 'limit', 'timeout', 'cancelled', 'unknown']),
  restored: z.array(z.string()).optional(),
  quarantined: z.array(z.string()).optional(),
  unrestorable: z.array(z.string()).optional(),
  detail: z.array(z.string()).optional()
})
export const ScanDoneSchema = z.discriminatedUnion('ok', [
  z.object({ scanId: z.string(), ok: z.literal(true), manifest: ManifestSchema, costUsd: z.number().nullable(), costParts: z.array(ScanCostPart), versionId: z.string() }),
  z.object({ scanId: z.string(), ok: z.literal(false), error: ScanError, costUsd: z.number().nullable(), costParts: z.array(ScanCostPart) })
]) satisfies z.ZodType<ScanDone>

export const GuardStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('checking'), version: z.string().nullable() }),
  z.object({ state: z.literal('ok'), version: z.string(), checkedAt: Iso }),
  z.object({ state: z.literal('failed'), version: z.string().nullable(), detail: z.array(z.string()) }),
  z.object({ state: z.literal('unchecked'), version: z.string().nullable(), detail: z.array(z.string()) }),
  z.object({ state: z.literal('skipped') })
]) satisfies z.ZodType<GuardState>

const BrokenReason = z.object({
  code: z.enum(['missing_key', 'port_busy', 'deps_missing', 'tool_missing', 'install_failed', 'no_start_command', 'exited', 'timeout', 'unknown']),
  key: z.string().optional(),
  tool: z.string().optional()
})
export const RunStateSchema = z.object({
  projectId: z.string(),
  status: z.enum(['idle', 'installing', 'starting', 'checking', 'running', 'stopping', 'stopped', 'broken']),
  url: z.string().nullable(),
  port: z.number().int().nullable(),
  reason: BrokenReason.nullable(),
  command: z.string().nullable(),
  updatedAt: Iso
}) satisfies z.ZodType<RunState>

const SessionRefSchema = z.object({ projectId: z.string(), kind: z.enum(SESSION_KINDS) })
const RunStep = z.enum(['install', 'dev', 'serve'])

export const VersionSummarySchema = z.object({
  id: z.string(),
  title: Localized,
  kind: z.enum(['scan', 'restore', 'undo', 'manual']),
  createdAt: Iso,
  restoredFrom: z.string().optional(),
  scope: z.string().optional()
}) satisfies z.ZodType<VersionSummary>

const Seq = { seq: z.number().int().min(1), at: Iso }
export const StateEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('process.started'), session: SessionRefSchema, step: RunStep, command: z.string(), backend: z.string(), ...Seq }),
  z.object({ type: z.literal('port.detected'), projectId: z.string(), port: z.number().int(), url: z.string(), source: z.enum(['output', 'probe']), ...Seq }),
  z.object({ type: z.literal('status.changed'), state: RunStateSchema, ...Seq }),
  z.object({ type: z.literal('process.exited'), session: SessionRefSchema, step: RunStep, exitCode: z.number().nullable(), signal: z.string().nullable(), ...Seq }),
  z.object({ type: z.literal('shot.captured'), projectId: z.string(), path: z.string(), ...Seq }),
  z.object({ type: z.literal('manifest.changed'), ...Seq }),
  z.object({ type: z.literal('version.saved'), version: VersionSummarySchema, ...Seq }),
  z.object({
    type: z.literal('version.restored'),
    how: z.enum(['restore', 'undo']),
    versionId: z.string(),
    undoVersionId: z.string(),
    projectId: z.string().optional(),
    changedFiles: z.number().int(),
    stoppedProjects: z.array(z.string()),
    ...Seq
  }),
  z.object({ type: z.literal('trash.emptied'), removedItems: z.number().int(), ...Seq })
]) satisfies z.ZodType<StateEvent>

export const SessionOutputSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
  fromOffset: z.number().int().min(0),
  nextOffset: z.number().int().min(0),
  truncated: z.boolean()
}) satisfies z.ZodType<Omit<SessionOutput, 'sessionId'> & { sessionId: string }>

/** One piece of a session's output as it streams: masked text, and where it starts in the session buffer. */
export const SessionChunkSchema = z.object({
  sessionId: z.string(),
  offset: z.number().int().min(0),
  data: z.string(),
  /** True when output before `offset` was skipped (dropped from the buffer while this client was behind). */
  truncated: z.boolean().optional()
})
export type SessionChunk = z.infer<typeof SessionChunkSchema>

const RestorePreviewSchema = z.object({
  versionId: z.string(),
  projectId: z.string().optional(),
  changedFiles: z.number().int(),
  newFiles: z.number().int(),
  sample: z.array(z.string()),
  willStop: z.array(z.string())
}) satisfies z.ZodType<RestorePreview>

const RestoreResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    versionId: z.string(),
    projectId: z.string().optional(),
    undoVersionId: z.string(),
    changedFiles: z.number().int(),
    movedToTrash: z.array(z.string()),
    stoppedProjects: z.array(z.string()),
    missingProjects: z.array(z.string())
  }),
  z.object({ ok: z.literal(false), code: z.enum(['busy', 'not_found', 'failed']), detail: z.string().optional() })
]) satisfies z.ZodType<RestoreResult>

const TrashInfoSchema = z.object({ items: z.number().int(), bytes: z.number().int() }) satisfies z.ZodType<TrashInfo>

const Px = z.number().finite().min(-10_000).max(100_000)
export const BoundsSchema = z.object({ x: Px, y: Px, width: Px.min(0), height: Px.min(0) })
export type Bounds = z.infer<typeof BoundsSchema>
export type PreviewDevice = 'desktop' | 'phone'
const VersionInput = z.object({ versionId: z.string().regex(VERSION_ID), projectId: ProjectId.optional() })
const None = z.void()

// ---------- the registry ----------

interface MethodDef<I extends z.ZodType, O extends z.ZodType> {
  input: I
  output: O
  /** Whether a remote client (WebSocket) may call it. */
  remote: boolean
}
const remote = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O): MethodDef<I, O> => ({ input, output, remote: true })
/** Only on the computer running Revive: native UI, installers, the native preview. */
const localOnly = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O): MethodDef<I, O> => ({ input, output, remote: false })

export const METHODS = {
  'settings:get': remote(None, SettingsSchema),
  'settings:set': remote(SettingsPatchSchema, SettingsSchema),
  'prereq:check': remote(None, PrereqReportSchema),
  /** Runs Anthropic's installer on this computer, after the user confirmed here. */
  'prereq:installClaude': localOnly(None, None),
  /** Opens the sign-in page in this computer's browser. */
  'prereq:signIn': localOnly(None, None),
  'shell:openHelp': localOnly(z.object({ topic: z.enum(Object.keys(HELP_PAGES) as [HelpTopic, ...HelpTopic[]]) }), None),
  /** The native folder dialog. */
  'folder:pick': localOnly(None, FolderCheckSchema.nullable()),
  'folder:check': remote(z.object({ path: z.string().min(1).max(4096) }), FolderCheckSchema),
  /** Validates, then remembers the folder as current and recent. */
  'folder:choose': remote(z.object({ path: z.string().min(1).max(4096) }), FolderCheckSchema),
  'folder:recent': remote(None, z.array(RecentFolderSchema)),
  /** The manifest of the current folder, validated. */
  'manifest:get': remote(None, ManifestStateSchema),
  /** Reads the current folder. Returns the running scan if one is already going. */
  'scan:start': remote(None, z.object({ scanId: z.string() })),
  'scan:cancel': remote(z.object({ scanId: z.string().max(80) }), None),
  'scan:active': remote(None, z.object({ scanId: z.string() }).nullable()),
  /** Whether the installed Claude Code honours the turn limit. */
  'guard:status': remote(None, GuardStateSchema),
  'guard:recheck': remote(None, GuardStateSchema),
  'runner:start': remote(z.object({ projectId: ProjectId }), RunStateSchema),
  'runner:stop': remote(z.object({ projectId: ProjectId }), RunStateSchema),
  'runner:list': remote(None, z.array(RunStateSchema)),
  /** The project's recent output, masked, colour codes removed. */
  'runner:logs': remote(z.object({ projectId: ProjectId }), z.array(z.string())),
  /** The number of the latest state event, so a client knows where it starts. */
  'runtime:head': remote(None, z.object({ seq: z.number().int().min(0) })),
  /** State events after `seq`, for a client that (re)connects. Output is not replayed. */
  'runtime:since': remote(z.object({ seq: z.number().int().min(0) }), z.array(StateEventSchema)),
  /** A session's output after `fromOffset` (bytes), from its buffer (last 256 KB). */
  'sessions:output': remote(z.object({ sessionId: SessionIdSchema, fromOffset: z.number().int().min(0) }), SessionOutputSchema),
  // The native preview, laid over the renderer at `bounds` (window coordinates).
  'preview:show': localOnly(z.object({ projectId: ProjectId, bounds: BoundsSchema, device: z.enum(['desktop', 'phone']) }), None),
  'preview:hide': localOnly(None, None),
  /** An overlay is opening over the preview: picture it, then hide it. Resolves once hidden. */
  'preview:cover': localOnly(None, None),
  /** The last overlay closed; the next preview:show shows the view again. */
  'preview:uncover': localOnly(None, None),
  'preview:reload': localOnly(None, None),
  /** Opens a local dev server in this computer's browser. */
  'preview:openInBrowser': localOnly(z.object({ projectId: ProjectId }), None),
  /** Picture paths (see shared/assets) by project id, for the current folder. */
  'shots:list': remote(None, z.record(z.string(), z.string())),
  /** Newest first. */
  'versions:list': remote(None, z.array(VersionSummarySchema)),
  'versions:save': remote(None, VersionSummarySchema),
  /** What going back would change; nothing is written. Null if the version or project is unknown. */
  'versions:preview': remote(VersionInput, RestorePreviewSchema.nullable()),
  /** With `projectId`, only that project's files go back. */
  'versions:restore': remote(VersionInput, RestoreResultSchema),
  /** `versionId` is RestoreResult.undoVersionId; the scope of the go back is kept. */
  'versions:undo': remote(z.object({ versionId: z.string().regex(VERSION_ID) }), RestoreResultSchema),
  'trash:info': remote(None, TrashInfoSchema),
  /** Only after the user confirmed: anything but `{ confirm: true }` is refused. */
  'trash:empty': remote(z.object({ confirm: z.literal(true) }), TrashInfoSchema)
} satisfies Record<MethodName, MethodDef<z.ZodType, z.ZodType>>

/** Main → client streams. */
export const SERVER_STREAM_SCHEMAS = {
  'settings:changed': SettingsSchema satisfies z.ZodType<Settings>,
  'prereq:task': TaskUpdateSchema,
  'scan:progress': ScanProgressSchema,
  'scan:done': ScanDoneSchema,
  'guard:changed': GuardStateSchema,
  /** Runner, session and version state changes: numbered, replayable with runtime:since. */
  'runtime:event': StateEventSchema,
  /** Terminal output of any session: live, not replayed; read the buffer with sessions:output. */
  'session:output': SessionChunkSchema
} satisfies Record<ServerStreamName, z.ZodType>

/** Client → main streams (fire and forget). */
export const CLIENT_STREAM_SCHEMAS = {
  /** Keystrokes into a session. */
  'session:input': z.object({ sessionId: SessionIdSchema, data: z.string().max(64 * 1024) }),
  'session:resize': z.object({ sessionId: SessionIdSchema, cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) })
} satisfies Record<ClientStreamName, z.ZodType>

// ---------- types ----------

export type Methods = typeof METHODS
export type MethodInput<M extends MethodName> = z.input<Methods[M]['input']>
export type MethodOutput<M extends MethodName> = z.output<Methods[M]['output']>
export type ServerStreamPayload<S extends ServerStreamName> = z.output<(typeof SERVER_STREAM_SCHEMAS)[S]>
export type ClientStreamPayload<S extends ClientStreamName> = z.input<(typeof CLIENT_STREAM_SCHEMAS)[S]>
export type { MethodName, ServerStreamName, ClientStreamName }

// The zod-free name lists and the registry must be exactly the same (both directions).
type Same<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : never
const _methods: Same<keyof Methods, MethodName> = true
const _server: Same<keyof typeof SERVER_STREAM_SCHEMAS, ServerStreamName> = true
const _client: Same<keyof typeof CLIENT_STREAM_SCHEMAS, ClientStreamName> = true
void [_methods, _server, _client, METHOD_NAMES, SERVER_STREAMS, CLIENT_STREAMS]

// ---------- capabilities ----------

export type TransportKind = 'ipc' | 'ws'

/** What a client can do, so the UI hides what it can't instead of checking for Electron. */
export interface Capabilities {
  /** The live preview drawn natively over the page. */
  nativePreview: boolean
  /** The system folder dialog. */
  folderPicker: boolean
  /** Dropping a folder from Finder onto the window. */
  dropFolder: boolean
  /** Opening a running project in this computer's browser. */
  openInBrowser: boolean
  /** Installing Claude Code and signing in, on this computer. */
  installTools: boolean
  /** Opening help pages in this computer's browser. */
  openHelp: boolean
}

/** The methods each capability needs. A capability is on only if its transport may call all of them. */
export const CAPABILITY_METHODS: Record<Exclude<keyof Capabilities, 'dropFolder'>, MethodName[]> = {
  nativePreview: ['preview:show', 'preview:hide', 'preview:cover', 'preview:uncover', 'preview:reload'],
  folderPicker: ['folder:pick'],
  openInBrowser: ['preview:openInBrowser'],
  installTools: ['prereq:installClaude', 'prereq:signIn'],
  openHelp: ['shell:openHelp']
}

export function availableOn(kind: TransportKind, method: MethodName): boolean {
  return kind === 'ipc' || METHODS[method].remote
}

export function capabilitiesFor(kind: TransportKind): Capabilities {
  const can = (ms: MethodName[]) => ms.every((m) => availableOn(kind, m))
  return {
    nativePreview: can(CAPABILITY_METHODS.nativePreview),
    folderPicker: can(CAPABILITY_METHODS.folderPicker),
    openInBrowser: can(CAPABILITY_METHODS.openInBrowser),
    installTools: can(CAPABILITY_METHODS.installTools),
    openHelp: can(CAPABILITY_METHODS.openHelp),
    // Drag and drop needs a real file path, which only the desktop bridge can give.
    dropFolder: kind === 'ipc'
  }
}
