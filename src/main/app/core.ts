import type { GuardState } from '@shared/guard'
import { SettingsStore } from '../settings-store'
import { ScanController } from '../scanner/controller'
import type { AgentAdapter } from '../scanner/agent-adapter'
import { RuntimeBus } from '../services/runtime-bus'
import { SessionHub } from '../services/sessions/session-hub'
import type { SessionBackend } from '../services/sessions/backend'
import { Runner, type RunnerDeps } from '../services/runner/runner'
import { Workspace } from '../services/workspace'
import { VersionService } from '../services/versions/version-service'
import { saveShot } from '../services/shots/shots'
import { ServerStreams } from '../contract/streams'
import type { Core } from '../contract/handlers'

export interface CoreOptions {
  userData: string
  backend: SessionBackend
  staticServer: RunnerDeps['staticServer']
  /** Picks the agent once the guard exists (the Claude adapter needs it). */
  adapter: AgentAdapter
  guard: Core['guard']
  shellReady?: Promise<void>
  /** Takes a picture of a running app (Electron offscreen); none in headless setups. */
  capturePage?: (url: string) => Promise<Buffer | null>
  runnerTiming?: RunnerDeps['timing']
}

/**
 * Revive's core, without Electron: settings, the folder, the runner and its
 * sessions, versions, scans, and the streams every client listens to. The
 * desktop app and the tests build exactly the same thing.
 */
export function createCore(opts: CoreOptions): Core {
  const settings = new SettingsStore(opts.userData)
  const bus = new RuntimeBus()
  const streams = new ServerStreams()
  streams.bridge(bus)
  const hub = new SessionHub(opts.backend, bus)

  // eslint-disable-next-line prefer-const -- the workspace and runner need each other
  let runner: Runner
  const workspace = new Workspace(settings, () => runner.stopAll())
  const capture = opts.capturePage
  runner = new Runner({
    hub,
    bus,
    projects: workspace,
    staticServer: opts.staticServer,
    timing: opts.runnerTiming,
    capture: capture
      ? async (projectId, url) => {
          const png = await capture(url)
          return png ? saveShot(await workspace.current(), projectId, png) : null
        }
      : undefined
  })

  // eslint-disable-next-line prefer-const -- versions and scans need each other
  let scans: ScanController
  const versions = new VersionService({ bus, folder: () => workspace.current(), runner, scanning: () => scans.active() !== null })
  scans = new ScanController(
    opts.adapter,
    {
      progress: (p) => streams.emit('scan:progress', p),
      done: (d) => streams.emit('scan:done', d),
      versionSaved: (v) => versions.announce(v)
    },
    // Nothing running, and no restore half done, while Claude reads the folder.
    async () => {
      await runner.stopAll()
      await versions.whenIdle()
    }
  )

  return { settings, shellReady: opts.shellReady ?? Promise.resolve(), scans, workspace, runner, bus, hub, versions, streams, guard: opts.guard }
}

/** For setups without Claude (the offline test agent): nothing to check. */
export const SKIPPED_GUARD: Core['guard'] = {
  current: (): GuardState => ({ state: 'skipped' }),
  recheck: async (): Promise<GuardState> => ({ state: 'skipped' })
}
