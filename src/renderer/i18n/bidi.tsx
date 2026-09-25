import { Fragment, type ReactNode } from 'react'

/**
 * Runs of Latin letters, digits and the punctuation that belongs to them
 * (names, URLs, version numbers). Inside Hebrew text each run is isolated
 * in <bdi> so it never reorders the surrounding sentence.
 */
const LATIN_RUN = /[A-Za-z0-9][A-Za-z0-9 .,:/_@#%+&-]*[A-Za-z0-9%]|[A-Za-z0-9]/g

export function isolateLatin(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LATIN_RUN)) {
    const start = match.index
    if (start > last) out.push(text.slice(last, start))
    out.push(<bdi key={start}>{match[0]}</bdi>)
    last = start + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Renders text; in Hebrew, Latin names and numbers are wrapped in <bdi>. */
export function BidiText({ text, lang }: { text: string; lang: string }): ReactNode {
  if (lang !== 'he') return text
  return <Fragment>{isolateLatin(text)}</Fragment>
}

/** A name, URL or number placed inside a sentence. */
export function Bdi({ children }: { children: ReactNode }): ReactNode {
  return <bdi>{children}</bdi>
}

/** Commands, paths and keys: always their own left-to-right block. */
export function LtrBlock({ children, label }: { children: ReactNode; label?: string }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-xs text-muted">{label}</span> : null}
      <code
        dir="ltr"
        className="block overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 text-start font-mono text-[13px] whitespace-pre text-ink"
      >
        {children}
      </code>
    </div>
  )
}
