import type { ReactNode } from 'react'
import { SettingsProvider } from './settings'
import { ProjectsProvider } from './projects'
import { RuntimeProvider } from './runtime'

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <SettingsProvider>
      <ProjectsProvider>
        <RuntimeProvider>{children}</RuntimeProvider>
      </ProjectsProvider>
    </SettingsProvider>
  )
}
