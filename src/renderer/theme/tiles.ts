import { TILE_COLOR_COUNT, TILE_ICON_COUNT, type TileChoice } from '@shared/appearance'
import { parseColor, rgba } from './contrast'

/**
 * Project tile icons (24 × 24, drawn with a stroke) and colors. The first
 * eight icons and colors are the reference's (docs/design/home).
 */
export const TILE_ICONS: readonly string[] = [
  'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z',
  'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  'M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z',
  'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM3.5 16.5c-1.5 2 0 2.8 3 1.6 3.3-1.3 8.2-4.6 11-7.5 2.4-2.5 2.6-4.2.2-3.6',
  'M12 13v8M8.5 9.5a5 5 0 0 1 7 0M5.6 6.6a9 9 0 0 1 12.8 0M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z',
  'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  'M13 2L4 14h7l-1 8 9-12h-7z',
  'M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l7-7',
  'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  'M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'M4 5h16v11H9l-5 4z',
  'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5',
  'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  'M4 17l6-6-6-6M12 19h8',
  'M12 15l-3-3c1.5-5 5-8.5 11-9-.5 6-4 9.5-9 11zM9 12H5l2-4h4M12 15v4l4-2v-4M6 18c-1 1-1.5 2.5-1.5 2.5S6 20 7 19',
  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  'M3 4h2l2.4 11h11L21 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  'M4 20V10M10 20V4M16 20v-7M22 20H2',
  'M6 9h12a4 4 0 0 1 0 8c-1.5 0-2.5-1-3.5-2h-5c-1 1-2 2-3.5 2a4 4 0 0 1 0-8zM8 11v4M6 13h4M16 12h.01M18 14h.01',
  'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
  'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3',
  'M12 20c-3 0-5-1.5-5-3.5S9 12 12 12s5 2.5 5 4.5-2 3.5-5 3.5zM4.4 10a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0zM16.4 10a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0zM7.4 6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0zM13.4 6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0z',
  'M5 16h14M5 16v2M19 16v2M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16zM7.5 13.5h.01M16.5 13.5h.01',
  'M10.5 4.5a1.5 1.5 0 0 1 3 0V9l7 4v2l-7-2v4l2 1.5V20l-3.5-1-3.5 1v-1.5l2-1.5v-4l-7 2v-2l7-4z',
  'M3 6h18v12H3zM3 7l9 6 9-6',
  'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-1-3-5-4-5-1.5S10 7 12 7zM12 7c1-3 5-4 5-1.5S14 7 12 7z',
  'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  'M12 2v20M17 6.5C16 5 14.2 4.5 12 4.5c-2.8 0-4.5 1.3-4.5 3.2 0 4.3 9.5 2.3 9.5 7 0 2-1.9 3.3-5 3.3-2.3 0-4.2-.7-5.2-2.3',
  'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M13.5 9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0z',
  'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10',
  'M5 9h14v10H5zM12 5v4M11 4a1 1 0 1 0 2 0 1 1 0 1 0-2 0zM9 13h.01M15 13h.01M9.5 16.5h5',
  'M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z'
]

/** Top and bottom of the gradient, and the icon's color on it. */
export const TILE_COLORS: ReadonlyArray<{ from: string; to: string; glyph: string }> = [
  { from: '#3cc4b0', to: '#1d8a7c', glyph: '#ffffff' },
  { from: '#ff9a5c', to: '#e0602a', glyph: '#ffffff' },
  { from: '#fbf6ec', to: '#e3d9c6', glyph: '#b8401c' },
  { from: '#ff7fa0', to: '#d9416a', glyph: '#ffffff' },
  { from: '#9b8cff', to: '#6450e6', glyph: '#ffffff' },
  { from: '#62a8ff', to: '#2f6fe0', glyph: '#ffffff' },
  { from: '#ffd166', to: '#e9a91c', glyph: '#3a2600' },
  { from: '#6fdc8c', to: '#2fa65a', glyph: '#ffffff' },
  { from: '#ff8a7a', to: '#d63b2f', glyph: '#ffffff' },
  { from: '#7fd6ff', to: '#2f9fd8', glyph: '#ffffff' },
  { from: '#9aa7bd', to: '#5b6881', glyph: '#ffffff' },
  { from: '#d4f06b', to: '#9cc21f', glyph: '#2a3300' }
]

void [TILE_ICON_COUNT, TILE_COLOR_COUNT]
if (TILE_ICONS.length !== TILE_ICON_COUNT || TILE_COLORS.length !== TILE_COLOR_COUNT) throw new Error('tile sets out of step with shared/appearance')

/** A stable number for a project id (FNV-1a), so its generated tile never changes. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export interface TileLook {
  icon: string
  iconIndex: number
  colorIndex: number
  background: string
  shadow: string
  glyph: string
}

/** The project's tile: what the user picked, or the one generated from its id. */
export function tileLook(projectId: string, choice?: TileChoice): TileLook {
  const h = hash(projectId)
  const iconIndex = choice?.icon ?? h % TILE_ICON_COUNT
  const colorIndex = choice?.color ?? (h >>> 8) % TILE_COLOR_COUNT
  const c = TILE_COLORS[colorIndex]!
  return {
    icon: TILE_ICONS[iconIndex]!,
    iconIndex,
    colorIndex,
    background: `linear-gradient(160deg, ${c.from}, ${c.to})`,
    shadow: rgba(parseColor(c.to), 0.42),
    glyph: c.glyph
  }
}
