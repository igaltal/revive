import { describe, expect, it } from 'vitest'
import { MASK, redact } from './redact'

describe('redact', () => {
  it.each([
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'],
    ['sk-proj-abcdefghijklmnopqrstuvwx'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['AKIAIOSFODNN7EXAMPLE'],
    ['AIzaSyD-abcdefghijklmnopqrstuvwxyz12345'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U']
  ])('masks token %s', (token) => {
    const out = redact(`error: key ${token} rejected`)
    expect(out).not.toContain(token)
    expect(out).toContain(MASK)
  })

  it('masks secret-looking assignments but keeps the name', () => {
    expect(redact('GOOGLE_MAPS_API_KEY=hello123world')).toBe(`GOOGLE_MAPS_API_KEY=${MASK}`)
    expect(redact('DATABASE_URL: "postgres://x"')).toBe(`DATABASE_URL: "${MASK}"`)
    expect(redact('password = hunter2')).toBe(`password = ${MASK}`)
  })

  it('masks passwords inside URLs and auth headers', () => {
    expect(redact('postgres://noa:s3cret@db.local:5432/app')).toBe(`postgres://noa:${MASK}@db.local:5432/app`)
    expect(redact('Authorization: Bearer abcdefghijklmnop123')).toContain(`Bearer ${MASK}`)
  })

  it('masks exact known values from .env files', () => {
    expect(redact('Connecting with pa55word!!', ['pa55word!!'])).toBe(`Connecting with ${MASK}`)
  })

  it('leaves ordinary output alone', () => {
    const line = '  VITE v7.3.6  ready in 312 ms  ➜  Local:   http://localhost:5173/'
    expect(redact(line)).toBe(line)
    expect(redact('commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39')).toContain('3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39')
    expect(redact('Installing to /Users/noa/.local/bin/claude')).toBe('Installing to /Users/noa/.local/bin/claude')
  })
})
