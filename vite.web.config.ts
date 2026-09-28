import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

/**
 * The service worker, written from the build's own file list: it caches the
 * app shell (the page, its scripts, styles, fonts, icons, manifest) and
 * nothing else. API calls, pictures, pairing and terminal output always go
 * to the network and are never stored.
 */
function serviceWorker(): Plugin {
  return {
    name: 'revive-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'web.html')
      const shell = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png', ...files.map((f) => `/${f}`)]
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Revive's service worker: the app shell only. Generated at build time.
const CACHE = 'revive-shell-${version}'
const SHELL = ${JSON.stringify(shell)}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Pages: the network first; offline, the cached shell (which then says the Host can't be reached).
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')))
    return
  }
  // The shell's own files, from the cache. Nothing is ever added to it at runtime.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(e.request)))
  }
  // Everything else (the API, pictures, pairing, terminal output) goes to the network, uncached.
})
`
      })
    }
  }
}

/** The renderer as a web app, served by the Host to browsers and phones. */
export default defineConfig({
  root: 'src/renderer',
  publicDir: resolve('src/renderer/web/public'),
  base: '/',
  resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer') } },
  plugins: [react(), tailwindcss(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve('src/renderer/web.html') }
  }
})
