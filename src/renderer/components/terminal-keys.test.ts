import { describe, expect, it } from 'vitest'
import { clampFont, isTerminalReport, keySequence, withCtrl } from './terminal-keys'

describe('the phone key row', () => {
  it('sends the right bytes', () => {
    const normal = { applicationCursor: false }
    expect(keySequence('esc', normal)).toBe('\x1b')
    expect(keySequence('tab', normal)).toBe('\t')
    expect(keySequence('enter', normal)).toBe('\r')
    expect(['up', 'down', 'right', 'left'].map((k) => keySequence(k as 'up', normal))).toEqual(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D'])
    // Full-screen programs (vim, less, agent TUIs) switch arrows to application mode.
    expect(keySequence('up', { applicationCursor: true })).toBe('\x1bOA')
  })

  it('Ctrl turns the next key into its control code', () => {
    expect(withCtrl('c')).toBe('\x03')
    expect(withCtrl('C')).toBe('\x03')
    expect(withCtrl('d')).toBe('\x04')
    expect(withCtrl('[')).toBe('\x1b')
    expect(withCtrl(' ')).toBe('\x00')
    expect(withCtrl('1')).toBe('1')
    expect(withCtrl('ab')).toBe('ab')
  })

  it('keeps the font size readable', () => {
    expect(clampFont(3)).toBe(9)
    expect(clampFont(40)).toBe(24)
    expect(clampFont(14.4)).toBe(14)
  })
})

describe('answers a terminal sends by itself', () => {
  it('are recognized, so a replayed history can’t make them reach the program again', () => {
    for (const r of ['\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[?1;2c\x1b[>0;276;0c', '\x1b[12;40R', '\x1b[0n', '\x1b[I', '\x1b]11;rgb:1d1d/1b1b/1818\x07', '\x1b]10;rgb:ecec/e8e8/dfdf\x1b\\']) expect(isTerminalReport(r), JSON.stringify(r)).toBe(true)
    for (const typed of ['ls\r', 'c', '\x1b[A', '\x1b', '\t', '\x03', 'echo "1;2c"\r']) expect(isTerminalReport(typed), JSON.stringify(typed)).toBe(false)
  })
})
