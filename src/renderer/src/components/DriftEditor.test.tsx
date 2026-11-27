// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriftEditor } from './CameraTimePanel'

afterEach(cleanup)

const input = () => screen.getByLabelText('Seconds off') as HTMLInputElement
const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true'

describe('DriftEditor', () => {
  it('shows a drift set from outside (offset finder, copy from camera)', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DriftEditor id="d" value={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Clock fast or slow/ }))
    expect(input().value).toBe('')

    rerender(<DriftEditor id="d" value={218} onChange={onChange} />)
    expect(input().value).toBe('218')
    expect(pressed('Fast')).toBe(true)

    rerender(<DriftEditor id="d" value={-45} onChange={onChange} />)
    expect(input().value).toBe('45')
    expect(pressed('Slow')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the number when switching Fast/Slow after an outside change', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DriftEditor id="d" value={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Clock fast or slow/ }))
    rerender(<DriftEditor id="d" value={218} onChange={onChange} />)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Slow' })))
    expect(onChange).toHaveBeenLastCalledWith(-218)
  })

  it('opens with the current drift', () => {
    render(<DriftEditor id="d" value={133} onChange={() => {}} />)
    expect(input().value).toBe('133')
  })
})
