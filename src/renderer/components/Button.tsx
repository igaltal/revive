import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary/90',
  secondary: 'bg-card text-ink border border-border hover:border-ink/40',
  quiet: 'text-ink hover:bg-ink/5',
  danger: 'bg-broken text-on-broken hover:bg-broken/90'
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
