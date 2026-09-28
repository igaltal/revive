import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '@/state/settings'
import { useProjects } from '@/state/projects'
import { useT } from '@/i18n/useT'
import { Sidebar, type Route } from '@/components/Sidebar'
import { PageHeader } from '@/components/PageHeader'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { ProjectScreen } from '@/screens/ProjectScreen'
import { ScanView } from '@/screens/ScanView'
import { WelcomeLanguage } from '@/screens/WelcomeLanguage'
import { GuardBlocked } from '@/screens/GuardBlocked'
import { useGuard } from '@/state/guard'
import { useClient } from '@/state/client'
import { useHostStatus } from '@/state/host'
import { PairingRequests } from '@/components/host'
import { ClientConnecting, ClientRejected } from '@/screens/ClientScreens'
import { TerminalScreen } from '@/screens/TerminalScreen'
import { Onboarding } from '@/screens/onboarding/Onboarding'
import { FolderStep } from '@/screens/onboarding/FolderStep'
import { PrereqStep } from '@/screens/onboarding/PrereqStep'

type AppRoute = { name: Route } | { name: 'folder' } | { name: 'prereq' } | { name: 'project'; id: string } | { name: 'terminal'; projectId: string; sessionId: string }

export function App(): ReactNode {
  const { host } = useHostStatus()
  // A device asking to connect is answered from any screen on the Host.
  return (
    <>
      <Screens />
      <PairingRequests host={host} />
    </>
  )
}

function Screens(): ReactNode {
  const client = useClient()
  const { settings, loaded } = useSettings()
  const { scan, reload } = useProjects()
  const { tx } = useT()
  const { guard, recheck } = useGuard()
  const [route, setRoute] = useState<AppRoute>({ name: 'projects' })
  const scrollRoot = useRef<HTMLElement>(null)
  // Every screen opens at its top (the project page leads with its preview).
  useLayoutEffect(() => {
    scrollRoot.current?.scrollTo?.({ top: 0 })
  }, [route])

  // Working on another computer: say so while it can't be reached, and when it no longer allows this one.
  if (client.state === 'rejected') return <ClientRejected />
  if (!loaded) return client.host ? <ClientConnecting /> : null
  if (settings.uiLanguage === null) return <WelcomeLanguage />
  // Loud and first: a Claude Code that ignores the turn limit may not read anything.
  if (guard?.state === 'failed') return <GuardBlocked guard={guard} onRecheck={recheck} />
  if (settings.lastFolder === null) return <Onboarding />
  // Reading the folder is a full screen view; it keeps its state across language switches.
  if (scan) return <ScanView />

  const toProjects = () => setRoute({ name: 'projects' })
  const sidebarRoute: Route = route.name === 'history' || route.name === 'settings' ? route.name : 'projects'

  return (
    <div className="flex h-full max-[639px]:flex-col">
      <Sidebar route={sidebarRoute} onNavigate={(name) => setRoute({ name })} />
      <main ref={scrollRoot} data-scroll-root className="min-w-0 flex-1 overflow-y-auto px-12 py-10 max-[639px]:px-4 max-[639px]:py-5">
        {route.name === 'projects' && (
          <ProjectsScreen
            onChangeFolder={() => setRoute({ name: 'folder' })}
            onOpenProject={(id) => setRoute({ name: 'project', id })}
            onCheckComputer={() => setRoute({ name: 'prereq' })}
          />
        )}
        {route.name === 'project' && <ProjectScreen projectId={route.id} onBack={toProjects} onOpenTerminal={(sessionId) => setRoute({ name: 'terminal', projectId: route.id, sessionId })} />}
        {route.name === 'terminal' && <TerminalScreen projectId={route.projectId} sessionId={route.sessionId} onBack={() => setRoute({ name: 'project', id: route.projectId })} />}
        {route.name === 'folder' && (
          <div className="flex max-w-3xl flex-col gap-8">
            <FolderStep
              header={<PageHeader title={tx('folder.change')} subtitle={tx('folder.subtitle')} />}
              onChosen={() => {
                reload()
                toProjects()
              }}
            />
          </div>
        )}
        {route.name === 'prereq' && (
          <div className="flex max-w-3xl flex-col gap-8">
            <PrereqStep onContinue={toProjects} />
          </div>
        )}
        {route.name === 'history' && <HistoryScreen />}
        {route.name === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}
