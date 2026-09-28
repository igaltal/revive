import { z } from 'zod'
import { CLIENT_STREAMS, METHOD_NAMES, SERVER_STREAMS, type ClientStreamName, type MethodName, type ServerStreamName } from './contract-names'
import { ManifestSchema, type ManifestState } from './manifest'
import { SettingsPatchSchema, SettingsSchema, type Settings } from './settings'
import { HELP_PAGES, type HelpTopic, type PrereqReport, type TaskUpdate } from './prereq'
import type { FolderCheck, RecentFolder } from './folder'
import type { ScanDone, ScanProgress } from './scan'
import type { GuardState } from './guard'
import { parseSessionId, SESSION_KINDS, type RunState, type SessionOutput, type StateEvent } from './runtime'
import type { ActivityEntry, HostStatus, PairingCode } from './host'
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
const RunStep = z.enum(['install', 'dev', 'serve', 'terminal'])

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
  epoch: z.string(),
  data: z.string(),
  fromOffset: z.number().int().min(0),
  nextOffset: z.number().int().min(0),
  truncated: z.boolean()
}) satisfies z.ZodType<Omit<SessionOutput, 'sessionId'> & { sessionId: string }>

/** One piece of a session's output as it streams: masked text, and where it starts in the session buffer. */
export const SessionChunkSchema = z.object({
  sessionId: z.string(),
  offset: z.number().int().min(0),
  /** The buffer's lifetime: a new one after Revive restarts (rebuilt from tmux's history). */
  epoch: z.string(),
  data: z.string(),
  /** True when output before `offset` was skipped (dropped from the buffer while this client was behind). */
  truncated: z.boolean().optional(),
  /** Set by a client transport when the buffer started over: a terminal should clear before writing this. */
  reset: z.boolean().optional()
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

export const SessionsInfoSchema = z.object({
  backend: z.enum(['tmux', 'pty']),
  /** Sessions outlive Revive. */
  persistent: z.boolean(),
  tmuxVersion: z.string().nullable(),
  /** Left running from earlier, for projects that aren't in the list any more. */
  orphans: z.array(z.object({ name: z.string(), projectId: z.string().nullable(), kind: z.string().nullable(), createdAt: z.string().nullable() }))
})
export type SessionsInfo = z.infer<typeof SessionsInfoSchema>

const SessionInfoSchema = z.object({ sessionId: z.string(), projectId: z.string(), kind: z.enum(SESSION_KINDS), step: RunStep })

export const PairingCodeSchema = z.object({ code: z.string(), expiresAt: Iso, link: z.string(), qrSvg: z.string() }) satisfies z.ZodType<PairingCode>

export const HostStatusSchema = z.object({
  sharing: z.boolean(),
  port: z.number().int().nullable(),
  hostName: z.string(),
  tailscale: z.object({ state: z.enum(['missing', 'available', 'serving', 'error']), address: z.string().nullable(), detail: z.string().optional() }),
  sleepMinutes: z.number().int().nullable(),
  tmux: z.boolean(),
  startAtLogin: z.boolean(),
  pairing: PairingCodeSchema.nullable(),
  lockedUntil: Iso.nullable(),
  requests: z.array(z.object({ id: z.string(), deviceName: z.string(), at: Iso })),
  devices: z.array(z.object({ id: z.string(), name: z.string(), createdAt: Iso, lastSeenAt: Iso.nullable(), online: z.boolean() }))
}) satisfies z.ZodType<HostStatus>

export const ActivityEntrySchema = z.object({
  at: Iso,
  deviceId: z.string(),
  deviceName: z.string(),
  method: z.string(),
  summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
}) satisfies z.ZodType<ActivityEntry>

const CapabilitiesSchema = z.object({
  nativePreview: z.boolean(),
  folderPicker: z.boolean(),
  dropFolder: z.boolean(),
  openInBrowser: z.boolean(),
  installTools: z.boolean(),
  openHelp: z.boolean(),
  hostControls: z.boolean()
}) satisfies z.ZodType<Capabilities>

/** This app's connection: working on this computer, or a window onto another one. */
export const ClientStatusSchema = z.object({
  state: z.enum(['local', 'pairing', 'waiting', 'open', 'reconnecting', 'rejected']),
  host: z.object({ name: z.string(), address: z.string() }).nullable(),
  problem: z.enum(['bad_code', 'locked', 'expired', 'denied', 'unreachable', 'revoked', 'no_keychain']).nullable(),
  /** What this window can do, given where its work happens. */
  capabilities: CapabilitiesSchema
})
export type ClientStatus = z.infer<typeof ClientStatusSchema>

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
  /**
   * Handled by the app on this computer itself (sharing, pairing, the client
   * connection): never sent to a Host in client mode, never callable remotely.
   */
  app: boolean
  /** Changes something: recorded in the action log with the device that asked. */
  mutates: boolean
}
type Flags = { mutates?: boolean }
type Core<I extends z.ZodType, O extends z.ZodType> = MethodDef<I, O> & { app: false }
type App<I extends z.ZodType, O extends z.ZodType> = MethodDef<I, O> & { app: true }
const remote = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O, f: Flags = {}): Core<I, O> => ({ input, output, remote: true, app: false, mutates: f.mutates ?? false })
/** Only on the computer running Revive: native UI, installers, the native preview. */
const localOnly = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O, f: Flags = {}): Core<I, O> => ({ input, output, remote: false, app: false, mutates: f.mutates ?? false })
/** This app's own controls: Host mode and the client connection. */
const appOnly = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O, f: Flags = {}): App<I, O> => ({ input, output, remote: false, app: true, mutates: f.mutates ?? false })
const M = { mutates: true }

