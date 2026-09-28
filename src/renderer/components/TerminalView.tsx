import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { transport } from '@/transport'
import { useT } from '@/i18n/useT'
import { cx } from './cx'
import { clampFont, FONT_SIZES, KEY_ROW, keySequence, withCtrl, type RowKey } from './terminal-keys'

/**
 * Monospace first; Hebrew falls back to a font that has it. xterm.js has no
 * bidi, so Hebrew inside the terminal is laid out left to right (known and
 * accepted: the terminal shows what the program wrote, in order).
 */
const FONT = '"IBM Plex Mono", "SF Mono", Menlo, "Arial Hebrew", "IBM Plex Sans Hebrew", monospace'
const FONT_STORE = 'revive.terminalFont'

const LABELS: Record<RowKey, string> = { esc: 'Esc', tab: 'Tab', ctrl: 'Ctrl', left: '←', up: '↑', down: '↓', right: '→', enter: '⏎' }

function savedFont(): number {
  try {
    return clampFont(Number(localStorage.getItem(FONT_STORE)) || FONT_SIZES.default)
  } catch {
    return FONT_SIZES.default
  }
}

/** A phone or tablet: a coarse pointer, or a narrow screen. */
export function useTouchLayout(): boolean {
  const query = '(pointer: coarse), (max-width: 767px)'
  const [touch, setTouch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(query)
    const on = () => setTouch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return touch
}

/** How far the on-screen keyboard covers the bottom of the page (iOS doesn't resize for it). */
function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || !vv) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [enabled])
  return inset
}

/**
 * One session in a terminal: its buffered output first, then live. Keystrokes
 * and size go through the transport, so it's the same locally and on a Host.
 * Closing the view only stops watching; the session keeps running.
 * On a phone, a key row above the keyboard adds Esc, Tab, Ctrl, arrows and Enter.
 */
export function TerminalView({ sessionId }: { sessionId: string }): ReactNode {
  const { t } = useT()
  const box = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const ctrl = useRef(false)
  const [ctrlOn, setCtrlOn] = useState(false)
  const [fontSize, setFontSize] = useState(savedFont)
  const touch = useTouchLayout()
  const keyboardInset = useKeyboardInset(touch)

  // Everything typed goes through here, so a pending Ctrl applies to the next key, wherever it came from.
  const send = (data: string) => {
    let out = data
    if (ctrl.current) {
      out = withCtrl(data)
      ctrl.current = false
      setCtrlOn(false)
    }
    transport.writeSession(sessionId, out)
  }
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const term = new Terminal({ fontFamily: FONT, fontSize: savedFont(), cursorBlink: true, scrollback: 10_000, allowProposedApi: false, theme: { background: '#1d1b18', foreground: '#ece8df' } })
    termRef.current = term
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
    const typing = term.onData((data) => sendRef.current(data))

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
    fitRef.current = resize
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
    observer?.observe(el)
    resize()
    term.focus()

    return () => {
      observer?.disconnect()
      typing.dispose()
      off()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  // Font size: buttons or a two-finger pinch. Remembered on this device.
  const applyFont = (n: number) => {
    const size = clampFont(n)
    setFontSize(size)
    try {
      localStorage.setItem(FONT_STORE, String(size))
    } catch {
      // private mode
    }
    if (termRef.current) termRef.current.options.fontSize = size
    fitRef.current?.()
  }
  const pinch = useRef<{ distance: number; size: number } | null>(null)
  const distance = (e: React.TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY)

  const press = (key: RowKey) => {
    if (key === 'ctrl') {
      ctrl.current = !ctrl.current
      setCtrlOn(ctrl.current)
    } else {
      const applicationCursor = termRef.current?.modes.applicationCursorKeysMode ?? false
      // A pending Ctrl belongs to the next typed character, not to these keys.
      transport.writeSession(sessionId, keySequence(key, { applicationCursor }))
    }
    termRef.current?.focus()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" style={touch && keyboardInset ? { paddingBottom: keyboardInset } : undefined}>
      <div
        ref={box}
        dir="ltr"
        data-testid="terminal-view"
        data-session={sessionId}
        data-font-size={fontSize}
        className="min-h-[420px] w-full flex-1 overflow-hidden rounded-[10px] bg-[#1d1b18] p-2 max-[639px]:h-[55svh] max-[639px]:min-h-[240px] max-[639px]:flex-none"
        onTouchStart={(e) => {
          if (e.touches.length === 2) pinch.current = { distance: distance(e), size: fontSize }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinch.current) applyFont(pinch.current.size * (distance(e) / pinch.current.distance))
        }}
        onTouchEnd={() => (pinch.current = null)}
      />
      {touch ? (
        <div dir="ltr" role="toolbar" aria-label={t('terminalKeys.label')} data-testid="key-row" className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-card p-1.5 shadow-sm">
          {KEY_ROW.map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`key-${key}`}
              aria-pressed={key === 'ctrl' ? ctrlOn : undefined}
              // Keep the terminal focused (and the keyboard open) while tapping.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => press(key)}
              className={cx('min-h-[40px] min-w-[44px] flex-1 rounded-[8px] border border-border px-2 font-mono text-sm', key === 'ctrl' && ctrlOn ? 'bg-ink text-white' : 'bg-bg text-ink')}
            >
              {LABELS[key]}
            </button>
          ))}
          <button type="button" data-testid="font-smaller" aria-label={t('terminalKeys.smaller')} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFont(fontSize - 1)} className="min-h-[40px] min-w-[44px] rounded-[8px] border border-border bg-bg px-2 text-sm text-ink">
            A−
          </button>
          <button type="button" data-testid="font-larger" aria-label={t('terminalKeys.larger')} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFont(fontSize + 1)} className="min-h-[40px] min-w-[44px] rounded-[8px] border border-border bg-bg px-2 text-base text-ink">
            A+
          </button>
        </div>
      ) : null}
    </div>
  )
}
