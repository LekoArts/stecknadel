import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import {
  type CameraTimeSettings,
  cameraTimeSettingsSchema,
  copyZones,
  defaultCameraSettings,
  segmentFor,
  splitAt,
} from './cameraSettings'

const wall = (s: string): Temporal.PlainDateTime => Temporal.PlainDateTime.from(s)

describe('cameraTimeSettingsSchema', () => {
  it('accepts zones, offsets and ordered segments', () => {
    const ok: CameraTimeSettings = {
      useRecordedOffsets: true,
      confirmed: true,
      segments: [
        { tz: { kind: 'zone', id: 'America/Los_Angeles' }, driftSeconds: 0 },
        {
          startsAt: '2026-11-07T00:00:00',
          tz: { kind: 'offset', value: '-07:00' },
          driftSeconds: 73,
        },
      ],
    }
    expect(cameraTimeSettingsSchema.safeParse(ok).success).toBe(true)
    expect(cameraTimeSettingsSchema.safeParse(defaultCameraSettings('Europe/Berlin')).success).toBe(
      true,
    )
  })

  it.each([
    ['unknown zone', [{ tz: { kind: 'zone', id: 'Mars/Olympus' }, driftSeconds: 0 }]],
    ['bad offset', [{ tz: { kind: 'offset', value: '7' }, driftSeconds: 0 }]],
    ['drift over a day', [{ tz: { kind: 'offset', value: '+00:00' }, driftSeconds: 86_401 }]],
    [
      'first segment with a start',
      [{ startsAt: '2026-11-07T00:00:00', tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 }],
    ],
    [
      'unordered starts',
      [
        { tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 },
        { startsAt: '2026-11-08T00:00:00', tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 },
        { startsAt: '2026-11-07T00:00:00', tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 },
      ],
    ],
    [
      'impossible start',
      [
        { tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 },
        { startsAt: '2026-02-30T00:00:00', tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 },
      ],
    ],
  ])('rejects %s', (_, segments) => {
    expect(
      cameraTimeSettingsSchema.safeParse({ useRecordedOffsets: true, confirmed: true, segments })
        .success,
    ).toBe(false)
  })
})

describe('segments', () => {
  const sf = defaultCameraSettings('America/Los_Angeles')
  const split = splitAt(sf, wall('2026-11-07T00:00'), {
    tz: { kind: 'zone', id: 'America/Vancouver' },
  })

  it('splitAt inserts a confirmed segment that copies the current one, then patches it', () => {
    expect(split.confirmed).toBe(true)
    expect(split.segments).toEqual([
      { tz: { kind: 'zone', id: 'America/Los_Angeles' }, driftSeconds: 0 },
      {
        startsAt: '2026-11-07T00:00:00',
        tz: { kind: 'zone', id: 'America/Vancouver' },
        driftSeconds: 0,
      },
    ])
    // An earlier split lands before it; the same start replaces rather than duplicates.
    const twice = splitAt(splitAt(split, wall('2026-11-03T12:00')), wall('2026-11-07T00:00'))
    expect(twice.segments.map((s) => s.startsAt)).toEqual([
      undefined,
      '2026-11-03T12:00:00',
      '2026-11-07T00:00:00',
    ])
    expect(cameraTimeSettingsSchema.safeParse(twice).success).toBe(true)
  })

  it('segmentFor picks the last segment starting at or before the wall time', () => {
    expect(segmentFor(split, wall('2026-11-06T23:59:59')).tz).toEqual({
      kind: 'zone',
      id: 'America/Los_Angeles',
    })
    expect(segmentFor(split, wall('2026-11-07T00:00:00')).tz).toEqual({
      kind: 'zone',
      id: 'America/Vancouver',
    })
  })

  it('copyZones takes the other camera’s zones and changes but keeps this clock’s drift', () => {
    const fast: CameraTimeSettings = {
      useRecordedOffsets: false,
      segments: [{ tz: { kind: 'zone', id: 'Europe/Berlin' }, driftSeconds: 73 }],
      confirmed: false,
    }
    const copied = copyZones(fast, split)
    expect(copied).toEqual({
      useRecordedOffsets: false,
      confirmed: true,
      segments: [
        { tz: { kind: 'zone', id: 'America/Los_Angeles' }, driftSeconds: 73 },
        {
          startsAt: '2026-11-07T00:00:00',
          tz: { kind: 'zone', id: 'America/Vancouver' },
          driftSeconds: 73,
        },
      ],
    })
    expect(cameraTimeSettingsSchema.safeParse(copied).success).toBe(true)
  })
})
