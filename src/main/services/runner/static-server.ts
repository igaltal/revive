/**
 * A tiny file server for projects that are plain HTML with no start command.
 * Runs as its own process (Electron in Node mode), like any dev server, so
 * the runner treats it the same way: output, port, health check, stop.
 *
 * Usage: static-server <folder> [port]
 * Serves only on this computer, never hidden files (.env, .git, .revive).
 * Self-contained on purpose: no imports outside Node.
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm'
}

export async function resolveInside(root: string, urlPath: string): Promise<string | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]!.split('#')[0]!)
  } catch {
    return null
  }
  const parts = decoded.split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p.startsWith('.') || p.includes('\\') || p.includes('\0'))) return null
  let file = join(root, ...parts)
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    const real = await realpath(file)
    if (real !== root && !real.startsWith(root + sep)) return null
    return (await stat(real)).isFile() ? real : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const [folder, portArg] = process.argv.slice(2)
  if (!folder) {
    console.error('usage: static-server <folder> [port]')
    process.exit(2)
  }
  const root = await realpath(folder)
  const server = createServer((req, res) => {
    void resolveInside(root, req.url ?? '/').then((file) => {
      if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
        console.log(`${req.method} ${req.url} 404`)
        return
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      if (req.method === 'HEAD') return void res.end()
      createReadStream(file).pipe(res)
    })
  })
  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : port)
      })
    })
  let port: number
  try {
    port = await listen(Number(portArg) || 0)
  } catch {
    // The preferred port is taken: any free one will do.
    port = await listen(0)
  }
  console.log(`Serving ${root} at http://127.0.0.1:${port}/`)
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

if (process.argv[1] && /static-server\.(?:ts|js|mjs)$/.test(process.argv[1])) void main()
