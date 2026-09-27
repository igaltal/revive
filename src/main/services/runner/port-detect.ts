import { connect } from 'node:net'
import { stripAnsi } from '@shared/ansi'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]', '::1', '::'])

/** http://localhost:5173/, http://127.0.0.1:5000, http://[::1]:3000 … */
const URL_RE = /\bhttps?:\/\/(\[[0-9a-f:]+\]|[A-Za-z0-9.-]+):(\d{2,5})(\/[^\s'"<>)]*)?/gi
/** "listening on port 3000", "Listening on :8080", "port: 4000" */
const PORT_RE = /\b(?:listening|running|serving|started|available)\b[^\n]*?(?:\bport\b[\s:=]*|:)(\d{2,5})\b/i

export interface DetectedPort {
  port: number
  url: string
}

function validPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

/**
 * Finds the local address a dev server printed. Addresses on other machines
 * ("Network: http://192.168.1.5:5173") are ignored; bind-all addresses are
 * turned into localhost.
 */
export function detectPort(text: string): DetectedPort | null {
  const clean = stripAnsi(text)
  for (const m of clean.matchAll(URL_RE)) {
    const host = m[1]!.toLowerCase()
    const port = Number(m[2])
    if (!LOCAL_HOSTS.has(host) || !validPort(port)) continue
    const shownHost = host === '0.0.0.0' || host === '[::]' || host === '::' ? 'localhost' : host
    const scheme = m[0].toLowerCase().startsWith('https') ? 'https' : 'http'
    return { port, url: `${scheme}://${shownHost}:${port}${m[3] && m[3] !== '/' ? m[3] : '/'}` }
  }
  const p = PORT_RE.exec(clean)
  if (p) {
    const port = Number(p[1])
    if (validPort(port) && port >= 80) return { port, url: `http://localhost:${port}/` }
  }
  return null
}

/** Ports dev servers commonly use, tried only when the output never says. */
export const COMMON_PORTS = [3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8888]

export function isListening(port: number, host = '127.0.0.1', timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export async function listeningAnywhere(port: number): Promise<boolean> {
  return (await isListening(port, '127.0.0.1')) || (await isListening(port, '::1'))
}
