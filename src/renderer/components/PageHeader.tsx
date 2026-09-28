import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-8 max-[639px]:pb-5">
      <div>
        <h1 className="text-4xl leading-tight text-ink max-[639px]:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-2 text-[15px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}
