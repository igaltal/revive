import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectProjects, idFromPath, isCloudOnly, isSecretFile, keysInEnvExample, keysInSource, portFromScript, readableName } from './detect'

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'revive-detect-'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}

describe('finding projects on this computer', () => {
  it('finds each kind of project, how it runs and on which port, from its files alone', async () => {
    const root = tree({
      'shop/package.json': JSON.stringify({ name: 'my-shop', scripts: { dev: 'next dev -p 3100' }, dependencies: { next: '15', react: '19' } }),
      'shop/pnpm-lock.yaml': '',
      'shop/app/page.tsx': 'const k = process.env.STRIPE_SECRET_KEY\nconst url = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost"\nconst env = process.env.NODE_ENV',
      'shop/.env.example': 'STRIPE_SECRET_KEY=\nSUPABASE_URL=https://example\n',
      'shop/.env': 'STRIPE_SECRET_KEY=sk_live_REAL_SECRET_VALUE',
      'site/index.html': '<html><head><title>Sunrise Bakery</title><meta name="description" content="Fresh bread"></head><body><h1>Welcome</h1><script>var x=1</script></body></html>',
      'site/style.css': 'body{}',
      'tools/api/requirements.txt': 'fastapi\nuvicorn\n',
      'tools/api/main.py': 'import os\nkey = os.environ["OPENAI_API_KEY"]\nport = os.getenv("PORT", "8000")',
      'tools/api/venv_py39/pyvenv.cfg': 'home = /usr/bin',
      'tools/api/venv_py39/lib/huge.py': 'x',
      'dash/package.json': JSON.stringify({ name: 'vite-project', scripts: { dev: 'vite' }, devDependencies: { vite: '7', react: '19' } }),
      'dash/vite.config.js': 'export default { server: { port: 5333 } }',
      'dash/node_modules/react/package.json': '{}',
      'notes.txt': 'hello',
      '.DS_Store': ''
    })
    const d = await detectProjects(root)
    const by = Object.fromEntries(d.projects.map((p) => [p.path, p]))
    expect(Object.keys(by).sort()).toEqual(['dash', 'shop', 'site', 'tools/api'])
    expect(d.looseFiles).toEqual(['notes.txt'])

    expect(by['shop']).toMatchObject({ id: 'shop', name: 'My shop', stack: ['next', 'react'], run: { install: 'pnpm install', dev: 'pnpm run dev', port: 3100 } })
    // Names only; required when listed in the example or used without a fallback; settings like NODE_ENV aren't keys.
    expect(by['shop']!.keys).toEqual([
      { key: 'NEXT_PUBLIC_SITE_URL', required: false, seenIn: ['app/page.tsx'] },
      { key: 'STRIPE_SECRET_KEY', required: true, seenIn: ['.env.example', 'app/page.tsx'] },
      { key: 'SUPABASE_URL', required: true, seenIn: ['.env.example'] }
    ])
    // The real .env was never opened: its value is nowhere.
    expect(JSON.stringify(d)).not.toContain('sk_live_REAL_SECRET_VALUE')
    expect(JSON.stringify(d)).not.toContain('https://example')

    expect(by['site']).toMatchObject({ name: 'Sunrise Bakery', stack: ['html'], run: { install: null, dev: null, port: null } })
    expect(by['site']!.digest.pageText).toBe('Fresh bread — Welcome')

    expect(by['tools/api']).toMatchObject({ stack: ['python', 'fastapi'], run: { install: 'pip install -r requirements.txt' } })
    expect(by['tools/api']!.keys.map((k) => k.key)).toEqual(['OPENAI_API_KEY'])
    // The Python environment (named oddly, found by its pyvenv.cfg) isn't walked.
    expect(by['tools/api']!.files).toBe(2)

    // A generic package name falls back to the folder; the port comes from the config.
    expect(by['dash']).toMatchObject({ name: 'Dash', run: { dev: 'npm run dev', port: 5333 } })
  })

  it('the fingerprint changes when a file changes, and only then', async () => {
    const root = tree({ 'a/index.html': '<title>A</title>', 'b/index.html': '<title>B</title>' })
    const first = await detectProjects(root)
    const again = await detectProjects(root)
    expect(again.projects.map((p) => p.fingerprint)).toEqual(first.projects.map((p) => p.fingerprint))
    writeFileSync(join(root, 'b/about.html'), 'new page')
    const after = await detectProjects(root)
    expect(after.projects[0]!.fingerprint).toBe(first.projects[0]!.fingerprint)
    expect(after.projects[1]!.fingerprint).not.toBe(first.projects[1]!.fingerprint)
  })

  it('a folder that is itself one project', async () => {
    const root = tree({ 'package.json': JSON.stringify({ name: 'solo', scripts: { start: 'node server.js' }, dependencies: { express: '5' } }), 'server.js': 'app.listen(process.env.PORT ?? 3000)' })
    const d = await detectProjects(root)
    expect(d.projects).toHaveLength(1)
    expect(d.projects[0]).toMatchObject({ path: '.', name: 'Solo', run: { dev: 'npm start' } })
  })
})

describe('the small rules', () => {
  it('never opens secret files; example env files give names only', () => {
    for (const f of ['.env', '.env.local', '.env.production', 'server.pem', 'id_rsa', 'id_ed25519.pub', '.npmrc', 'gcp-credentials.json', 'firebase-service-account.json', 'secrets.yaml']) expect(isSecretFile(f), f).toBe(true)
    for (const f of ['.env.example', '.env.sample', 'package.json', 'keys.ts', 'environment.ts']) expect(isSecretFile(f), f).toBe(false)
    expect(keysInEnvExample('# comment\nexport API_KEY=abc\nDB_URL = x\nlower=1\n')).toEqual(['API_KEY', 'DB_URL'])
  })

  it('finds key names in code, and whether they have a fallback', () => {
    expect(keysInSource("const a = import.meta.env.VITE_MAPS_KEY\nconst b = process.env['DB_URL'] ?? 'x'\nos.getenv('TOKEN', 'y')\nDeno.env.get('DENO_KEY')")).toEqual([
      { key: 'VITE_MAPS_KEY', fallback: false },
      { key: 'DB_URL', fallback: true },
      { key: 'TOKEN', fallback: true },
      { key: 'DENO_KEY', fallback: false }
    ])
  })

  it('ports, names and ids', () => {
    expect(portFromScript('vite --port 5199')).toBe(5199)
    expect(portFromScript('next dev -p 3001')).toBe(3001)
    expect(portFromScript('PORT=4000 node x')).toBe(4000)
    expect(portFromScript('vite')).toBeNull()
    expect(readableName('habit-counter')).toBe('Habit counter')
    expect(readableName('@acme/big_app')).toBe('Big app')
    const taken = new Set<string>()
    expect(idFromPath('Projects/My App', taken)).toBe('projects-my-app')
    expect(idFromPath('Projects/My-App', taken)).toBe('projects-my-app-2')
    expect(idFromPath('פרויקט', taken)).toBe('project')
  })

  it('a file offloaded to iCloud (a size, no data here) is never opened', () => {
    expect(isCloudOnly({ size: 1887, blocks: 0 })).toBe(true)
    expect(isCloudOnly({ size: 0, blocks: 0 })).toBe(false)
    expect(isCloudOnly({ size: 1887, blocks: 8 })).toBe(false)
  })
})
