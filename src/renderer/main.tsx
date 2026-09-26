import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/theme.css'
import './i18n'
import { SettingsProvider } from './state/settings'
import { ProjectsProvider } from './state/projects'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ProjectsProvider>
        <App />
      </ProjectsProvider>
    </SettingsProvider>
  </StrictMode>
)
