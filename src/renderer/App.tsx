import { useState, type ReactNode } from 'react'
import { useSettings } from '@/state/settings'
import { Sidebar, type Route } from '@/components/Sidebar'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { HistoryScreen, ProjectsScreen } from '@/screens/PlaceholderScreens'
import { WelcomeLanguage } from '@/screens/WelcomeLanguage'

export function App(): ReactNode {
  const { settings, loaded } = useSettings()
  const [route, setRoute] = useState<Route>('projects')

  if (!loaded) return null
  if (settings.uiLanguage === null) return <WelcomeLanguage />

  return (
    <div className="flex h-full">
      <Sidebar route={route} onNavigate={setRoute} />
      <main className="min-w-0 flex-1 overflow-y-auto px-12 py-10">
        {route === 'projects' && <ProjectsScreen />}
        {route === 'history' && <HistoryScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}
