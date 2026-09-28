// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { sampleManifest } from '@shared/test-fixtures'
import { AppProviders } from '@/state/AppProviders'
import { App } from '@/App'
import { installMockRevive } from '@/test/mockRevive'

const folder = { uiLanguage: 'en' as const, lastFolder: '/Users/noa/ai-projects' }
const renderApp = () =>
  render(
    <AppProviders>
      <App />
    </AppProviders>
  )
const root = () => document.documentElement

afterEach(() => {
  root().removeAttribute('data-theme')
})

async function openCustomize() {
  const mock = installMockRevive(folder, { 'manifest:get': () => ({ state: 'ok', manifest: sampleManifest() }) })
  renderApp()
  fireEvent.click(await screen.findByTestId('nav-settings'))
  fireEvent.click(await screen.findByTestId('open-customize'))
  await screen.findByTestId('customize')
  return mock
}

describe('Customize', () => {
  it('previews every change on the whole app before saving, and Save keeps it', async () => {
    const mock = await openCustomize()
    expect(root().dataset['theme']).toBe('paper')
    fireEvent.click(within(screen.getByTestId('set-theme')).getByText('Scenic'))
    // Shown at once, not stored yet.
    expect(root().dataset['theme']).toBe('scenic')
    expect(screen.getByTestId('customize-unsaved')).toBeTruthy()
    expect(mock.calls.some((c) => c.channel === 'appearance:set')).toBe(false)

    fireEvent.click(screen.getByTestId('accent-teal'))
    expect(root().style.getPropertyValue('--color-accent-fill')).toBe('#3cc4b0')
    fireEvent.click(within(screen.getByTestId('set-glass')).getByText('Strong'))
    fireEvent.click(screen.getByTestId('customize-save'))
    await waitFor(() => expect(mock.calls.find((c) => c.channel === 'appearance:set')?.args).toMatchObject({ theme: 'scenic', accent: 'teal', glass: 'strong' }))
    expect(screen.queryByTestId('customize-unsaved')).toBeNull()
  })

  it('undoing puts everything back, and so does leaving without saving', async () => {
    const mock = await openCustomize()
    fireEvent.click(within(screen.getByTestId('set-theme')).getByText('Scenic'))
    expect(root().dataset['theme']).toBe('scenic')
    fireEvent.click(screen.getByTestId('customize-discard'))
    expect(root().dataset['theme']).toBe('paper')

    fireEvent.click(within(screen.getByTestId('set-theme')).getByText('Scenic'))
    fireEvent.click(screen.getByTestId('nav-projects'))
    await screen.findAllByTestId('project-card')
    expect(root().dataset['theme']).toBe('paper')
    expect(mock.calls.some((c) => c.channel === 'appearance:set')).toBe(false)
  })

  it('each section has its own reset to default', async () => {
    await openCustomize()
    fireEvent.click(within(screen.getByTestId('set-motion')).getByText('Off'))
    fireEvent.click(within(screen.getByTestId('set-glass')).getByText('Light'))
    fireEvent.click(screen.getByTestId('reset-motion'))
    expect(within(screen.getByTestId('set-motion')).getByText('Full').closest('button')!.getAttribute('aria-checked')).toBe('true')
    // The other section keeps its change.
    expect(within(screen.getByTestId('set-glass')).getByText('Light').closest('button')!.getAttribute('aria-checked')).toBe('true')
  })

  it('reorders and hides Home widgets, and pins a project', async () => {
    const mock = await openCustomize()
    fireEvent.click(screen.getByTestId('widget-uptime-up'))
    fireEvent.click(screen.getByTestId('widget-command'))
    fireEvent.click(within(screen.getAllByTestId('tile-row')[0]!).getByTestId('tile-pin'))
    fireEvent.click(screen.getByTestId('customize-save'))
    await waitFor(() => expect(mock.calls.some((c) => c.channel === 'appearance:set')).toBe(true))
    const saved = mock.calls.find((c) => c.channel === 'appearance:set')!.args as { widgets: Array<{ id: string; visible: boolean }>; tiles: Record<string, { pinned: boolean }> }
    expect(saved.widgets.map((w) => w.id)).toEqual(['command', 'tiles', 'vitals', 'uptime', 'agents'])
    expect(saved.widgets.find((w) => w.id === 'command')!.visible).toBe(false)
    expect(saved.tiles[sampleManifest().projects[0]!.id]!.pinned).toBe(true)
  })
})
