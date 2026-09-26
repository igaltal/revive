import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { FullScreen } from '@/components/FullScreen'

export function OnboardingShell({ step, total, children }: { step: number; total: number; children: ReactNode }): ReactNode {
  const { tx } = useT()
  return <FullScreen label={<span data-testid="onboarding-step">{tx('common.step', { current: step, total })}</span>}>{children}</FullScreen>
}
