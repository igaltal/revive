/**
 * The renderer reaches the rest of Revive only through one module,
 * src/renderer/transport/. That is what lets a remote client replace the
 * transport without touching a screen. This rule fails when:
 * - any renderer file imports or requires Electron;
 * - any renderer file outside the transport uses ipcRenderer or window.revive,
 *   or imports a transport implementation (screens see only the Transport interface).
 */
export const TRANSPORT_DIR = /[\\/]src[\\/]renderer[\\/]transport[\\/]/

const IMPLEMENTATION = /(?:^|\/)(?:ipc-transport|ws-transport)(?:\.ts)?$/

const isElectron = (source) => source === 'electron' || (typeof source === 'string' && source.startsWith('electron/'))

export default {
  rules: {
    'renderer-boundary': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const inTransport = TRANSPORT_DIR.test(context.filename)
        const electron = (node) => context.report({ node, message: 'The renderer never imports Electron. Use the transport module (@/transport).' })
        const outside = (node, what) => {
          if (!inTransport) context.report({ node, message: `${what} is only allowed in src/renderer/transport/. Use the transport module (@/transport).` })
        }
        return {
          ImportDeclaration(node) {
            if (isElectron(node.source.value)) electron(node)
            if (typeof node.source.value === 'string' && IMPLEMENTATION.test(node.source.value)) outside(node, 'A transport implementation')
          },
          ImportExpression(node) {
            if (node.source.type === 'Literal' && isElectron(node.source.value)) electron(node)
          },
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal' && isElectron(node.arguments[0].value)) electron(node)
          },
          Identifier(node) {
            if (node.name === 'ipcRenderer') outside(node, 'ipcRenderer')
          },
          MemberExpression(node) {
            const obj = node.object
            const prop = node.computed ? node.property.value : node.property.name
            if (obj.type === 'Identifier' && (obj.name === 'window' || obj.name === 'globalThis') && prop === 'revive') outside(node, 'window.revive')
          }
        }
      }
    }
  }
}
