import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { redact } from '@shared/redact'

/**
 * Finds the projects in a folder and what can be known about them from their
 * files alone: kind, run commands, port, the names of the keys they use. No
 * AI, no network, nothing written. Fast enough to run on every reading.
 *
 * Never opened: secret files (.env, keys, certificates, credentials), .git,
 * dependencies and build output. From example env files (.env.example) only
 * the names are taken, never values.
 */

/** Folders never walked into: dependencies, build output, tool caches, version control. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.revive', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output', '.vercel', '.netlify',
  '.turbo', '.cache', '.parcel-cache', 'coverage', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', 'target', 'vendor',
  'Pods', 'DerivedData', '.gradle', '.idea', '.vscode', '.expo', '.angular', 'bower_components', 'tmp', '.tmp', 'logs'
])

/** Files never opened, even to look. */
export function isSecretFile(name: string): boolean {
  if (isEnvExample(name)) return false
  return /^\.env(\..*)?$|\.(pem|key|p12|pfx|crt|keystore|jks)$|^id_(rsa|ed25519|ecdsa|dsa)|^\.(npmrc|pypirc|netrc)$|credentials.*\.json$|service-account.*\.json$|^secrets?\./i.test(name)
}

export function isEnvExample(name: string): boolean {
  return /^\.env\.(example|sample|template|dist|defaults)$/i.test(name)
}

/** What makes a folder a project, strongest first. */
const MARKERS = ['package.json', 'deno.json', 'pyproject.toml', 'requirements.txt', 'manage.py', 'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json', 'pubspec.yaml', 'Package.swift', 'index.html', 'Dockerfile'] as const

const SOURCE_EXT = /\.(m?[jt]sx?|cjs|vue|svelte|astro|py|rb|go|rs|php|html)$/i
const MAX_DEPTH = 4
const MAX_FILES_PER_PROJECT = 5_000
const MAX_SOURCE_BYTES = 3 * 1024 * 1024
const MAX_FILE_BYTES = 256 * 1024

/** Names that are settings, not keys a person has to get somewhere. */
const NOT_KEYS = new Set(['NODE_ENV', 'PORT', 'HOST', 'HOSTNAME', 'DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR', 'CI', 'DEBUG', 'TZ', 'PWD', 'HOME', 'PATH', 'USER', 'SHELL', 'LANG', 'TERM', 'npm_package_version', 'VITE_APP_VERSION', 'PUBLIC_URL', 'NEXT_RUNTIME', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'NETLIFY'])

export interface DetectedKey {
  key: string
  /** Listed in an example env file, or used without a fallback. */
  required: boolean
  /** Where it was seen (relative to the project), a few at most. */
  seenIn: string[]
}

export interface ProjectDigest {
  packageName: string | null
  packageDescription: string | null
  title: string | null
  pageText: string | null
  readme: string | null
  scripts: Record<string, string>
  dependencies: string[]
  tree: string[]
  keys: string[]
}

export interface DetectedProject {
  id: string
  /** Relative to the chosen folder; "." when the folder itself is the project. */
  path: string
  /** A readable name from the files (Claude may suggest a better one). */
  name: string
  stack: string[]
  run: { install: string | null; dev: string | null; port: number | null }
  keys: DetectedKey[]
  /** What the understanding step gets to read: a summary, never the files. */
  digest: ProjectDigest
  /** Changes whenever a file in the project changes (path, size, time). */
  fingerprint: string
  files: number
  /** Files only in the cloud (iCloud Drive): not opened, so what they say is unknown. */
  cloudOnly: number
  /** More files than Revive looks through; the rest was left out. */
  truncated: boolean
}

