import type { SVGProps } from 'react'
import { cx } from './cx'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props
})

/**
 * Directional icons point "forward" in reading order and mirror in RTL.
 * Meaningful icons (play, undo) never mirror.
 */
export function ChevronForward({ className, ...props }: IconProps) {
  return (
    <svg {...base(props)} className={cx('rtl:-scale-x-100', className)} data-mirrors="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function ChevronBack({ className, ...props }: IconProps) {
  return (
    <svg {...base(props)} className={cx('rtl:-scale-x-100', className)} data-mirrors="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function ArrowForward({ className, ...props }: IconProps) {
  return (
    <svg {...base(props)} className={cx('rtl:-scale-x-100', className)} data-mirrors="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)} data-mirrors="false">
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...base(props)} data-mirrors="false">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </svg>
  )
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  )
}

export function GearIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  )
}
