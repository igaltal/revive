import { useEffect, useState } from 'react'

/** Whether a media query matches, kept current. False where there is no matchMedia (tests). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(query)
    const on = () => setMatches(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Phone width: the layouts below 640 px. */
export function useNarrow(): boolean {
  return useMedia('(max-width: 639px)')
}
