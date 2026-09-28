import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '@/state/settings'
import { useProjects } from '@/state/projects'
import { useT } from '@/i18n/useT'
import { PhoneTopBar, Rail, Sidebar, TabBar, type Route } from '@/components/Sidebar'
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
import { useAppearance } from '@/state/appearance'
import { ConnectionPill, PairingRequests } from '@/components/host'
import { ClientConnecting, ClientRejected } from '@/screens/ClientScreens'
import { TerminalScreen } from '@/screens/TerminalScreen'
import { HomeScreen } from '@/screens/HomeScreen'
import { CustomizeScreen } from '@/screens/CustomizeScreen'
import { Onboarding } from '@/screens/onboarding/Onboarding'
import { FolderStep } from '@/screens/onboarding/FolderStep'
import { PrereqStep } from '@/screens/onboarding/PrereqStep'
import { SceneBackdrop } from '@/components/SceneBackdrop'
import { Screensaver } from '@/components/Screensaver'
import { UpdateNote } from '@/components/UpdateNote'
import { useNarrow } from '@/components/media'
import { cx } from '@/components/cx'

type AppRoute =
  | { name: Route }
  | { name: 'customize' }
  | { name: 'folder' }
  | { name: 'prereq' }
  | { name: 'project'; id: string }
  | { name: 'terminal'; projectId: string; sessionId: string }

export function App(): ReactNode {
  const { host } = useHostStatus()
  // A device asking to connect is answered from any screen on the Host.
  return (
    <>
      <SceneBackdrop />
      <Screens />
      <PairingRequests host={host} />
      <Screensaver />
      <UpdateNote />
    </>
  )
}

/** Scenic: screens other than Home sit on one sheet of glass, so no text is ever straight on a bright sky. */
export function GlassSheet({ children, fill }: { children: ReactNode; fill?: boolean }): ReactNode {
  const { theme } = useAppearance()
  if (theme !== 'scenic') return <>{children}</>
  return (
    <div data-testid="glass-sheet" className={cx('glass sheet rounded-[24px] px-10 py-9 max-[639px]:rounded-[20px] max-[639px]:px-3 max-[639px]:py-5', fill ? 'flex min-h-full flex-col' : null)}>
      {children}
    </div>
  )
}

function Screens(): ReactNode {
  const client = useClient()
  const { settings, loaded } = useSettings()
  const { scan, reload } = useProjects()
  const { tx } = useT()
  const { guard, recheck } = useGuard()
  const { theme, mode } = useAppearance()
  const narrow = useNarrow()
  // Until the user goes somewhere: Home in Host and client mode, the gallery in local mode.
  const [chosen, setRoute] = useState<AppRoute | null>(null)
  const route: AppRoute = chosen ?? { name: mode === 'local' ? 'projects' : 'home' }
  const scrollRoot = useRef<HTMLElement>(null)
  // Every screen opens at its top (the project page leads with its preview).
  useLayoutEffect(() => {
    scrollRoot.current?.scrollTo?.({ top: 0 })
  }, [route.name])
  // Leaving Customize without saving puts the look back. (Not on unmount: trying another
  // look redraws the whole app around the Customize screen, which must keep its changes.)
  const { discard } = useAppearance()
  const onCustomize = route.name === 'customize'
  useEffect(() => {
    if (!onCustomize) discard()
  }, [onCustomize, discard])

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
  const navRoute: Route = route.name === 'home' || route.name === 'history' || route.name === 'settings' ? route.name : route.name === 'customize' ? 'settings' : 'projects'
  const navigate = (name: Route) => setRoute({ name })
  const openTerminal = (projectId: string, sessionId: string) => setRoute({ name: 'terminal', projectId, sessionId })

  const content = (
    <>
      {route.name === 'home' && (
        <HomeScreen
          onOpenProject={(id) => setRoute({ name: 'project', id })}
          onOpenTerminal={openTerminal}
          onCustomize={() => setRoute({ name: 'customize' })}
          onNavigate={navigate}
        />
      )}
      {route.name === 'projects' && (
        <ProjectsScreen onChangeFolder={() => setRoute({ name: 'folder' })} onOpenProject={(id) => setRoute({ name: 'project', id })} onCheckComputer={() => setRoute({ name: 'prereq' })} />
      )}
      {route.name === 'project' && <ProjectScreen projectId={route.id} onBack={toProjects} onOpenTerminal={(sessionId) => openTerminal(route.id, sessionId)} />}
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
      {route.name === 'settings' && <SettingsScreen onCustomize={() => setRoute({ name: 'customize' })} />}
      {route.name === 'customize' && <CustomizeScreen onDone={() => setRoute({ name: 'settings' })} />}
    </>
  )

  if (theme === 'paper') {
    return (
      <div className="flex h-full max-[639px]:flex-col" data-shell="paper">
        <Sidebar route={navRoute} onNavigate={navigate} />
        <main ref={scrollRoot} data-scroll-root className="min-w-0 flex-1 overflow-y-auto px-12 py-10 max-[639px]:px-4 max-[639px]:py-5">
          {content}
        </main>
      </div>
    )
  }

  const home = route.name === 'home'
  const fill = route.name === 'terminal'
  if (narrow) {
    // The terminal needs the whole screen and its key row above the keyboard: no tab bar there (it has its own back).
    const tabs = route.name !== 'terminal'
    return (
      <div className="flex h-full flex-col" data-shell="scenic-phone">
        <main ref={scrollRoot} data-scroll-root className={cx('min-w-0 flex-1 overflow-y-auto pt-5', home ? 'px-4' : 'px-3', tabs ? 'pb-28' : 'pb-5')}>
          {home ? (
            content
          ) : (
            <>
              <PhoneTopBar />
              <GlassSheet>{content}</GlassSheet>
            </>
          )}
        </main>
        {tabs ? <TabBar route={navRoute} onNavigate={navigate} /> : null}
      </div>
    )
  }
  return (
    <div className="flex h-full gap-6 p-5" data-shell="scenic">
      <Rail route={navRoute} onNavigate={navigate} />
      <main ref={scrollRoot} data-scroll-root className={cx('min-w-0 flex-1 overflow-y-auto', home ? null : 'py-1')}>
        {home ? (
          content
        ) : (
          <>
            {client.host ? (
              <div className="flex justify-end pb-3">
                <ConnectionPill />
              </div>
            ) : null}
            <GlassSheet fill={fill}>{content}</GlassSheet>
          </>
        )}
      </main>
    </div>
  )
}
