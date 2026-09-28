import { describe, expect, it } from 'vitest'
import { nextSkyChange, skyAt, sunTimes } from './sun'
import { cityById, cityForTimeZone } from './cities'

const near = (a: Date | null, iso: string, minutes = 6) => {
  expect(a).not.toBeNull()
  expect(Math.abs(a!.getTime() - new Date(iso).getTime()) / 60_000).toBeLessThanOrEqual(minutes)
}

describe('sunrise and sunset, computed here', () => {
  it('matches published times (within a few minutes)', () => {
    // Jerusalem, 28 September 2026: about 06:32 and 18:23 local (UTC+3).
    const jlm = sunTimes(new Date('2026-09-28T12:00:00Z'), 31.778, 35.235)
    near(jlm.sunrise, '2026-09-28T03:32:00Z')
    near(jlm.sunset, '2026-09-28T15:23:00Z')
    // London, 21 June 2026: about 04:43 and 21:21 local (UTC+1).
    const ldn = sunTimes(new Date('2026-06-21T12:00:00Z'), 51.507, -0.128)
    near(ldn.sunrise, '2026-06-21T03:43:00Z')
    near(ldn.sunset, '2026-06-21T20:21:00Z')
    // Sydney, 21 December 2026: about 05:41 and 20:05 local (UTC+11).
    const syd = sunTimes(new Date('2026-12-21T02:00:00Z'), -33.869, 151.209)
    near(syd.sunrise, '2026-12-20T18:41:00Z', 8)
    near(syd.sunset, '2026-12-21T09:05:00Z', 8)
  })

  it('knows polar day and night', () => {
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6).polar).toBe('day')
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), 78.2, 15.6).polar).toBe('night')
  })

  it('picks the sky by time of day', () => {
    const [lat, lon] = [31.778, 35.235]
    expect(skyAt(new Date('2026-09-28T09:00:00Z'), lat, lon)).toBe('day') // noon local
    expect(skyAt(new Date('2026-09-28T20:00:00Z'), lat, lon)).toBe('night') // 23:00 local
    expect(skyAt(new Date('2026-09-28T03:30:00Z'), lat, lon)).toBe('dawn') // 06:30 local
    expect(skyAt(new Date('2026-09-28T15:15:00Z'), lat, lon)).toBe('dusk') // 18:15 local
  })

  it('says when the sky changes next, so a screen can wake up then instead of polling', () => {
    const [lat, lon] = [31.778, 35.235]
    const next = nextSkyChange(new Date('2026-09-28T09:00:00Z'), lat, lon)
    expect(skyAt(next, lat, lon)).toBe('dusk')
    near(next, '2026-09-28T14:33:00Z', 8) // 50 minutes before sunset
  })
})

describe('the default city comes from the time zone', () => {
  it('uses a city in that zone, else one at the same offset, never the network', () => {
    expect(cityForTimeZone('Asia/Jerusalem').id).toBe('jerusalem')
    expect(cityForTimeZone('America/New_York').id).toBe('new-york')
    // A zone with no city in the list: one at the same UTC offset.
    expect(cityForTimeZone('Europe/Belgrade', new Date('2026-09-28T12:00:00Z')).tz).toMatch(/^Europe\//)
    expect(cityById('tokyo')?.lat).toBeCloseTo(35.676)
  })
})
