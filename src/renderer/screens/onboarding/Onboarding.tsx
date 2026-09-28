import { useState, type ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { Button } from '@/components/Button'
import { OnboardingShell } from './OnboardingShell'
import { PrereqStep } from './PrereqStep'
import { FolderStep } from './FolderStep'
import { ConnectForm } from '@/components/host'

/** After the language choice: check the computer, then choose the folder. */
export function Onboarding(): ReactNode {
  const { tx } = useT()
  const [step, setStep] = useState<'prereq' | 'folder' | 'connect'>('prereq')

  if (step === 'connect') {
    // Instead of this computer's own tools and folder: another computer's Revive.
    return (
      <OnboardingShell step={1} total={1}>
        <div>
          <h1 className="text-4xl leading-tight text-ink">{tx('client.title')}</h1>
          <p className="mt-2 text-[15px] text-muted">{tx('client.hint')}</p>
        </div>
        <ConnectForm />
        <div>
          <Button variant="quiet" onClick={() => setStep('prereq')}>
            {tx('common.back')}
          </Button>
        </div>
      </OnboardingShell>
    )
  }
  if (step === 'prereq') {
    return (
      <OnboardingShell step={1} total={2}>
        <PrereqStep onContinue={() => setStep('folder')} />
        <div>
          <Button variant="quiet" data-testid="onboarding-connect" onClick={() => setStep('connect')}>
            {tx('client.instead')}
          </Button>
        </div>
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
