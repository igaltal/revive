import type { ReactNode } from 'react'
import type { Appearance } from '@shared/appearance'
import { useAppearanceMaybe } from '@/state/appearance'
import { tileLook } from '@/theme/tiles'

/** A project's icon on its color: the one it was given in Customize, or the one made from its id. */
export function TileIcon({ projectId, size, choice }: { projectId: string; size: number; choice?: Appearance['tiles'][string] }): ReactNode {
  const look = useAppearanceMaybe()?.look
  const tile = tileLook(projectId, choice ?? look?.tiles[projectId])
  return (
    <span
      aria-hidden
      data-icon={tile.iconIndex}
      data-color={tile.colorIndex}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.29, background: tile.background, color: tile.glyph, boxShadow: `inset 0 1px 0 color-mix(in oklab, ${tile.glyph} 35%, transparent), 0 8px 20px ${tile.shadow}` }}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d={tile.icon} />
      </svg>
    </span>
  )
}
