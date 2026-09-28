import { z } from 'zod'

/**
 * How Revive looks on one device. Kept on the computer doing the work (the
 * Host, or this computer in local mode), one set per device, so a phone and
 * a MacBook can look different. Language stays in Settings, as before.
 */

export const THEMES = ['scenic', 'paper'] as const
export const SCENE_CHOICES = ['auto', 'dawn', 'day', 'dusk', 'night'] as const
export const GLASS_STRENGTHS = ['light', 'normal', 'strong'] as const
export const ACCENT_NAMES = ['blue', 'teal', 'orange', 'pink', 'violet', 'gold'] as const
export const WIDGET_IDS = ['command', 'tiles', 'vitals', 'agents', 'uptime'] as const
export const DENSITIES = ['compact', 'comfortable', 'large'] as const
export const MOTIONS = ['full', 'reduced', 'off'] as const
export const SCREENSAVER_MODES = ['scene', 'activity', 'photos', 'dark'] as const
/** 0 means never. */
export const IDLE_MINUTES = [0, 1, 2, 5, 10, 15, 30, 60] as const
/** The tile icon set and color set sizes (the pictures live in the renderer's theme). */
export const TILE_ICON_COUNT = 40
export const TILE_COLOR_COUNT = 12
export const MAX_PHOTOS = 12
/** A photo, already made smaller on the device: at most this many bytes of JPEG. */
export const MAX_PHOTO_BYTES = 700 * 1024

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i)
export const PHOTO_ID = /^[a-f0-9]{24}$/

export type WidgetId = (typeof WIDGET_IDS)[number]

export const PhotoSchema = z.object({
  id: z.string().regex(PHOTO_ID),
  /** The brightest spot of the (blurred) photo, measured when it was added: what the dimming is computed from. */
  worst: Hex,
  addedAt: z.string()
})
export type Photo = z.infer<typeof PhotoSchema>

const TileSchema = z.object({
  /** null: the generated one. */
  icon: z.number().int().min(0).max(TILE_ICON_COUNT - 1).nullable(),
  color: z.number().int().min(0).max(TILE_COLOR_COUNT - 1).nullable(),
  pinned: z.boolean()
})
export type TileChoice = z.infer<typeof TileSchema>

const Widgets = z
  .array(z.object({ id: z.enum(WIDGET_IDS), visible: z.boolean() }))
  .length(WIDGET_IDS.length)
  .refine((w) => new Set(w.map((x) => x.id)).size === WIDGET_IDS.length, 'each widget once')

export const AppearanceSchema = z.object({
  /** null: Scenic in Host and client mode, Paper in local mode. */
  theme: z.enum(THEMES).nullable(),
  scene: z.enum(SCENE_CHOICES),
  /** Where sunrise and sunset are taken from; null: the city of the device's time zone. */
  city: z.string().max(40).nullable(),
  /** A personal photo behind the glass instead of the scene (one of `photos`). */
  background: z.string().regex(PHOTO_ID).nullable(),
  photos: z.array(PhotoSchema).max(MAX_PHOTOS),
  glass: z.enum(GLASS_STRENGTHS),
  /** A preset name, a custom color, or null for the theme's own. */
  accent: z.union([z.enum(ACCENT_NAMES), Hex]).nullable(),
  widgets: Widgets,
  tiles: z.record(z.string().max(80), TileSchema),
  density: z.enum(DENSITIES),
  clock: z.object({ hours: z.enum(['24', '12']), seconds: z.boolean(), date: z.boolean() }),
  motion: z.enum(MOTIONS),
  screensaver: z.object({
    mode: z.enum(SCREENSAVER_MODES),
    idleMinutes: z.number().int().refine((n) => (IDLE_MINUTES as readonly number[]).includes(n), 'one of the offered idle times'),
    wake: z.object({ waiting: z.boolean(), failed: z.boolean(), finished: z.boolean() })
  })
})
export type Appearance = z.infer<typeof AppearanceSchema>

export const DEFAULT_APPEARANCE: Appearance = {
  theme: null,
  scene: 'auto',
  city: null,
  background: null,
  photos: [],
  glass: 'normal',
  accent: null,
  widgets: WIDGET_IDS.map((id) => ({ id, visible: true })),
  tiles: {},
  density: 'comfortable',
  clock: { hours: '24', seconds: false, date: true },
  motion: 'full',
  screensaver: { mode: 'scene', idleMinutes: 5, wake: { waiting: true, failed: true, finished: false } }
}

/** Photos are added and removed with their own calls, never through a patch. */
export const AppearancePatchSchema = AppearanceSchema.omit({ photos: true }).partial()
export type AppearancePatch = z.infer<typeof AppearancePatchSchema>

/** The sections of the Customize screen, each with its own "Reset to default". */
export const APPEARANCE_SECTIONS = {
  theme: ['theme'],
  scene: ['scene', 'city'],
  background: ['background'],
  glass: ['glass'],
  accent: ['accent'],
  widgets: ['widgets'],
  tiles: ['tiles', 'density'],
  clock: ['clock'],
  motion: ['motion'],
  screensaver: ['screensaver']
} as const satisfies Record<string, ReadonlyArray<keyof AppearancePatch>>
export type AppearanceSection = keyof typeof APPEARANCE_SECTIONS

export function resetSection(section: AppearanceSection): AppearancePatch {
  const patch: Record<string, unknown> = {}
  for (const key of APPEARANCE_SECTIONS[section]) patch[key] = structuredClone(DEFAULT_APPEARANCE[key])
  return patch as AppearancePatch
}

export function photoPath(id: string): string {
  return `/photos/${id}.jpg`
}

export function parsePhotoPath(pathname: string): string | null {
  const m = /^\/photos\/([a-f0-9]{24})\.jpg$/.exec(pathname)
  return m ? m[1]! : null
}
