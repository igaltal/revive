import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  // The installed app has its own run: npm run test:packaged (after npm run dist).
  testIgnore: 'packaged.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
