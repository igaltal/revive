/**
 * Places to take sunrise and sunset from. Bundled, so choosing the sky never
 * needs the network. The default is the city of the device's time zone.
 */
export interface City {
  id: string
  en: string
  he: string
  lat: number
  lon: number
  tz: string
}

export const CITIES: readonly City[] = [
  { id: 'jerusalem', en: 'Jerusalem', he: 'ירושלים', lat: 31.778, lon: 35.235, tz: 'Asia/Jerusalem' },
  { id: 'tel-aviv', en: 'Tel Aviv', he: 'תל אביב', lat: 32.085, lon: 34.782, tz: 'Asia/Jerusalem' },
  { id: 'haifa', en: 'Haifa', he: 'חיפה', lat: 32.794, lon: 34.99, tz: 'Asia/Jerusalem' },
  { id: 'beer-sheva', en: 'Beersheba', he: 'באר שבע', lat: 31.252, lon: 34.791, tz: 'Asia/Jerusalem' },
  { id: 'eilat', en: 'Eilat', he: 'אילת', lat: 29.558, lon: 34.952, tz: 'Asia/Jerusalem' },
  { id: 'london', en: 'London', he: 'לונדון', lat: 51.507, lon: -0.128, tz: 'Europe/London' },
  { id: 'dublin', en: 'Dublin', he: 'דבלין', lat: 53.35, lon: -6.26, tz: 'Europe/Dublin' },
  { id: 'lisbon', en: 'Lisbon', he: 'ליסבון', lat: 38.722, lon: -9.139, tz: 'Europe/Lisbon' },
  { id: 'madrid', en: 'Madrid', he: 'מדריד', lat: 40.417, lon: -3.704, tz: 'Europe/Madrid' },
  { id: 'barcelona', en: 'Barcelona', he: 'ברצלונה', lat: 41.385, lon: 2.173, tz: 'Europe/Madrid' },
  { id: 'paris', en: 'Paris', he: 'פריז', lat: 48.857, lon: 2.352, tz: 'Europe/Paris' },
  { id: 'amsterdam', en: 'Amsterdam', he: 'אמסטרדם', lat: 52.37, lon: 4.895, tz: 'Europe/Amsterdam' },
  { id: 'brussels', en: 'Brussels', he: 'בריסל', lat: 50.85, lon: 4.352, tz: 'Europe/Brussels' },
  { id: 'berlin', en: 'Berlin', he: 'ברלין', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin' },
  { id: 'zurich', en: 'Zurich', he: 'ציריך', lat: 47.377, lon: 8.54, tz: 'Europe/Zurich' },
  { id: 'rome', en: 'Rome', he: 'רומא', lat: 41.903, lon: 12.496, tz: 'Europe/Rome' },
  { id: 'vienna', en: 'Vienna', he: 'וינה', lat: 48.208, lon: 16.373, tz: 'Europe/Vienna' },
  { id: 'prague', en: 'Prague', he: 'פראג', lat: 50.075, lon: 14.437, tz: 'Europe/Prague' },
  { id: 'warsaw', en: 'Warsaw', he: 'ורשה', lat: 52.23, lon: 21.012, tz: 'Europe/Warsaw' },
  { id: 'stockholm', en: 'Stockholm', he: 'שטוקהולם', lat: 59.329, lon: 18.069, tz: 'Europe/Stockholm' },
  { id: 'oslo', en: 'Oslo', he: 'אוסלו', lat: 59.914, lon: 10.752, tz: 'Europe/Oslo' },
  { id: 'copenhagen', en: 'Copenhagen', he: 'קופנהגן', lat: 55.676, lon: 12.568, tz: 'Europe/Copenhagen' },
  { id: 'helsinki', en: 'Helsinki', he: 'הלסינקי', lat: 60.17, lon: 24.938, tz: 'Europe/Helsinki' },
  { id: 'athens', en: 'Athens', he: 'אתונה', lat: 37.984, lon: 23.728, tz: 'Europe/Athens' },
  { id: 'bucharest', en: 'Bucharest', he: 'בוקרשט', lat: 44.427, lon: 26.103, tz: 'Europe/Bucharest' },
  { id: 'kyiv', en: 'Kyiv', he: 'קייב', lat: 50.45, lon: 30.524, tz: 'Europe/Kyiv' },
  { id: 'istanbul', en: 'Istanbul', he: 'איסטנבול', lat: 41.008, lon: 28.978, tz: 'Europe/Istanbul' },
  { id: 'moscow', en: 'Moscow', he: 'מוסקבה', lat: 55.756, lon: 37.617, tz: 'Europe/Moscow' },
  { id: 'cairo', en: 'Cairo', he: 'קהיר', lat: 30.044, lon: 31.236, tz: 'Africa/Cairo' },
  { id: 'nicosia', en: 'Nicosia', he: 'ניקוסיה', lat: 35.185, lon: 33.382, tz: 'Asia/Nicosia' },
  { id: 'amman', en: 'Amman', he: 'עמאן', lat: 31.954, lon: 35.911, tz: 'Asia/Amman' },
  { id: 'dubai', en: 'Dubai', he: 'דובאי', lat: 25.205, lon: 55.271, tz: 'Asia/Dubai' },
  { id: 'lagos', en: 'Lagos', he: 'לאגוס', lat: 6.524, lon: 3.379, tz: 'Africa/Lagos' },
  { id: 'nairobi', en: 'Nairobi', he: 'ניירובי', lat: -1.292, lon: 36.822, tz: 'Africa/Nairobi' },
  { id: 'johannesburg', en: 'Johannesburg', he: 'יוהנסבורג', lat: -26.204, lon: 28.047, tz: 'Africa/Johannesburg' },
  { id: 'cape-town', en: 'Cape Town', he: 'קייפטאון', lat: -33.925, lon: 18.424, tz: 'Africa/Johannesburg' },
  { id: 'mumbai', en: 'Mumbai', he: 'מומבאי', lat: 19.076, lon: 72.878, tz: 'Asia/Kolkata' },
  { id: 'delhi', en: 'Delhi', he: 'דלהי', lat: 28.614, lon: 77.209, tz: 'Asia/Kolkata' },
  { id: 'bangkok', en: 'Bangkok', he: 'בנגקוק', lat: 13.756, lon: 100.502, tz: 'Asia/Bangkok' },
  { id: 'singapore', en: 'Singapore', he: 'סינגפור', lat: 1.352, lon: 103.82, tz: 'Asia/Singapore' },
  { id: 'hong-kong', en: 'Hong Kong', he: 'הונג קונג', lat: 22.32, lon: 114.169, tz: 'Asia/Hong_Kong' },
  { id: 'shanghai', en: 'Shanghai', he: 'שנגחאי', lat: 31.23, lon: 121.474, tz: 'Asia/Shanghai' },
  { id: 'beijing', en: 'Beijing', he: 'בייג׳ינג', lat: 39.904, lon: 116.407, tz: 'Asia/Shanghai' },
  { id: 'taipei', en: 'Taipei', he: 'טאיפיי', lat: 25.033, lon: 121.565, tz: 'Asia/Taipei' },
  { id: 'seoul', en: 'Seoul', he: 'סיאול', lat: 37.567, lon: 126.978, tz: 'Asia/Seoul' },
  { id: 'tokyo', en: 'Tokyo', he: 'טוקיו', lat: 35.676, lon: 139.65, tz: 'Asia/Tokyo' },
  { id: 'sydney', en: 'Sydney', he: 'סידני', lat: -33.869, lon: 151.209, tz: 'Australia/Sydney' },
  { id: 'melbourne', en: 'Melbourne', he: 'מלבורן', lat: -37.814, lon: 144.963, tz: 'Australia/Melbourne' },
  { id: 'perth', en: 'Perth', he: 'פרת׳', lat: -31.95, lon: 115.86, tz: 'Australia/Perth' },
  { id: 'auckland', en: 'Auckland', he: 'אוקלנד', lat: -36.848, lon: 174.763, tz: 'Pacific/Auckland' },
  { id: 'honolulu', en: 'Honolulu', he: 'הונולולו', lat: 21.307, lon: -157.858, tz: 'Pacific/Honolulu' },
  { id: 'anchorage', en: 'Anchorage', he: 'אנקורג׳', lat: 61.218, lon: -149.9, tz: 'America/Anchorage' },
  { id: 'los-angeles', en: 'Los Angeles', he: 'לוס אנג׳לס', lat: 34.052, lon: -118.244, tz: 'America/Los_Angeles' },
  { id: 'san-francisco', en: 'San Francisco', he: 'סן פרנסיסקו', lat: 37.775, lon: -122.419, tz: 'America/Los_Angeles' },
  { id: 'seattle', en: 'Seattle', he: 'סיאטל', lat: 47.606, lon: -122.332, tz: 'America/Los_Angeles' },
  { id: 'vancouver', en: 'Vancouver', he: 'ונקובר', lat: 49.283, lon: -123.121, tz: 'America/Vancouver' },
  { id: 'denver', en: 'Denver', he: 'דנוור', lat: 39.739, lon: -104.99, tz: 'America/Denver' },
  { id: 'phoenix', en: 'Phoenix', he: 'פיניקס', lat: 33.448, lon: -112.074, tz: 'America/Phoenix' },
  { id: 'mexico-city', en: 'Mexico City', he: 'מקסיקו סיטי', lat: 19.433, lon: -99.133, tz: 'America/Mexico_City' },
  { id: 'chicago', en: 'Chicago', he: 'שיקגו', lat: 41.878, lon: -87.63, tz: 'America/Chicago' },
  { id: 'austin', en: 'Austin', he: 'אוסטין', lat: 30.267, lon: -97.743, tz: 'America/Chicago' },
  { id: 'toronto', en: 'Toronto', he: 'טורונטו', lat: 43.653, lon: -79.383, tz: 'America/Toronto' },
  { id: 'new-york', en: 'New York', he: 'ניו יורק', lat: 40.713, lon: -74.006, tz: 'America/New_York' },
  { id: 'boston', en: 'Boston', he: 'בוסטון', lat: 42.36, lon: -71.059, tz: 'America/New_York' },
  { id: 'miami', en: 'Miami', he: 'מיאמי', lat: 25.762, lon: -80.192, tz: 'America/New_York' },
  { id: 'bogota', en: 'Bogotá', he: 'בוגוטה', lat: 4.711, lon: -74.072, tz: 'America/Bogota' },
  { id: 'lima', en: 'Lima', he: 'לימה', lat: -12.046, lon: -77.043, tz: 'America/Lima' },
  { id: 'santiago', en: 'Santiago', he: 'סנטיאגו', lat: -33.449, lon: -70.669, tz: 'America/Santiago' },
  { id: 'buenos-aires', en: 'Buenos Aires', he: 'בואנוס איירס', lat: -34.604, lon: -58.382, tz: 'America/Argentina/Buenos_Aires' },
  { id: 'sao-paulo', en: 'São Paulo', he: 'סאו פאולו', lat: -23.551, lon: -46.633, tz: 'America/Sao_Paulo' }
]

export function cityById(id: string | null | undefined): City | undefined {
  return id ? CITIES.find((c) => c.id === id) : undefined
}

/**
 * The city for a time zone: one in that zone, else one at the same UTC offset
 * right now, else a point on the equator at the zone's longitude.
 */
export function cityForTimeZone(tz: string, now = new Date()): City {
  const exact = CITIES.find((c) => c.tz === tz)
  if (exact) return exact
  const offset = offsetMinutes(tz, now)
  if (offset !== null) {
    const same = CITIES.find((c) => offsetMinutes(c.tz, now) === offset)
    if (same) return same
    return { id: 'offset', en: tz, he: tz, lat: 0, lon: (offset / 60) * 15, tz }
  }
  return CITIES[0]!
}

function offsetMinutes(tz: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
    if (!m) return name === 'GMT' ? 0 : null
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
  } catch {
    return null
  }
}
