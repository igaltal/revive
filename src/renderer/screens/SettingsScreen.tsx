import type { ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { LtrBlock } from '@/i18n/bidi'
import { useSettings } from '@/state/settings'
import { PageHeader } from '@/components/PageHeader'
import { OptionCards } from '@/components/OptionCards'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import type { Settings } from '@shared/settings'

function Section({ title, hint, children }: { title: ReactNode; hint: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border py-7 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-xl text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">{hint}</p>
      </div>
      {children}
    </section>
  )
}

export function SettingsScreen(): ReactNode {
  const { t, tx } = useT()
  const { settings, update } = useSettings()
  const ui = settings.uiLanguage ?? 'en'

  return (
    <div className="max-w-3xl">
      <PageHeader title={tx('vocab.settings')} subtitle={tx('settings.subtitle')} />

      <Section title={tx('settings.interface.title')} hint={tx('settings.interface.hint')}>
        <OptionCards
          testId="setting-ui-language"
          label={t('settings.interface.title')}
          value={ui}
          onChange={(uiLanguage) => update({ uiLanguage })}
          options={[
            {
              value: 'he',
              lang: 'he',
              dir: 'rtl',
              label: t('language.he'),
              aside: <span className="font-display text-lg">{t('settings.interface.sample', { lng: 'he' })}</span>,
              hint: t('settings.interface.rtl', { lng: 'he' })
            },
            {
              value: 'en',
              lang: 'en',
              dir: 'ltr',
              label: t('language.en'),
              aside: <span className="font-display text-lg">{t('settings.interface.sample', { lng: 'en' })}</span>,
              hint: t('settings.interface.ltr', { lng: 'en' })
            }
          ]}
        />
      </Section>

      <Section title={tx('settings.claude.title')} hint={tx('settings.claude.hint')}>
        <OptionCards
          testId="setting-claude-language"
          columns={3}
          label={t('settings.claude.title')}
          value={settings.claudeLanguage}
          onChange={(claudeLanguage: Settings['claudeLanguage']) => update({ claudeLanguage })}
          options={[
            { value: 'same', label: tx('settings.claude.same') },
            { value: 'he', label: tx('settings.claude.he') },
            { value: 'en', label: tx('settings.claude.en') }
          ]}
        />
      </Section>

      <Section title={tx('settings.detail.title')} hint={tx('settings.detail.example')}>
        <OptionCards
          testId="setting-detail-level"
          label={t('settings.detail.title')}
          value={settings.detailLevel}
          onChange={(detailLevel: Settings['detailLevel']) => update({ detailLevel })}
          options={[
            { value: 'simple', label: tx('settings.detail.simple'), hint: tx('settings.detail.simpleHint') },
            { value: 'advanced', label: tx('settings.detail.advanced'), hint: tx('settings.detail.advancedHint') }
          ]}
        />
        <TechnicalDetails>
          <LtrBlock label={t('technical.command')}>npm run dev</LtrBlock>
          <LtrBlock label={t('technical.port')}>5173</LtrBlock>
        </TechnicalDetails>
      </Section>

      <Section title={tx('settings.scanModel.title')} hint={tx('settings.scanModel.hint')}>
        <OptionCards
          testId="setting-scan-model"
          label={t('settings.scanModel.title')}
          value={settings.scanModel}
          onChange={(scanModel) => update({ scanModel })}
          options={[
            { value: 'haiku', label: tx('settings.scanModel.haiku'), aside: <bdi>Haiku</bdi> },
            { value: 'sonnet', label: tx('settings.scanModel.sonnet'), aside: <bdi>Sonnet</bdi> }
          ]}
        />
      </Section>

      <p className="pt-4 text-xs text-muted">{tx('settings.version', { version: __APP_VERSION__ })}</p>
    </div>
  )
}
