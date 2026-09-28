/**
 * Colors live in the theme (src/renderer/theme): tokens and scene palettes.
 * Everywhere else in the renderer a color is a token name (`bg-card`,
 * `text-muted`, `var(--color-accent)`), so both looks and every accent work
 * without touching components. This rule rejects raw colors in any string.
 */

/** #rgb, #rrggbb and the alpha forms. */
export const HEX_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/i

/** Color functions: rgb(), hsl(), oklch() and the rest. `color-mix(in oklab, ...)` is fine: it names a space, not a color. */
export const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i

const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

/** Tailwind's built-in palette (`bg-white`, `text-red-600`, `ring-black/10`). */
export const PALETTE_CLASS = new RegExp(`(?:^|[\\s"'\`:!])-?(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|divide|placeholder|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?=$|[\\s"'\`])`)

/** Named colors as CSS values (`color: white`, `'black'`). */
export const NAMED_COLOR = /(?:^|[\s(,:])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|maroon|olive|teal|aqua|fuchsia|lime)(?=$|[\s),;])/i

export function rawColorIn(value) {
  if (typeof value !== 'string') return null
  for (const re of [HEX_COLOR, COLOR_FUNCTION, PALETTE_CLASS, NAMED_COLOR]) {
    const m = re.exec(value)
    if (m) return m[0].trim()
  }
  return null
}

export default {
  rules: {
    'no-raw-color': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const report = (node, value) => {
          const found = rawColorIn(value)
          if (found) context.report({ node, message: `Raw color "${found}": use a theme token (src/renderer/theme) instead.` })
        }
        return {
          Literal(node) {
            report(node, node.value)
          },
          TemplateElement(node) {
            report(node, node.value.cooked)
          },
          JSXText(node) {
            report(node, node.value)
          }
        }
      }
    }
  }
}
