import { useState, type ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { Button } from '@/components/Button'
import { OnboardingShell } from './OnboardingShell'
import { PrereqStep } from './PrereqStep'
import { FolderStep } from './FolderStep'

/** After the language choice: check the computer, then choose the folder. */
export function Onboarding(): ReactNode {
  const { tx } = useT()
  const [step, setStep] = useState<'prereq' | 'folder'>('prereq')

  if (step === 'prereq') {
    return (
      <OnboardingShell step={1} total={2}>
        <PrereqStep onContinue={() => setStep('folder')} />
      </OnboardingShell>
    )
  }
  return (
    <OnboardingShell step={2} total={2}>
      {/* Choosing a folder saves it to settings; App then moves to My projects. */}
      <FolderStep onChosen={() => {}} />
      <div>
        <Button variant="quiet" onClick={() => setStep('prereq')}>
          {tx('common.back')}
        </Button>
      </div>
    </OnboardingShell>
  )
}
