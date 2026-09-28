import type { ReactNode } from 'react'
import { SettingsProvider } from './settings'
import { ProjectsProvider } from './projects'
import { RuntimeProvider } from './runtime'
import { OverlayProvider } from './overlay'
import { VersionsProvider } from './versions'
import { ClientProvider } from './client'

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <ClientProvider>
      <SettingsProvider>
        <ProjectsProvider>
          <RuntimeProvider>
            <VersionsProvider>
              <OverlayProvider>{children}</OverlayProvider>
            </VersionsProvider>
          </RuntimeProvider>
        </ProjectsProvider>
      </SettingsProvider>
    </ClientProvider>
  )
}
