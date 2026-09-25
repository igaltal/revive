import { describe, expect, it } from 'vitest'
import { splitLines, stripAnsi } from './ansi'

describe('terminal output', () => {
  it('strips colors and cursor codes', () => {
    expect(stripAnsi('\u001b[32m✔\u001b[39m Installed\u001b[2K')).toBe('✔ Installed')
  })

  it('splits streamed chunks into whole lines', () => {
    const a = splitLines('', 'Downloading…\nInstall')
    expect(a).toEqual({ lines: ['Downloading…'], rest: 'Install' })
    const b = splitLines(a.rest, 'ing\r\nDone\n')
    expect(b).toEqual({ lines: ['Installing', 'Done'], rest: '' })
  })
})
