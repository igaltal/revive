export type Fetcher = (url: string, init: { signal: AbortSignal; redirect: 'manual' }) => Promise<{ status: number }>

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(url)

/**
 * Asks the app for its page until it answers with anything below 500.
 * Only ever talks to this computer.
 */
export async function waitHealthy(
  url: string,
  opts: { deadline: number; signal: AbortSignal; fetcher?: Fetcher; intervalMs?: number }
): Promise<{ ok: true; status: number } | { ok: false; status: number | null }> {
  if (!isLocal(url)) return { ok: false, status: null }
  const fetcher: Fetcher = opts.fetcher ?? ((u, init) => fetch(u, init))
  let last: number | null = null
  while (Date.now() < opts.deadline && !opts.signal.aborted) {
    const attempt = AbortSignal.any([opts.signal, AbortSignal.timeout(3000)])
    try {
      const res = await fetcher(url, { signal: attempt, redirect: 'manual' })
      last = res.status
      if (res.status < 500) return { ok: true, status: res.status }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 400))
  }
  return { ok: false, status: last }
}
