import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import revive from './eslint-rules/physical-direction.js'
import boundary from './eslint-rules/renderer-boundary.js'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, revive, boundary },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'revive/no-physical-direction': 'error',
      'boundary/renderer-boundary': 'error'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      // The renderer must go through typed IPC; no Node or Electron access.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*', 'fs', 'path', 'child_process', 'electron', 'node-pty', 'simple-git'], message: 'The renderer talks to the system only through the transport module (@/transport).' }] }
      ]
    }
  }
)
