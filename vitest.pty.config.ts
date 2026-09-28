import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Tests that need a real pseudo-terminal (node-pty) and real tmux. node-pty is
 * built for Electron, so this runs under Electron in Node mode:
 * `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --config vitest.pty.config.ts`
 */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer') } },
  test: {
    include: ['src/**/*.pty.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false
  }
})
