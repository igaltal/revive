import { useEffect, useRef, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { transport } from '@/transport'

/**
 * Monospace first; Hebrew falls back to a font that has it. xterm.js has no
 * bidi, so Hebrew inside the terminal is laid out left to right (known and
 * accepted: the terminal shows what the program wrote, in order).
 */
const FONT = '"IBM Plex Mono", "SF Mono", Menlo, "Arial Hebrew", "IBM Plex Sans Hebrew", monospace'

/**
 * One session in a terminal: its buffered output first, then live. Keystrokes
 * and size go through the transport, so it's the same locally and on a Host.
 * Closing the view only stops watching; the session keeps running.
 */
export function TerminalView({ sessionId }: { sessionId: string }): ReactNode {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const term = new Terminal({ fontFamily: FONT, fontSize: 13, cursorBlink: true, scrollback: 10_000, allowProposedApi: false, theme: { background: '#1d1b18', foreground: '#ece8df' } })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)

    const off = transport.subscribe(
      'session:output',
      (chunk) => {
        // The Host restarted and rebuilt this session's output: start the screen over.
        if (chunk.reset) term.reset()
        term.write(chunk.data)
      },
      { sessionId, fromOffset: 0 }
    )
    const typing = term.onData((data) => transport.writeSession(sessionId, data))

    let last = ''
    const resize = () => {
      try {
        fit.fit()
      } catch {
        return // not laid out yet
      }
      const size = `${term.cols}x${term.rows}`
      if (size === last) return
      last = size
      transport.resizeSession(sessionId, term.cols, term.rows)
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
    observer?.observe(el)
    resize()
    term.focus()

    return () => {
      observer?.disconnect()
      typing.dispose()
      off()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={box} dir="ltr" data-testid="terminal-view" data-session={sessionId} className="h-full min-h-[420px] w-full overflow-hidden rounded-[10px] bg-[#1d1b18] p-2" />
}
