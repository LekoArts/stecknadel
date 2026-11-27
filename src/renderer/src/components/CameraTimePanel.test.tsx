// @vitest-environment jsdom
import type { CameraSummary } from '@shared/library'
import { type CameraTimeSettings, defaultCameraSettings } from '@shared/time/cameraSettings'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraTimePanel, type CameraTimeStats } from './CameraTimePanel'

afterEach(cleanup)

const camera = {
  key: 'c',
  name: 'GR IV',
  defaultName: 'GR IV',
  make: 'Ricoh',
  model: 'GR IV',
  serial: null,
  count: 2,
  formats: ['DNG'],
  recordsOffsets: false,
} satisfies CameraSummary

const stats: CameraTimeStats = {
  noTime: 0,
  ambiguous: 0,
  conflict: 0,
  recorded: 0,
  offsets: [],
  first: '2026:11:07 20:28:21',
}

const fixed = (value: string): CameraTimeSettings => ({
  ...defaultCameraSettings('UTC'),
  confirmed: true,
  segments: [{ tz: { kind: 'offset', value }, driftSeconds: 0 }],
})

function show(settings: CameraTimeSettings, onChange = vi.fn()) {
  const ui = (next: CameraTimeSettings) => (
    <CameraTimePanel
      camera={camera}
      settings={next}
      origin="user"
      stats={stats}
      tripZones={[]}
      copySources={[]}
      selectedCaptureTime={null}
      onChange={onChange}
      onCopyFrom={() => {}}
    />
  )
  const { rerender } = render(ui(settings))
  return { rerender: (next: CameraTimeSettings) => rerender(ui(next)), onChange }
}

const offsetField = () => screen.getByLabelText('UTC') as HTMLInputElement

describe('the fixed UTC offset field', () => {
  it('shows an offset that came from another camera', () => {
    const { rerender } = show(fixed('-08:00'))
    expect(offsetField().value).toBe('-08:00')
    // "Copy from camera" replaces this camera's segments with the other camera's.
    rerender(fixed('+09:00'))
    expect(offsetField().value).toBe('+09:00')
  })

  it('does not write the old offset back when it loses focus', () => {
    const { rerender, onChange } = show(fixed('-08:00'))
    rerender(fixed('+09:00'))
    fireEvent.blur(offsetField())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still commits what the user types, and restores on Escape', () => {
    const { onChange } = show(fixed('-08:00'))
    const input = offsetField()
    fireEvent.change(input, { target: { value: '+02:30' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true }))
    const written = (onChange.mock.calls[0][0] as CameraTimeSettings).segments[0].tz
    expect(written).toEqual({ kind: 'offset', value: '+02:30' })

    fireEvent.change(input, { target: { value: 'half past' } })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('-08:00')
  })
})
