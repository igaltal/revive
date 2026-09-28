import { defineConfig } from '@playwright/test'

/** The built, installed app (npm run test:packaged): separate from the dev-build suite. */
export default defineConfig({
  testDir: '.',
  testMatch: 'packaged.spec.ts',
  timeout: 300_000,
  workers: 1,
  reporter: 'list'
})
