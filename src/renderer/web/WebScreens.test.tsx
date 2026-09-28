// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@/i18n'
import { applyLanguage } from '@/i18n'
import { WebOffline, WebPair } from './WebScreens'

afterEach(() => {
  vi.unstubAllGlobals()
  applyLanguage('en')
})

describe('pairing in the browser', () => {
  it('sends the code and this device’s name, waits for the Host, and never handles a token', async () => {
    const calls: Array<{ url: string; body?: string }> = []
    let polls = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined })
      if (url === '/pair') return new Response(JSON.stringify({ requestId: '11111111-2222-3333-4444-555555555555', hostName: 'Studio Mac' }), { status: 202 })
      polls += 1
      // The Host answers with a cookie (not visible here) and no token in the body.
      return new Response(JSON.stringify(polls < 2 ? { state: 'pending' } : { state: 'approved', deviceId: 'd1', hostName: 'Studio Mac' }), { status: 200 })
    })
    const paired = vi.fn()
    render(<WebPair signedOutFrom={null} onPaired={paired} />)
    fireEvent.change(screen.getByTestId('web-pair-code'), { target: { value: '12 34 56' } })
    fireEvent.change(screen.getByTestId('web-pair-name'), { target: { value: 'Noa phone' } })
    fireEvent.click(screen.getByTestId('web-pair-submit'))
    expect((await screen.findByTestId('web-pair-waiting')).textContent).toBe('Waiting for Studio Mac to allow this computer…')
    await waitFor(() => expect(paired).toHaveBeenCalled(), { timeout: 5000 })
    expect(JSON.parse(calls[0]!.body!)).toEqual({ code: '123456', deviceName: 'Noa phone' })
  })

  it('explains a wrong code in one sentence', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'bad_code' }), { status: 403 }))
    render(<WebPair signedOutFrom={null} onPaired={() => {}} />)
    fireEvent.change(screen.getByTestId('web-pair-code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('web-pair-submit'))
    expect((await screen.findByTestId('web-pair-problem')).textContent).toBe("That code didn't work. Check it on the other computer's screen.")
  })

  it('after a revoke, says this device was signed out, in Hebrew too', async () => {
    applyLanguage('he')
    render(<WebPair signedOutFrom="Studio Mac" onPaired={() => {}} />)
    expect((await screen.findByTestId('web-signed-out')).textContent).toContain('המכשיר הזה נותק מ־Studio Mac')
    expect(document.documentElement.dir).toBe('rtl')
  })
})

describe('when the Host can’t be reached', () => {
  it('names the last known Host and offers a retry, instead of a blank page', () => {
    const retry = vi.fn()
    render(<WebOffline hostName="Studio Mac" trying={false} onRetry={retry} />)
    expect(screen.getByTestId('web-offline').textContent).toContain("Revive can't reach Studio Mac")
    fireEvent.click(screen.getByTestId('web-retry'))
    expect(retry).toHaveBeenCalled()
  })
})
