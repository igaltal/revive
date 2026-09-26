import type { Manifest } from './manifest'

/** Test data only. */
export const sampleManifest = (): Manifest => ({
  version: 2,
  scanned_at: '2026-09-26T10:00:00.000Z',
  projects: [
    {
      id: 'bakery-site',
      name: 'Sunrise Bakery',
      path: 'bakery-site',
      description: { en: 'A website for a neighborhood bakery.', he: 'אתר למאפייה שכונתית.' },
      stack: ['html'],
      status: 'unknown',
      run: { install: null, dev: null, port: null, url: null, verified_at: null },
      keys: [],
      notes: [],
      user_locked: []
    }
  ],
  loose_files: ['notes.txt'],
  suggested_reorg: []
})
