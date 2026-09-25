import { useEffect, useRef, type ReactNode } from 'react'

/** Process output: already masked in main, always left to right, monospace. */
export function LogBlock({ lines, label }: { lines: string[]; label?: string }): ReactNode {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines.length])
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-xs text-muted">{label}</span> : null}
      <pre
        ref={ref}
        dir="ltr"
        data-testid="log-block"
        className="max-h-56 overflow-auto rounded-md border border-border bg-bg px-3 py-2 text-start font-mono text-[12px] leading-5 whitespace-pre-wrap text-ink/80"
      >
        {lines.join('\n')}
      </pre>
    </div>
  )
}
