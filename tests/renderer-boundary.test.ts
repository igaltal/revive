import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import boundary from '../eslint-rules/renderer-boundary.js'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : []
  })
}

const linter = new Linter({ configType: 'flat' })
const config = [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser as Linter.Parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { boundary: boundary as never },
    rules: { 'boundary/renderer-boundary': 'error' as const }
  }
]
const lint = (code: string, file: string) => linter.verify(code, config, { filename: resolve(file) }).map((m) => m.message)

describe('renderer boundary: one transport module, no Electron', () => {
  it('rejects Electron and the raw bridge outside the transport module', () => {
    const screen = 'src/renderer/screens/X.tsx'
    const both = lint(`import { ipcRenderer } from 'electron'`, screen)
    expect(both.some((m) => m.includes('never imports Electron'))).toBe(true)
    expect(both.some((m) => m.startsWith('ipcRenderer is only allowed'))).toBe(true)
    expect(lint(`const e = require('electron')`, screen)).toHaveLength(1)
    expect(lint(`void import('electron/renderer')`, screen)).toHaveLength(1)
    expect(lint(`window.revive.invoke('settings:get')`, screen)).toHaveLength(1)
    expect(lint(`window['revive'].on('x', () => {})`, screen)).toHaveLength(1)
    expect(lint(`import { transport } from '@/transport'; transport.invoke('settings:get')`, screen)).toEqual([])
    // Screens see the Transport interface only, never an implementation.
    expect(lint(`import { IpcTransport } from '@/transport/ipc-transport'`, screen)).toHaveLength(1)
    expect(lint(`import { WsTransport } from '@shared/ws-transport'`, screen)).toHaveLength(1)
    expect(lint(`import type { Transport } from '@shared/transport'`, screen)).toEqual([])
  })

  it('allows the bridge only inside src/renderer/transport/, and Electron nowhere', () => {
    const t = 'src/renderer/transport/index.ts'
    expect(lint(`window.revive.invoke('settings:get')`, t)).toEqual([])
    expect(lint(`import { ipcRenderer } from 'electron'`, t)).toEqual(['The renderer never imports Electron. Use the transport module (@/transport).'])
  })

  it('holds for every file in src/renderer', async () => {
    const { readFileSync } = await import('node:fs')
    const offenders = files('src/renderer').flatMap((f) => lint(readFileSync(f, 'utf8'), f).map((m) => `${f}: ${m}`))
    expect(offenders).toEqual([])
  })
})
