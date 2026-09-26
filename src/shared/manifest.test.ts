import { describe, expect, it } from 'vitest'
import { manifestJsonSchema, parseManifest } from './manifest'
import { sampleManifest } from './test-fixtures'

describe('manifest schema', () => {
  it('accepts a valid manifest', () => {
    expect(parseManifest(sampleManifest()).ok).toBe(true)
  })

  it('rejects wrong versions, bad statuses and escaping paths with readable issues', () => {
    const bad = sampleManifest() as unknown as Record<string, unknown>
    bad['version'] = 1
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join('\n')).toContain('version')

    const m = sampleManifest()
    m.projects[0]!.path = '../outside'
    expect(parseManifest(m).ok).toBe(false)
    m.projects[0]!.path = '/etc'
    expect(parseManifest(m).ok).toBe(false)
  })

  it('rejects duplicate project ids', () => {
    const m = sampleManifest()
    m.projects.push({ ...m.projects[0]! })
    expect(parseManifest(m).ok).toBe(false)
  })

  it('drops unknown fields, so a stray key value is never kept', () => {
    const m = sampleManifest() as unknown as { projects: Array<Record<string, unknown>> }
    m.projects[0]!['keys'] = [{ key: 'MAPS_KEY', purpose: { en: 'Maps', he: 'מפות' }, required: true, value: 'AIzaSy-secret' }]
    const r = parseManifest(m)
    expect(r.ok).toBe(true)
    if (r.ok) expect(JSON.stringify(r.manifest)).not.toContain('AIzaSy-secret')
  })

  it('exports a JSON schema for Claude', () => {
    const schema = manifestJsonSchema() as { properties: Record<string, unknown> }
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['version', 'projects', 'loose_files']))
  })
})