export interface Detection {
  projects: DetectedProject[]
  looseFiles: string[]
  /** Folders not looked into because they didn't answer in time (usually offloaded to iCloud). */
  slowFolders: number
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  const text = await readText(file, 2 * 1024 * 1024)
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * A file iCloud Drive (or another cloud folder) has offloaded: it has a size
 * but no data on this disk. Opening it would download it first (slow, and
 * not ours to trigger), so Revive never opens one.
 */
export function isCloudOnly(s: { size: number; blocks: number }): boolean {
  return s.size > 0 && s.blocks === 0
}

async function readText(file: string, max = MAX_FILE_BYTES): Promise<string | null> {
  try {
    const s = await stat(file)
    if (!s.isFile() || s.size > max || isCloudOnly(s)) return null
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** How long a folder may take to list before Revive assumes it's in the cloud and moves on. */
export const LIST_TIMEOUT_MS = 2000

/** Folders skipped because listing them took too long (offloaded to iCloud, a slow network drive). */
let slowFolders = 0

/**
 * A folder's entries, or none if it can't be listed in time. Listing a folder
 * iCloud Drive has offloaded downloads it first; Revive doesn't wait for that.
 */
async function entries(dir: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const slow = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), LIST_TIMEOUT_MS)))
    const list = await Promise.race([readdir(dir, { withFileTypes: true }), slow])
    if (list === null) slowFolders++
    return list ?? []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** A stable id from the path: lowercase letters, digits and dashes. */
export function idFromPath(path: string, taken: Set<string>): string {
  const base =
    (path === '.' ? 'project' : path)
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

/** "habit-counter" → "Habit counter". */
export function readableName(raw: string): string {
  const s = raw.replace(/^@[^/]+\//, '').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : raw
}

/** Every file of a project (paths relative to it), skipping what's never read. */
interface FileInfo {
  rel: string
  size: number
  mtime: number
  /** Offloaded to the cloud: listed and counted, never opened. */
  cloud: boolean
}

/** Python environments go by many names; the file inside each one gives them away. */
export function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name) || /^\.?venv|[-_]env$|^env[-_]|site-packages$/i.test(name) || name.endsWith('.xcodeproj')
}

async function walkProject(root: string): Promise<{ files: FileInfo[]; truncated: boolean }> {
  const files: FileInfo[] = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()!
    const list = await entries(join(root, rel))
    // A Python environment under a name we didn't guess.
    if (rel && list.some((e) => e.name === 'pyvenv.cfg')) continue
    for (const e of list) {
      if (e.isSymbolicLink()) continue
      const child = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name)) stack.push(child)
        continue
      }
      if (!e.isFile()) continue
      if (files.length >= MAX_FILES_PER_PROJECT) return { files, truncated: true }
      try {
        const s = await stat(join(root, child))
        files.push({ rel: child, size: s.size, mtime: Math.round(s.mtimeMs), cloud: isCloudOnly(s) })
      } catch {
        // gone meanwhile
      }
    }
  }
  return { files, truncated: false }
}

function fingerprintOf(files: FileInfo[]): string {
  const h = createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : 1))) h.update(`${f.rel}\0${f.size}\0${f.mtime}\n`)
  return h.digest('hex').slice(0, 32)
}

function packageManager(root: string, pkg: Record<string, unknown>): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  const declared = typeof pkg['packageManager'] === 'string' ? (pkg['packageManager'] as string).split('@')[0] : null
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') return declared
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

