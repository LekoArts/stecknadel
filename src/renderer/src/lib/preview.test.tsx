// @vitest-environment jsdom
import type { LibrarySnapshot } from '@shared/library'
import type { PreviewSnapshot } from '@shared/preview'
import type { CameraTimeSettings } from '@shared/time/cameraSettings'
import type { TrackSummary } from '@shared/track/types'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreview } from './preview'

const library = { folderName: 'trip', photos: [], cameras: [] } as unknown as LibrarySnapshot
const track = { count: 1 } as TrackSummary
const zurich = { segments: [{ tz: { kind: 'zone', id: 'Europe/Zurich' }, driftSeconds: 0 }] }
const tokyo = { segments: [{ tz: { kind: 'zone', id: 'Asia/Tokyo' }, driftSeconds: 0 }] }
const cameras = (c: object): Record<string, CameraTimeSettings> =>
  ({ c }) as unknown as Record<string, CameraTimeSettings>
// Stable identities: the hook reruns whenever these objects change.
const MANUAL = {}
const ZURICH = cameras(zurich)
const TOKYO = cameras(tokyo)
const snapshot = (generation: number): PreviewSnapshot => ({
  generation,
  results: [],
  recomputed: [],
  durationMs: 0,
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => res(value)
    reject = (error) => rej(error)
  })
  return { promise, resolve, reject }
}

describe('usePreview', () => {
  const pending: Deferred<PreviewSnapshot>[] = []

  beforeEach(() => {
    pending.length = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    ;(window as unknown as { stecknadel: unknown }).stecknadel = {
      runPreview: () => {
        const next = deferred<PreviewSnapshot>()
        pending.push(next)
        return next.promise
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a run whose answers arrive after the inputs changed', async () => {
    const { result, rerender } = renderHook(
      ({ zones }) => usePreview(library, track, zones, MANUAL, 'settings'),
      { initialProps: { zones: ZURICH } },
    )
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(pending).toHaveLength(1)

    // The user changes the camera's zone while the first run is in flight, and the old answer
    // arrives before the new run has even started (during the debounce).
    rerender({ zones: TOKYO })
    await act(async () => {
      pending[0].resolve(snapshot(1))
      await pending[0].promise
    })
    expect(result.current.snapshot).toBeNull()
    expect(result.current.running).toBe(true)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(pending).toHaveLength(2)

    await act(async () => {
      pending[1].resolve(snapshot(2))
      await pending[1].promise
    })
    expect(result.current.snapshot?.generation).toBe(2)
    expect(result.current.running).toBe(false)
  })

  it('keeps the last snapshot and shows the error when a run fails', async () => {
    const { result, rerender } = renderHook(
      ({ zones }) => usePreview(library, track, zones, MANUAL, 'settings'),
      { initialProps: { zones: ZURICH } },
    )
    act(() => {
      vi.advanceTimersByTime(400)
    })
    await act(async () => {
      pending[0].resolve(snapshot(1))
      await pending[0].promise
    })
    rerender({ zones: TOKYO })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    await act(async () => {
      pending[1].reject(new Error('ExifTool batch cluster has ended'))
      await pending[1].promise.catch(() => {})
    })
    expect(result.current.snapshot?.generation).toBe(1)
    expect(result.current.running).toBe(false)
    expect(result.current.error).toBe('ExifTool batch cluster has ended')
  })

  it('drops the running state when the track goes away', async () => {
    const { result, rerender } = renderHook(
      ({ summary }) => usePreview(library, summary, ZURICH, MANUAL, 'settings'),
      { initialProps: { summary: track as TrackSummary | null } },
    )
    act(() => {
      vi.advanceTimersByTime(400)
    })
    rerender({ summary: null })
    expect(result.current.snapshot).toBeNull()
    expect(result.current.running).toBe(false)
  })
})
