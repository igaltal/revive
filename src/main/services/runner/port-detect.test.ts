import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { detectPort, isListening } from './port-detect'

// Real start-up output, copied from each tool (colours included where the tool adds them).
const SAMPLES: Array<[string, string, number, string]> = [
  ['Vite', '\n  \u001b[32m\u001b[1mVITE\u001b[22m v7.0.4\u001b[39m  \u001b[2mready in \u001b[0m\u001b[1m312\u001b[22m\u001b[2m\u001b[0m ms\u001b[22m\n\n  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n', 5173, 'http://localhost:5173/'],
  ['Next.js', '   ▲ Next.js 15.3.1\n   - Local:        http://localhost:3000\n   - Network:      http://192.168.1.20:3000\n\n ✓ Starting...\n', 3000, 'http://localhost:3000/'],
  ['Create React App', 'Compiled successfully!\n\nYou can now view my-app in the browser.\n\n  Local:            http://localhost:3000\n  On Your Network:  http://192.168.1.20:3000\n', 3000, 'http://localhost:3000/'],
  ['Flask', ' * Serving Flask app \'app\'\n * Debug mode: on\nWARNING: This is a development server.\n * Running on http://127.0.0.1:5000\nPress CTRL+C to quit\n', 5000, 'http://127.0.0.1:5000/'],
  ['http-server', 'Starting up http-server, serving ./\n\nAvailable on:\n  http://127.0.0.1:8080\n  http://192.168.1.20:8080\nHit CTRL-C to stop the server\n', 8080, 'http://127.0.0.1:8080/'],
  ['Django', 'System check identified no issues (0 silenced).\nStarting development server at http://127.0.0.1:8000/\nQuit the server with CONTROL-C.\n', 8000, 'http://127.0.0.1:8000/'],
  ['Express', 'Server listening on port 4000\n', 4000, 'http://localhost:4000/'],
  ['Astro', '  astro  v5.1.0 ready in 210 ms\n\n┃ Local    http://localhost:4321/\n┃ Network  use --host to expose\n', 4321, 'http://localhost:4321/'],
  ['Uvicorn', 'INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)\n', 8001, 'http://localhost:8001/'],
  ['Revive static server', 'Serving /Users/noa/site at http://127.0.0.1:61234/\n', 61234, 'http://127.0.0.1:61234/']
]

describe('port detection', () => {
  it.each(SAMPLES)('%s', (_name, output, port, url) => {
    expect(detectPort(output)).toEqual({ port, url })
  })

  it('ignores other machines and lines without an address', () => {
    expect(detectPort('  ➜  Network: http://192.168.1.20:5173/')).toBeNull()
    expect(detectPort('Port 5199 is in use, trying another one...')).toBeNull()
    expect(detectPort('added 212 packages in 3s')).toBeNull()
  })

  it('knows when something is listening', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as { port: number }).port
    expect(await isListening(port)).toBe(true)
    server.close()
    await new Promise((r) => server.once('close', r))
    expect(await isListening(port)).toBe(false)
  })
})
