import { describe, expect, it } from 'vitest'
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import en from '../src/renderer/i18n/en.json'
import he from '../src/renderer/i18n/he.json'

type Catalog = { [key: string]: string | Catalog }

function flatten(obj: Catalog, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [ik, iv] of flatten(v, key)) out.set(ik, iv)
  }
  return out
}

function argNames(elements: MessageFormatElement[], acc = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) acc.add(el.value)
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      acc.add(el.value)
      for (const opt of Object.values(el.options)) argNames(opt.value, acc)
    }
    if (el.type === TYPE.tag) argNames(el.children, acc)
  }
  return acc
}

const catalogs = { en: flatten(en as Catalog), he: flatten(he as Catalog) }

describe('string catalogs', () => {
  it('have exactly the same keys in English and Hebrew', () => {
    const enKeys = [...catalogs.en.keys()].sort()
    const heKeys = [...catalogs.he.keys()].sort()
    expect(heKeys.filter((k) => !catalogs.en.has(k)), 'keys only in he.json').toEqual([])
    expect(enKeys.filter((k) => !catalogs.he.has(k)), 'keys only in en.json').toEqual([])
  })

  it('have no empty strings', () => {
    for (const [lang, map] of Object.entries(catalogs)) {
      for (const [key, value] of map) expect(value.trim(), `${lang}:${key}`).not.toBe('')
    }
  })

  it('are valid ICU and use the same arguments in both languages', () => {
    for (const [key, enValue] of catalogs.en) {
      const heValue = catalogs.he.get(key)
      if (heValue === undefined) continue
      const enArgs = [...argNames(parse(enValue))].sort()
      const heArgs = [...argNames(parse(heValue))].sort()
      expect(heArgs, `arguments for ${key}`).toEqual(enArgs)
    }
  })
})
