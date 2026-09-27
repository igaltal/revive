import { describe, expect, it } from 'vitest'
import { runTurnLimitProbe } from './turn-limit-guard'

/**
 * Live: runs the real, installed Claude Code (about $0.01 with Haiku).
 * `npm run test:live`. Fails if the installed version doesn't stop at
 * --max-turns, or if Claude Code isn't installed and signed in.
 */
describe('the installed Claude Code', () => {
  it('stops at the turn limit Revive sets', async () => {
    const r = await runTurnLimitProbe()
    console.log(`turn limit check: ${r.verdict}\n  ${r.detail.join('\n  ')}`)
    expect(r.verdict, r.detail.join('\n')).toBe('enforced')
  }, 120_000)
})
