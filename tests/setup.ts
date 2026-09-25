import { afterEach } from 'vitest'

// React Testing Library only auto-cleans when test globals are on.
afterEach(async () => {
  if (!('document' in globalThis)) return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
