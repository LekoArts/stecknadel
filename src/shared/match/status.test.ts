import { describe, expect, it } from 'vitest'
import {
  type ClassifyContext,
  type ClassifyPhoto,
  classify,
  SIDECAR_COLLISION,
  statusReason,
} from './status'

const T0 = Date.UTC(2026, 5, 1, 6) / 1000
const points = [
  { t: T0, lat: 46.5, lon: 7.9 },
  { t: T0 + 3600, lat: 46.51, lon: 7.9 },
  // 3 h gap, ~1.1 km.
  { t: T0 + 4 * 3600, lat: 46.52, lon: 7.9 },
  { t: T0 + 5 * 3600, lat: 46.52, lon: 7.9 },
]
const ctx: ClassifyContext = {
  points,
  intervals: [{ from: T0 + 4 * 3600, to: T0 + 5 * 3600 }],
  limits: { geoMaxIntSecs: 1800, geoMaxExtSecs: 1800 },
  overwriteGps: false,
  rawTarget: 'in-file',
  fetchedRange: null,
}
const photo = (over: Partial<ClassifyPhoto>): ClassifyPhoto => ({
  utc: T0 + 600,
  readError: null,
  hasGps: false,
  sidecarCollision: false,
  manual: false,
  exiftoolMatched: false,
  ...over,
})

describe('classify', () => {
  it('ExifTool matched → matched, or matched-stay inside a bridged interval', () => {
    expect(classify(photo({ exiftoolMatched: true }), ctx)).toEqual({ kind: 'matched' })
    expect(classify(photo({ exiftoolMatched: true, utc: T0 + 4.5 * 3600 }), ctx)).toEqual({
      kind: 'matched-stay',
    })
    // The interval's own end fixes are ordinary matches.
    expect(classify(photo({ exiftoolMatched: true, utc: T0 + 4 * 3600 }), ctx).kind).toBe('matched')
  })

  it('unmatched → before-track, after-track or in-gap with minutes and distance', () => {
    expect(classify(photo({ utc: T0 - 7200 }), ctx)).toEqual({
      kind: 'before-track',
      seconds: 7200,
    })
    expect(classify(photo({ utc: T0 + 5 * 3600 + 5400 }), ctx)).toEqual({
      kind: 'after-track',
      seconds: 5400,
    })
    expect(classify(photo({ utc: T0 + 2.5 * 3600 }), ctx)).toEqual({
      kind: 'in-gap',
      gapMinutes: 180,
      distanceMeters: 1112,
    })
  })

  it('precedence: excluded, manual, has-gps, no-capture-time', () => {
    expect(classify(photo({ readError: 'Not a photo', manual: true }), ctx)).toEqual({
      kind: 'excluded',
      reason: 'Not a photo',
    })
    expect(classify(photo({ manual: true, hasGps: true }), ctx)).toEqual({ kind: 'manual' })
    expect(classify(photo({ hasGps: true, exiftoolMatched: true }), ctx)).toEqual({
      kind: 'has-gps',
    })
    expect(
      classify(photo({ hasGps: true, exiftoolMatched: true }), { ...ctx, overwriteGps: true }),
    ).toEqual({
      kind: 'matched',
    })
    expect(classify(photo({ utc: null }), ctx)).toEqual({ kind: 'no-capture-time' })
  })

  it('outside the Dawarich fetch range is reported instead of before/after', () => {
    const fetched = {
      ...ctx,
      fetchedRange: {
        start: new Date((T0 - 3600) * 1000).toISOString(),
        end: new Date((T0 + 6 * 3600) * 1000).toISOString(),
      },
    }
    expect(classify(photo({ utc: T0 - 7200 }), fetched)).toEqual({ kind: 'outside-fetched-range' })
    // Well inside the range: the real reason.
    expect(classify(photo({ utc: T0 + 2.5 * 3600 }), fetched).kind).toBe('in-gap')
    // A match is a match even near the range edge.
    expect(classify(photo({ utc: T0 - 1000, exiftoolMatched: true }), fetched).kind).toBe('matched')
  })

  it('reason text', () => {
    expect(statusReason({ kind: 'in-gap', gapMinutes: 697, distanceMeters: 8_712_345 })).toBe(
      'In a 11.6 h gap between points 8712 km apart',
    )
    expect(statusReason({ kind: 'before-track', seconds: 1200 })).toBe(
      '20 min before the first track point',
    )
    expect(statusReason({ kind: 'after-track', seconds: 3 * 86_400 })).toBe(
      '3 days after the last track point',
    )
  })

  it('a RAW whose sidecar would collide is excluded only in sidecar mode', () => {
    const p = photo({ sidecarCollision: true, exiftoolMatched: true })
    expect(classify(p, ctx).kind).toBe('matched')
    expect(classify(p, { ...ctx, rawTarget: 'sidecar' })).toEqual({
      kind: 'excluded',
      reason: SIDECAR_COLLISION,
    })
  })
})