export const METHODS = {
  'settings:get': remote(None, SettingsSchema),
  'settings:set': remote(SettingsPatchSchema, SettingsSchema, M),
  'prereq:check': remote(None, PrereqReportSchema),
  /** Runs Anthropic's installer on this computer, after the user confirmed here. */
  'prereq:installClaude': localOnly(None, None, M),
  /** Opens the sign-in page in this computer's browser. */
  'prereq:signIn': localOnly(None, None, M),
  'shell:openHelp': localOnly(z.object({ topic: z.enum(Object.keys(HELP_PAGES) as [HelpTopic, ...HelpTopic[]]) }), None),
  /** The native folder dialog. */
  'folder:pick': localOnly(None, FolderCheckSchema.nullable()),
  'folder:check': remote(z.object({ path: z.string().min(1).max(4096) }), FolderCheckSchema),
  /** Validates, then remembers the folder as current and recent. */
  'folder:choose': remote(z.object({ path: z.string().min(1).max(4096) }), FolderCheckSchema, M),
  'folder:recent': remote(None, z.array(RecentFolderSchema)),
  /** The manifest of the current folder, validated. */
  'manifest:get': remote(None, ManifestStateSchema),
  /** Reads the current folder. Returns the running scan if one is already going. */
  'scan:start': remote(None, z.object({ scanId: z.string() }), M),
  'scan:cancel': remote(z.object({ scanId: z.string().max(80) }), None, M),
  'scan:active': remote(None, z.object({ scanId: z.string() }).nullable()),
  /** Whether the installed Claude Code honours the turn limit. */
  'guard:status': remote(None, GuardStateSchema),
  'guard:recheck': remote(None, GuardStateSchema, M),
  'runner:start': remote(z.object({ projectId: ProjectId }), RunStateSchema, M),
  'runner:stop': remote(z.object({ projectId: ProjectId }), RunStateSchema, M),
  'runner:list': remote(None, z.array(RunStateSchema)),
  /** The project's recent output, masked, colour codes removed. */
  'runner:logs': remote(z.object({ projectId: ProjectId }), z.array(z.string())),
  /** The number of the latest state event, so a client knows where it starts. */
  'runtime:head': remote(None, z.object({ seq: z.number().int().min(0) })),
  /** State events after `seq`, for a client that (re)connects. Output is not replayed. */
  'runtime:since': remote(z.object({ seq: z.number().int().min(0) }), z.array(StateEventSchema)),
  /** A session's output after `fromOffset` (bytes), from its buffer (last 256 KB). */
  'sessions:output': remote(z.object({ sessionId: SessionIdSchema, fromOffset: z.number().int().min(0), epoch: z.string().max(40).optional() }), SessionOutputSchema),
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
  'versions:save': remote(None, VersionSummarySchema, M),
  /** What going back would change; nothing is written. Null if the version or project is unknown. */
  'versions:preview': remote(VersionInput, RestorePreviewSchema.nullable()),
  /** With `projectId`, only that project's files go back. */
  'versions:restore': remote(VersionInput, RestoreResultSchema, M),
  /** `versionId` is RestoreResult.undoVersionId; the scope of the go back is kept. */
  'versions:undo': remote(z.object({ versionId: z.string().regex(VERSION_ID) }), RestoreResultSchema, M),
  'trash:info': remote(None, TrashInfoSchema),
  /** Only after the user confirmed: anything but `{ confirm: true }` is refused. */
  'trash:empty': remote(z.object({ confirm: z.literal(true) }), TrashInfoSchema, M),

  // Interactive terminals: a shell, Claude Code or Codex in a project's folder. One per project and kind.
  'sessions:open': remote(z.object({ projectId: ProjectId, kind: z.enum(['shell', 'claude', 'codex']) }), z.object({ sessionId: z.string(), created: z.boolean() }), M),
  /** Ends the session and what runs in it (closing a terminal view only detaches). Only after the user confirmed. */
  'sessions:close': remote(z.object({ sessionId: SessionIdSchema, confirm: z.literal(true) }), None, M),
  'sessions:list': remote(None, z.array(SessionInfoSchema)),
  /** Whether sessions outlive Revive (tmux), and sessions whose project is gone. */
  'sessions:info': remote(None, SessionsInfoSchema),
  /** Ends a session whose project is gone. Never done without the user asking. */
  'sessions:endOrphan': remote(z.object({ name: z.string().regex(/^revive-[a-z0-9-]+$/).max(120), confirm: z.literal(true) }), SessionsInfoSchema, M),

  // Host mode: this computer shared with paired devices. Only on the Host itself.
  'host:status': appOnly(None, HostStatusSchema),
  'host:setSharing': appOnly(z.object({ on: z.boolean() }), HostStatusSchema, M),
  'host:setStartAtLogin': appOnly(z.object({ on: z.boolean() }), HostStatusSchema, M),
  /** Runs `tailscale serve --bg <port>`; only after the user confirmed the exact command. */
  'host:exposeTailscale': appOnly(z.object({ confirm: z.literal(true) }), HostStatusSchema, M),
  'host:startPairing': appOnly(None, PairingCodeSchema, M),
  'host:cancelPairing': appOnly(None, None),
  /** Nothing is issued to a device until the user allows it here. */
  'host:answerPairing': appOnly(z.object({ requestId: z.string().max(80), allow: z.boolean() }), HostStatusSchema, M),
  'host:revokeDevice': appOnly(z.object({ deviceId: z.string().max(80) }), HostStatusSchema, M),
  'host:activity': appOnly(z.object({ limit: z.number().int().min(1).max(500) }), z.array(ActivityEntrySchema)),

  // Client mode: this app as a window onto another computer.
  'client:status': appOnly(None, ClientStatusSchema),
  'client:connect': appOnly(z.object({ address: z.string().min(1).max(300), code: z.string().regex(/^\d{6}$/), deviceName: z.string().min(1).max(60) }), ClientStatusSchema, M),
  'client:disconnect': appOnly(None, ClientStatusSchema, M)
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
  'session:output': SessionChunkSchema,
  /** Host mode changes (sharing, pairing requests, devices). Only on the Host itself. */
  'host:status': HostStatusSchema,
  /** This app's connection to another computer. */
  'client:status': ClientStatusSchema
} satisfies Record<ServerStreamName, z.ZodType>

