import type { ReactNode } from 'react'
import { SettingsProvider } from './settings'
import { ProjectsProvider } from './projects'
import { RuntimeProvider } from './runtime'
import { OverlayProvider } from './overlay'
import { VersionsProvider } from './versions'
import { ClientProvider } from './client'
import { AppearanceProvider } from './appearance'

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <ClientProvider>
      <AppearanceProvider>
        <SettingsProvider>
          <ProjectsProvider>
            <RuntimeProvider>
              <VersionsProvider>
                <OverlayProvider>{children}</OverlayProvider>
              </VersionsProvider>
            </RuntimeProvider>
          </ProjectsProvider>
        </SettingsProvider>
      </AppearanceProvider>
    </ClientProvider>
  )
}
