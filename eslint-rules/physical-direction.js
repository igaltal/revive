/**
 * Layout must use logical properties (start/end, ps/pe, ms/me) so one design
 * serves both right-to-left and left-to-right. This rule rejects Tailwind
 * classes that hard-code left or right.
 */
export const PHYSICAL_CLASS =
  /(?:^|[\s"'`:])!?-?(?:m[lr]|p[lr]|scroll-[mp][lr]|left|right|inset-[xy]?-?|border-[lr]|rounded-(?:[lr]|[tb][lr])|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right)|space-x-reverse|origin-(?:left|right|top-left|top-right|bottom-left|bottom-right)|bg-(?:left|right)(?:-top|-bottom)?)(?:-|$|[\s"'`])/

/** Physical CSS declarations in stylesheets. */
export const PHYSICAL_CSS =
  /\b(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/m

function check(context, node, value) {
  if (typeof value === 'string' && PHYSICAL_CLASS.test(value)) {
    context.report({
      node,
      message: 'Use logical classes (ms/me, ps/pe, start/end, text-start/text-end) instead of left/right.'
    })
  }
}

const CLASS_HELPERS = new Set(['cx', 'clsx', 'classNames'])

export default {
  rules: {
    'no-physical-direction': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const inClassContext = (node) => {
          for (let p = node.parent; p; p = p.parent) {
            if (p.type === 'JSXAttribute') return p.name.name === 'className'
            if (p.type === 'CallExpression' && p.callee.type === 'Identifier' && CLASS_HELPERS.has(p.callee.name)) return true
            if (p.type === 'Property' && p.parent?.type === 'ObjectExpression' && /class|styles|variants/i.test(context.sourceCode.getText(p.parent.parent?.id ?? p.parent))) return true
          }
          return false
        }
        return {
          Literal(node) {
            if (inClassContext(node)) check(context, node, node.value)
          },
          TemplateElement(node) {
            if (inClassContext(node)) check(context, node, node.value.cooked)
          }
        }
      }
    }
  }
}
