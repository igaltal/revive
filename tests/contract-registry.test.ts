import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilitiesFor, METHODS } from '../src/shared/contract'
import { CLIENT_STREAMS, METHOD_NAMES } from '../src/shared/contract-names'
import { registerIpc } from '../src/main/contract/ipc'
import { dispatch, type Handlers } from '../src/main/contract/dispatch'
import { ServerStreams } from '../src/main/contract/streams'
import type { SessionHub } from '../src/main/services/sessions/session-hub'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(p) && !/\.test\.ts$/.test(p) ? [p] : []
  })
}

/** Handlers that answer anything; only registration and dispatch are under test here. */
const anyHandlers = new Proxy({}, { get: () => () => null }) as unknown as Handlers

describe('the contract registry', () => {
  it('IPC registers exactly the methods and client streams in the registry', () => {
    const handled: string[] = []
    const on: string[] = []
    registerIpc({
      ipcMain: { handle: (name: string) => void handled.push(name), on: ((name: string) => on.push(name)) as never },
      handlers: anyHandlers,
      streams: new ServerStreams(),
      hub: {} as SessionHub,
      target: () => null,
      checkOutputs: true
    })
    expect(handled.sort()).toEqual([...METHOD_NAMES].sort())
    expect(new Set(handled).size).toBe(handled.length)
    expect(on.sort()).toEqual([...CLIENT_STREAMS].sort())
    expect(Object.keys(METHODS).sort()).toEqual([...METHOD_NAMES].sort())
  })

  it('no ipcMain handler exists outside the generated registration', () => {
    const offenders = files('src/main')
      .filter((f) => !f.endsWith(join('contract', 'ipc.ts')))
      .flatMap((f) => {
        const src = readFileSync(f, 'utf8')
        return /\bipcMain\s*\.\s*(?:handle|handleOnce|on|once|addListener)\s*\(/.test(src) || /\bwebContents\s*\.\s*send\s*\(/.test(src) ? [f] : []
      })
    expect(offenders).toEqual([])
  })

  it('refuses methods outside the registry, bad input, and local-only methods over the network', async () => {
    await expect(dispatch(anyHandlers, 'fs:readFile', {}, { transport: 'ipc' }, true)).rejects.toMatchObject({ code: 'unknown_method' })
    await expect(dispatch(anyHandlers, 'runner:start', { projectId: '' }, { transport: 'ipc' }, true)).rejects.toMatchObject({ code: 'bad_input' })
    await expect(dispatch(anyHandlers, 'trash:empty', { confirm: 'yes' }, { transport: 'ws' }, true)).rejects.toMatchObject({ code: 'bad_input' })
    await expect(dispatch(anyHandlers, 'folder:pick', undefined, { transport: 'ws' }, true)).rejects.toMatchObject({ code: 'not_available' })
    // An output outside the contract is caught before any client sees it.
    await expect(dispatch(anyHandlers, 'settings:get', undefined, { transport: 'ipc' }, true)).rejects.toMatchObject({ code: 'bad_output' })
  })

  it('capabilities follow from which methods a transport may call', () => {
    expect(capabilitiesFor('ipc')).toEqual({ nativePreview: true, folderPicker: true, dropFolder: true, openInBrowser: true, installTools: true, openHelp: true })
    expect(capabilitiesFor('ws')).toEqual({ nativePreview: false, folderPicker: false, dropFolder: false, openInBrowser: false, installTools: false, openHelp: false })
    const localOnly = METHOD_NAMES.filter((m) => !METHODS[m].remote).sort()
    expect(localOnly).toEqual(
      ['folder:pick', 'prereq:installClaude', 'prereq:signIn', 'preview:cover', 'preview:hide', 'preview:openInBrowser', 'preview:reload', 'preview:show', 'preview:uncover', 'shell:openHelp'].sort()
    )
  })
})