/** Client → main streams (fire and forget). */
export const CLIENT_STREAM_SCHEMAS = {
  /** Keystrokes into a session. */
  'session:input': z.object({ sessionId: SessionIdSchema, data: z.string().max(64 * 1024) }),
  'session:resize': z.object({ sessionId: SessionIdSchema, cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) })
} satisfies Record<ClientStreamName, z.ZodType>

// ---------- types ----------

export type Methods = typeof METHODS
/** Handled by this app itself: Host mode and the client connection. */
export type AppMethodName = { [K in MethodName]: Methods[K]['app'] extends true ? K : never }[MethodName]
/** Revive's core: the same on every computer, and what a client forwards to its Host. */
export type CoreMethodName = Exclude<MethodName, AppMethodName>
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
  /** Sharing this computer, pairing and devices: only on the computer itself, in local mode. */
  hostControls: boolean
}

/** The methods each capability needs. A capability is on only if its transport may call all of them. */
export const CAPABILITY_METHODS: Record<Exclude<keyof Capabilities, 'dropFolder' | 'hostControls'>, MethodName[]> = {
  nativePreview: ['preview:show', 'preview:hide', 'preview:cover', 'preview:uncover', 'preview:reload'],
  folderPicker: ['folder:pick'],
  openInBrowser: ['preview:openInBrowser'],
  installTools: ['prereq:installClaude', 'prereq:signIn'],
  openHelp: ['shell:openHelp']
}

export function availableOn(kind: TransportKind, method: MethodName): boolean {
  const def: { remote: boolean; app: boolean } = METHODS[method]
  return kind === 'ipc' || (def.remote && !def.app)
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
    dropFolder: kind === 'ipc',
    hostControls: kind === 'ipc'
  }
}


