import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import color, { rawColorIn } from '../eslint-rules/no-raw-color.js'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

const linter = new Linter({ configType: 'flat' })
const config = [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser as Linter.Parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { color: color as never },
    rules: { 'color/no-raw-color': 'error' as const }
  }
]
const lint = (code: string, file = 'src/renderer/screens/X.tsx') => linter.verify(code, config, { filename: resolve(file) }).map((m) => m.message)

/** Where colors may be written down: the theme, and tests. */
const allowed = (f: string) => f.startsWith(join('src', 'renderer', 'theme')) || /\.test\.tsx?$/.test(f) || f.startsWith(join('src', 'renderer', 'test'))

describe('no raw colors outside the theme', () => {
  it('recognizes every way of writing a color', () => {
    for (const bad of ['#fff', '#1d1b18', '#1d1b18cc', 'rgba(0, 0, 0, 0.3)', 'rgb(1 2 3)', 'hsl(20 50% 50%)', 'oklch(0.7 0.1 200)', 'bg-white', 'text-red-600', 'hover:bg-black/10', 'border-slate-200', 'bg-[#123456]', 'color: white', 'black']) {
      expect(rawColorIn(bad), bad).not.toBeNull()
    }
    for (const good of ['bg-card', 'text-muted', 'text-accent', 'bg-accent-fill/30', 'var(--color-accent)', 'color-mix(in oklab, var(--color-accent-fill) 45%, transparent)', 'whitespace-nowrap', 'url(#scene-sky)', 'transparent', 'currentColor', 'customize.accent.blue', 'accent-${name}', 'to-right-now']) {
      expect(rawColorIn(good), good).toBeNull()
    }
  })

  it('the lint rule reports them in code', () => {
    expect(lint(`const a = <div className="bg-white p-2" />`)).toHaveLength(1)
    expect(lint(`const a = <div style={{ color: '#fff' }} />`)).toHaveLength(1)
    expect(lint('const a = `rgba(${r}, 0, 0, 1)`')).toHaveLength(1)
    expect(lint(`const a = <div className="bg-card text-ink" style={{ color: 'var(--color-ink)' }} />`)).toEqual([])
  })

  it('holds for every file in src/renderer outside the theme (and its stylesheets)', () => {
    const offenders: string[] = []
    for (const f of files('src/renderer')) {
      if (allowed(f)) continue
      const src = readFileSync(f, 'utf8')
      if (/\.(ts|tsx)$/.test(f)) offenders.push(...lint(src, f).map((m) => `${f}: ${m}`))
      else if (f.endsWith('.css') && rawColorIn(src)) offenders.push(`${f}: ${rawColorIn(src)}`)
    }
    expect(offenders).toEqual([])
  })
})
