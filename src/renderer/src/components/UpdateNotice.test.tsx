// @vitest-environment jsdom
import type { UpdateState } from '@shared/ipc'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateNotice } from './UpdateNotice'

afterEach(cleanup)

function mockApi(initial: UpdateState) {
  let listener: ((s: UpdateState) => void) | undefined
  const installUpdate = vi.fn(async () => {})
  Object.assign(window, {
    stecknadel: {
      getUpdate: async () => initial,
      installUpdate,
      on: (_: 'update', fn: (s: UpdateState) => void) => {
        listener = fn
        return () => {}
      },
    },
  })
  return { push: (s: UpdateState) => act(() => listener?.(s)), installUpdate }
}

describe('UpdateNotice', () => {
  it('shows nothing without an update', async () => {
    mockApi({ kind: 'none' })
    render(<UpdateNotice />)
    await act(async () => {})
    expect(screen.queryByTestId('update-notice')).toBeNull()
  })

  it('links a newer release, and can be dismissed', async () => {
    mockApi({ kind: 'available', version: '0.2.0', url: 'https://github.com/x/releases/latest' })
    render(<UpdateNotice />)
    const link = await screen.findByRole('link', { name: 'Download' })
    expect(link.getAttribute('href')).toBe('https://github.com/x/releases/latest')
    expect(screen.getByText('Stecknadel 0.2.0 is available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('update-notice')).toBeNull()
  })

  it('a downloaded update restarts into it', async () => {
    const api = mockApi({ kind: 'none' })
    render(<UpdateNotice />)
    await act(async () => {})
    api.push({ kind: 'ready', version: '0.2.0' })
    fireEvent.click(screen.getByRole('button', { name: 'Restart to install' }))
    expect(api.installUpdate).toHaveBeenCalled()
  })
})
