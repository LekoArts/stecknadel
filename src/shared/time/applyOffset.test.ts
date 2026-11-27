import { describe, expect, it } from 'vitest'
import { applyOffsetCandidate } from './applyOffset'
import { type CameraTimeSettings, defaultCameraSettings } from './cameraSettings'
import type { OffsetCandidate } from './offsetFinder'
import { photoUtc } from './toUtc'

const candidate = (patch: Partial<OffsetCandidate>): OffsetCandidate => ({
  trackUtc: 0,
  distanceMeters: 5,
  correctionSeconds: -7 * 3600 + 73,
  offsetSeconds: -7 * 3600,
  offset: '-07:00',
  driftSeconds: 73,
  stationary: null,
  ...patch,
})

const timed = (
  settings: CameraTimeSettings,
  offsetTimeOriginal: string | null = null,
): Parameters<typeof applyOffsetCandidate>[1] => {
  const time = photoUtc(
    { captureTime: '2026:11:07 13:28:21', subSec: null, offsetTimeOriginal },
    settings,
  )
  if (!time.wall) throw new Error('no time')
  return time
}

describe('applyOffsetCandidate', () => {
  it('replaces a zone with the suggested fixed offset and drift', () => {
    const settings = defaultCameraSettings('Europe/Berlin')
    const next = applyOffsetCandidate(settings, timed(settings), null, candidate({}))
    expect(next.segments[0]).toEqual({ tz: { kind: 'offset', value: '-07:00' }, driftSeconds: 73 })
    expect(next.confirmed).toBe(true)
  })

  it('keeps a zone that already has the suggested offset, setting only drift', () => {
    const settings = defaultCameraSettings('America/Vancouver')
    const next = applyOffsetCandidate(settings, timed(settings), null, candidate({}))
    expect(next.segments[0]).toEqual({
      tz: { kind: 'zone', id: 'America/Vancouver' },
      driftSeconds: 73,
    })
  })

  it('changes only the segment the photo is in', () => {
    const settings: CameraTimeSettings = {
      useRecordedOffsets: true,
      confirmed: true,
      segments: [
        { tz: { kind: 'zone', id: 'Europe/Berlin' }, driftSeconds: 0 },
        {
          startsAt: '2026-11-05T00:00:00',
          tz: { kind: 'zone', id: 'Europe/Berlin' },
          driftSeconds: 0,
        },
      ],
    }
    const next = applyOffsetCandidate(settings, timed(settings), null, candidate({}))
    expect(next.segments[0]).toEqual(settings.segments[0])
    expect(next.segments[1].tz).toEqual({ kind: 'offset', value: '-07:00' })
  })

  it('sets only drift when the photo is timed by its recorded offset', () => {
    const settings = defaultCameraSettings('Europe/Berlin')
    const next = applyOffsetCandidate(settings, timed(settings, '-07:00'), '-07:00', candidate({}))
    expect(next.segments[0]).toEqual({
      tz: { kind: 'zone', id: 'Europe/Berlin' },
      driftSeconds: 73,
    })
  })

  it('leaves drift alone for a stationary window', () => {
    const settings = {
      ...defaultCameraSettings('Europe/Berlin'),
      segments: [{ tz: { kind: 'zone' as const, id: 'Europe/Berlin' }, driftSeconds: 12 }],
    }
    const next = applyOffsetCandidate(
      settings,
      timed(settings),
      null,
      candidate({ driftSeconds: null, stationary: { from: 0, to: 3600 } }),
    )
    expect(next.segments[0]).toEqual({ tz: { kind: 'offset', value: '-07:00' }, driftSeconds: 12 })
  })

  it('applied settings put the photo at the track time', () => {
    const settings = defaultCameraSettings('Europe/Berlin')
    const time = timed(settings)
    // Wall 13:28:21 read as UTC, camera 73 s fast at UTC−07:00 → track time 20:27:08Z.
    const next = applyOffsetCandidate(settings, time, null, candidate({}))
    const after = photoUtc(
      { captureTime: '2026:11:07 13:28:21', subSec: null, offsetTimeOriginal: null },
      next,
    )
    expect(after.utc?.toString()).toBe('2026-11-07T20:27:08Z')
  })
})
