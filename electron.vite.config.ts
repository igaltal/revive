import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // The file server for plain pages runs as its own process, so it is its own entry.
        input: { index: resolve('src/main/index.ts'), 'static-server': resolve('src/main/services/runner/static-server.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { ...shared, '@': resolve('src/renderer') } },
    plugins: [react(), tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    // Never inline assets as data: URIs; the CSP only allows the app's own files.
    build: { assetsInlineLimit: 0, rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
