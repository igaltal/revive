import type { ReactNode } from 'react'
import type { Project } from '@shared/manifest'
import type { BrokenReason } from '@shared/runtime'
import { useT } from '@/i18n/useT'
import { localized } from './ProjectCard'

/** One plain sentence for why a start didn't work. */
export function RunReason({ project, reason }: { project: Project; reason: BrokenReason }): ReactNode {
  const { tx, lang } = useT()
  if (reason.code === 'missing_key') {
    const key = project.keys.find((k) => k.key === reason.key)
    return tx('run.reason.missing_key', { purpose: key ? localized(key.purpose, lang) : (reason.key ?? '') })
  }
  if (reason.code === 'tool_missing') return tx('run.reason.tool_missing', { tool: reason.tool ?? '' })
  return tx(`run.reason.${reason.code}`)
}
