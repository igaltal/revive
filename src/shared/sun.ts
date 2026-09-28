/**
 * Sunrise and sunset from a date and a place, computed here (NOAA's solar
 * position equations). No network call. Accurate to a minute or two, which
 * is plenty for choosing a picture of the sky.
 */

const RAD = Math.PI / 180
const DAY_MS = 86_400_000

export interface SunTimes {
  /** Null in polar day or night. */
  sunrise: Date | null
  sunset: Date | null
  /** When there is no sunrise or sunset: whether the sun stays up all day. */
  polar: 'day' | 'night' | null
}

/** Sunrise and sunset on the UTC calendar day of `date`, at latitude/longitude in degrees (east positive). */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  // Julian century at local noon (roughly), for the sun's position that day.
  const noonGuess = dayStart + DAY_MS / 2 - (lon / 360) * DAY_MS
  const jc = (noonGuess / DAY_MS + 2440587.5 - 2451545) / 36525

  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
  const center = Math.sin(meanAnom * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * meanAnom * RAD) * 0.000289
  const trueLong = meanLong + center
  const omega = 125.04 - 1934.136 * jc
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD)
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD)) / RAD

  const y = Math.tan((obliq / 2) * RAD) ** 2
  const eqTime =
    4 *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * ecc * Math.sin(meanAnom * RAD) +
      4 * ecc * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * ecc * ecc * Math.sin(2 * meanAnom * RAD)) /
    RAD

  // The sun's center 0.833° below the horizon (refraction and its radius).
  const cosHa = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl * RAD)) - Math.tan(lat * RAD) * Math.tan(decl * RAD)
  const solarNoonMin = 720 - 4 * lon - eqTime
  if (cosHa > 1) return { sunrise: null, sunset: null, polar: 'night' }
  if (cosHa < -1) return { sunrise: null, sunset: null, polar: 'day' }
  const ha = Math.acos(cosHa) / RAD
  return {
    sunrise: new Date(dayStart + (solarNoonMin - ha * 4) * 60_000),
    sunset: new Date(dayStart + (solarNoonMin + ha * 4) * 60_000),
    polar: null
  }
}

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night'

/** Dawn runs from 40 minutes before sunrise to 50 after; dusk from 50 before sunset to 40 after. */
export const TWILIGHT = { before: 40 * 60_000, after: 50 * 60_000 } as const

/** Which sky it is at this moment, at this place. */
export function skyAt(now: Date, lat: number, lon: number): SkyPhase {
  // The sun's day for this place: the UTC day of the local solar date.
  const localSolar = new Date(now.getTime() + (lon / 360) * DAY_MS)
  const t = sunTimes(localSolar, lat, lon)
  if (t.polar) return t.polar
  const ms = now.getTime()
  const rise = t.sunrise!.getTime()
  const set = t.sunset!.getTime()
  if (ms >= rise - TWILIGHT.before && ms < rise + TWILIGHT.after) return 'dawn'
  if (ms >= set - TWILIGHT.after && ms < set + TWILIGHT.before) return 'dusk'
  if (ms >= rise + TWILIGHT.after && ms < set - TWILIGHT.after) return 'day'
  return 'night'
}

/** The next moment the sky changes, so a screen can switch then instead of polling. */
export function nextSkyChange(now: Date, lat: number, lon: number): Date {
  const start = skyAt(now, lat, lon)
  // Step a minute at a time for up to a day: cheap, and immune to edge cases around midnight.
  for (let m = 1; m <= 24 * 60; m++) {
    const t = new Date(now.getTime() + m * 60_000)
    if (skyAt(t, lat, lon) !== start) return t
  }
  return new Date(now.getTime() + DAY_MS)
}
