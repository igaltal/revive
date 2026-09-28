// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@/i18n'
import { installMockRevive } from '@/test/mockRevive'
import { UpdateNote } from './UpdateNote'

describe('the "Update ready" note', () => {
  it('stays away until an update is downloaded, then is a small note, never a dialog', async () => {
    const mock = installMockRevive({ uiLanguage: 'en' })
    render(<UpdateNote />)
    await act(async () => {})
    expect(screen.queryByTestId('update-note')).toBeNull()
    act(() => mock.emit('update:status', { state: 'downloading', current: '0.11.0', version: '0.11.1', channel: 'latest', percent: 40 }))
    expect(screen.queryByTestId('update-note')).toBeNull()
    act(() => mock.emit('update:status', { state: 'ready', current: '0.11.0', version: '0.11.1', channel: 'latest', percent: 100 }))
    const note = screen.getByTestId('update-note')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toContain('Update ready: Revive 0.11.1 installs when you quit.')
    expect(document.querySelector('[role="dialog"], [aria-modal]')).toBeNull()
    expect(mock.calls.some((c) => c.channel === 'update:install')).toBe(false)
    fireEvent.click(screen.getByTestId('update-install'))
    expect(mock.calls.some((c) => c.channel === 'update:install')).toBe(true)
  })
})
