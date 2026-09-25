import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHYSICAL_CLASS, PHYSICAL_CSS } from '../eslint-rules/physical-direction.js'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

describe('logical properties only', () => {
  it('detects physical classes', () => {
    for (const bad of ['ml-2', 'pr-4', 'left-0', 'right-3', 'text-left', 'rounded-l-lg', 'border-r', '-mr-1', 'hover:pl-2', 'inset-x-0']) {
      expect(PHYSICAL_CLASS.test(` ${bad} `), bad).toBe(true)
    }
    for (const good of ['ms-2', 'pe-4', 'start-0', 'end-3', 'text-start', 'rounded-s-lg', 'border-e', 'px-4', 'mx-auto', 'leading-snug']) {
      expect(PHYSICAL_CLASS.test(` ${good} `), good).toBe(false)
    }
  })

  it('no renderer className uses left/right', () => {
    const offenders: string[] = []
    for (const file of files('src/renderer').filter((f) => /\.(tsx|ts)$/.test(f))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{[^}]*?['`"]([^'`"]*)['`"])/g)) {
        const cls = m[1] ?? m[2] ?? ''
        if (PHYSICAL_CLASS.test(` ${cls} `)) offenders.push(`${file}: ${cls}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no renderer stylesheet uses left/right', () => {
    const offenders = files('src/renderer')
      .filter((f) => f.endsWith('.css'))
      .filter((f) => PHYSICAL_CSS.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('never animates transforms, so mirrored icons flip instantly when the language changes', () => {
    const offenders = files('src/renderer')
      .filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith('.test.tsx'))
      .filter((f) => /\btransition-(?:transform|all)\b/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