const STACK_FROM_DEPS: Array<[string, string]> = [
  ['next', 'next'],
  ['nuxt', 'nuxt'],
  ['@sveltejs/kit', 'sveltekit'],
  ['astro', 'astro'],
  ['@remix-run/react', 'remix'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['solid-js', 'solid'],
  ['@angular/core', 'angular'],
  ['vite', 'vite'],
  ['react-scripts', 'create-react-app'],
  ['expo', 'expo'],
  ['react-native', 'react-native'],
  ['electron', 'electron'],
  ['express', 'express'],
  ['fastify', 'fastify'],
  ['hono', 'hono'],
  ['tailwindcss', 'tailwind'],
  ['typescript', 'typescript'],
  ['three', 'three'],
  ['@supabase/supabase-js', 'supabase'],
  ['firebase', 'firebase'],
  ['prisma', 'prisma'],
  ['openai', 'openai'],
  ['@anthropic-ai/sdk', 'anthropic']
]

/** The default port of the dev server each kind of project starts. */
const DEFAULT_PORTS: Array<[string, number]> = [
  ['next', 3000],
  ['nuxt', 3000],
  ['remix', 3000],
  ['create-react-app', 3000],
  ['astro', 4321],
  ['angular', 4200],
  ['sveltekit', 5173],
  ['vite', 5173]
]

export function portFromScript(script: string | undefined): number | null {
  if (!script) return null
  const m = /(?:--port[=\s]+|-p\s+|PORT=)(\d{2,5})\b/.exec(script)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 65535 ? n : null
}

function portFromConfig(text: string | null): number | null {
  if (!text) return null
  const m = /\bport\s*:\s*(\d{2,5})\b/.exec(text)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 65535 ? n : null
}

/** Key names used in code: process.env.X, import.meta.env.X, os.environ["X"], os.getenv("X"), Deno.env.get("X"), ENV["X"]. */
const ENV_USE = /(?:process\.env|import\.meta\.env)(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\])|os\.(?:environ(?:\.get)?\s*[[(]\s*|getenv\s*\(\s*)['"]([A-Z][A-Z0-9_]{2,})['"]|Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]|ENV\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g

export function keysInSource(text: string): Array<{ key: string; fallback: boolean }> {
  const out: Array<{ key: string; fallback: boolean }> = []
  for (const line of text.split('\n')) {
    ENV_USE.lastIndex = 0
    for (let m = ENV_USE.exec(line); m; m = ENV_USE.exec(line)) {
      const key = m.slice(1).find(Boolean)!
      // "process.env.X || 'default'" or "?? 3000" or getenv("X", "default"): it works without it.
      const after = line.slice(m.index + m[0].length)
      out.push({ key, fallback: /^\s*(\|\||\?\?|,\s*['"\d])/.test(after) || /^\s*\)?\s*(\|\||\?\?)/.test(after) })
    }
  }
  return out
}

/** Only the names from an example env file. */
export function keysInEnvExample(text: string): string[] {
  return text
    .split('\n')
    .map((l) => /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k))
}

function stripHtml(html: string): { title: string | null; description: string | null; text: string } {
  const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim() ?? null
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i.exec(html)?.[1]?.trim() ?? null
  const text = html
    .replace(/<(script|style|svg|noscript|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { title, description, text }
}

/** A few levels of the project's files, folders first, for the summary. */
function treeOf(files: Array<{ rel: string }>, max = 120): string[] {
  const shown = new Set<string>()
  for (const f of files) {
    const parts = f.rel.split('/')
    for (let i = 1; i <= Math.min(parts.length, 3); i++) shown.add(parts.slice(0, i).join('/') + (i < parts.length ? '/' : ''))
  }
  return [...shown].sort().slice(0, max)
}

async function describeProject(folder: string, path: string, markers: Set<string>, taken: Set<string>): Promise<DetectedProject> {
  const root = path === '.' ? folder : join(folder, path)
  const { files, truncated } = await walkProject(root)
  const pkg = markers.has('package.json') ? ((await readJson(join(root, 'package.json'))) ?? {}) : null
  const scripts = (pkg?.['scripts'] ?? {}) as Record<string, string>
  const deps = { ...((pkg?.['dependencies'] as Record<string, string>) ?? {}), ...((pkg?.['devDependencies'] as Record<string, string>) ?? {}) }
  const depNames = Object.keys(deps)

  // What it's made of.
  const stack: string[] = []
  for (const [dep, label] of STACK_FROM_DEPS) if (dep in deps && !stack.includes(label)) stack.push(label)
  const requirements = markers.has('requirements.txt') ? ((await readText(join(root, 'requirements.txt'))) ?? '') : ''
  const pyproject = markers.has('pyproject.toml') ? ((await readText(join(root, 'pyproject.toml'))) ?? '') : ''
  const py = `${requirements}\n${pyproject}`.toLowerCase()
  if (markers.has('pyproject.toml') || markers.has('requirements.txt') || markers.has('manage.py')) {
    stack.push('python')
    for (const f of ['django', 'flask', 'fastapi', 'streamlit', 'gradio']) if (py.includes(f) || (f === 'django' && markers.has('manage.py'))) stack.push(f)
  }
  for (const [m, label] of [
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
    ['Gemfile', 'ruby'],
    ['composer.json', 'php'],
    ['pubspec.yaml', 'flutter'],
    ['Package.swift', 'swift'],
    ['deno.json', 'deno'],
    ['Dockerfile', 'docker']
  ] as const)
    if (markers.has(m)) stack.push(label)
  const staticSite = !pkg && markers.has('index.html') && !stack.length
  if (staticSite) stack.push('html')

  // How to run it.
  let install: string | null = null
  let dev: string | null = null
  if (pkg) {
    const pm = packageManager(root, pkg)
    const run = (s: string) => (pm === 'npm' ? `npm run ${s}` : pm === 'yarn' ? `yarn ${s}` : `${pm} run ${s}`)
    if (depNames.length) install = pm === 'yarn' ? 'yarn install' : `${pm} install`
    const script = ['dev', 'start', 'serve', 'preview'].find((s) => typeof scripts[s] === 'string')
    if (script) dev = script === 'start' && pm === 'npm' ? 'npm start' : run(script)
  } else if (markers.has('manage.py')) {
    dev = 'python3 manage.py runserver'
  } else if (stack.includes('streamlit')) {
    const app = files.find((f) => /^(app|main|streamlit_app)\.py$/.test(f.rel))?.rel
    if (app) dev = `streamlit run ${app}`
  }
  if (!install && (markers.has('requirements.txt') || markers.has('pyproject.toml'))) install = markers.has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install .'

  // Which port the dev server opens.
  const devScript = dev ? scripts[['dev', 'start', 'serve', 'preview'].find((s) => dev!.endsWith(s)) ?? ''] : undefined
  let port = portFromScript(devScript)
  if (!port) {
    const config = files.find((f) => /^(vite|astro|nuxt|svelte)\.config\.(m?[jt]s)$/.test(f.rel))
    port = portFromConfig(config ? await readText(join(root, config.rel)) : null)
  }
  if (!port && dev) port = DEFAULT_PORTS.find(([s]) => stack.includes(s))?.[1] ?? null
  if (!port && markers.has('manage.py')) port = 8000
  if (!port && stack.includes('streamlit')) port = 8501

  // The keys it needs: names only.
  const keyMap = new Map<string, DetectedKey>()
  const addKey = (key: string, required: boolean, where: string) => {
    if (NOT_KEYS.has(key)) return
    const k = keyMap.get(key) ?? { key, required: false, seenIn: [] }
    k.required ||= required
    if (k.seenIn.length < 3 && !k.seenIn.includes(where)) k.seenIn.push(where)
    keyMap.set(key, k)
  }
  let budget = MAX_SOURCE_BYTES
  for (const f of files) {
    const name = basename(f.rel)
    if (isSecretFile(name) || f.cloud) continue
    if (isEnvExample(name)) {
      for (const k of keysInEnvExample((await readText(join(root, f.rel))) ?? '')) addKey(k, true, f.rel)
      continue
    }
    if (!SOURCE_EXT.test(name) || f.size > MAX_FILE_BYTES || budget <= 0) continue
    budget -= f.size
    const text = await readText(join(root, f.rel))
    if (text) for (const u of keysInSource(text)) addKey(u.key, !u.fallback, f.rel)
  }

  // The summary for the understanding step (masked; never a secret file).
  const readmeFile = files.find((f) => /^readme(\.(md|markdown|txt|rst))?$/i.test(f.rel))
  const readme = readmeFile && !readmeFile.cloud ? await readText(join(root, readmeFile.rel)) : null
  const indexFile = files.find((f) => f.rel === 'index.html') ?? files.find((f) => /^(public|src)\/index\.html$/.test(f.rel))
  const page = indexFile ? stripHtml((await readText(join(root, indexFile.rel))) ?? '') : null
  const packageName = typeof pkg?.['name'] === 'string' ? (pkg['name'] as string) : null
  const packageDescription = typeof pkg?.['description'] === 'string' ? (pkg['description'] as string) : null
  const folderName = path === '.' ? basename(folder) : basename(path)
  const title = page?.title && !/^(vite|react|vue|svelte|document|index|home|untitled)\b/i.test(page.title) ? page.title : null
  const name = readableName(title ?? (packageName && !/^(my-app|app|vite-project|project)$/i.test(packageName) ? packageName : folderName))

  const digest: ProjectDigest = {
    packageName,
    packageDescription: packageDescription ? redact(packageDescription).slice(0, 300) : null,
    title: page?.title ? redact(page.title) : null,
    pageText: page ? redact([page.description, page.text].filter(Boolean).join(' — ')).slice(0, 1200) || null : null,
    readme: readme ? redact(readme).slice(0, 3000) : null,
    scripts: Object.fromEntries(Object.entries(scripts).slice(0, 12).map(([k, v]) => [k, redact(String(v)).slice(0, 160)])),
    dependencies: depNames.slice(0, 40),
    tree: treeOf(files),
    keys: [...keyMap.keys()]
  }

  return {
    id: idFromPath(path, taken),
    path,
    name,
    stack,
    run: { install, dev, port },
    keys: [...keyMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    digest,
    fingerprint: fingerprintOf(files),
    files: files.length,
    cloudOnly: files.filter((f) => f.cloud).length,
    truncated
  }
}

/**
 * Walks the chosen folder (a few levels deep) for project folders. A folder
 * with a marker (package.json, index.html, ...) is one project; nothing
 * inside it is looked at as another project. Files directly in the chosen
 * folder that belong to no project are "loose files".
 */
export async function detectProjects(folder: string, opts: { signal?: AbortSignal; onProject?: (p: DetectedProject) => void } = {}): Promise<Detection> {
  const projects: DetectedProject[] = []
  const looseFiles: string[] = []
  const taken = new Set<string>()
  const slowBefore = slowFolders

  const visit = async (rel: string, depth: number): Promise<void> => {
    if (opts.signal?.aborted) return
    const dir = rel === '.' ? folder : join(folder, rel)
    const list = await entries(dir)
    const names = new Set(list.filter((e) => e.isFile()).map((e) => e.name))
    const markers = new Set<string>(MARKERS.filter((m) => names.has(m)))
    if (list.some((e) => e.isDirectory() && e.name.endsWith('.xcodeproj'))) markers.add('Package.swift')
    // The chosen folder itself only counts as a project when it clearly is one (not just a stray index.html or Dockerfile).
    const isProject = rel === '.' ? ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'manage.py', 'deno.json'].some((m) => markers.has(m)) : markers.size > 0
    if (isProject) {
      const p = await describeProject(folder, rel, markers, taken)
      projects.push(p)
      opts.onProject?.(p)
      return
    }
    if (rel === '.') for (const e of list) if (e.isFile() && !e.name.startsWith('.') && !isSecretFile(e.name)) looseFiles.push(e.name)
    if (depth >= MAX_DEPTH) return
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.isSymbolicLink() || isSkippedDir(e.name) || e.name.startsWith('.')) continue
      await visit(rel === '.' ? e.name : `${rel}/${e.name}`, depth + 1)
    }
  }

  await visit('.', 0)
  return { projects, looseFiles: looseFiles.sort(), slowFolders: slowFolders - slowBefore }
}

