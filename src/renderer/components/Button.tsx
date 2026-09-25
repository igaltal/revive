import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'quiet'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/90',
  secondary: 'bg-card text-ink border border-border hover:border-ink/40',
  quiet: 'text-ink hover:bg-ink/5'
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[10px] px-4 text-[15px] font-medium transition-colors disabled:opacity-50',
        variants[variant],
        className
      )}
    />
  )
}
