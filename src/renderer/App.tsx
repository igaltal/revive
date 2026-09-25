import { useState, type ReactNode } from 'react'
import { useSettings } from '@/state/settings'
import { useT } from '@/i18n/useT'
import { Sidebar, type Route } from '@/components/Sidebar'
import { PageHeader } from '@/components/PageHeader'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { HistoryScreen } from '@/screens/PlaceholderScreens'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { WelcomeLanguage } from '@/screens/WelcomeLanguage'
import { Onboarding } from '@/screens/onboarding/Onboarding'
import { FolderStep } from '@/screens/onboarding/FolderStep'

type AppRoute = Route | 'folder'

export function App(): ReactNode {
  const { settings, loaded } = useSettings()
  const { tx } = useT()
  const [route, setRoute] = useState<AppRoute>('projects')

  if (!loaded) return null
  if (settings.uiLanguage === null) return <WelcomeLanguage />
  if (settings.lastFolder === null) return <Onboarding />

  return (
    <div className="flex h-full">
      <Sidebar route={route === 'folder' ? 'projects' : route} onNavigate={setRoute} />
      <main className="min-w-0 flex-1 overflow-y-auto px-12 py-10">
        {route === 'projects' && <ProjectsScreen onChangeFolder={() => setRoute('folder')} />}
        {route === 'folder' && (
          <div className="flex max-w-3xl flex-col gap-8">
            <FolderStep
              header={<PageHeader title={tx('folder.change')} subtitle={tx('folder.subtitle')} />}
              onChosen={() => setRoute('projects')}
            />
          </div>
        )}
        {route === 'history' && <HistoryScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}
