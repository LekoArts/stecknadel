import type { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import type { CameraTimeSettings } from './cameraSettings'
import { detectCameraSettings, type ZonedTrack, zoneAt } from './detectZones'
import { instantSeconds } from './exifDate'
import { photoUtc } from './toUtc'

const t = (iso: string): number => Date.parse(iso) / 1000

/** Hourly points while at a place: `[from, to, lat, lon, zone]`. */
function trackOf(stays: [string, string, number, number, string][]): ZonedTrack {
  const points: [number, number, number][] = []
  const zones: string[] = []
  for (const [from, to, lat, lon, zone] of stays) {
    for (let s = t(from); s <= t(to); s += 3600) {
      points.push([s, lat, lon])
      zones.push(zone)
    }
  }
  return { points, zones }
}

// Berlin, a flight, San Francisco, then Vancouver (permanent −07:00 from Nov 2026).
const trip = trackOf([
  ['2026-11-01T08:00:00Z', '2026-11-02T08:00:00Z', 52.52, 13.4, 'Europe/Berlin'],
  ['2026-11-02T22:00:00Z', '2026-11-06T20:00:00Z', 37.8, -122.42, 'America/Los_Angeles'],
  ['2026-11-07T02:00:00Z', '2026-11-09T20:00:00Z', 49.28, -123.12, 'America/Vancouver'],
])

const photo = (captureTime: string | null, offsetTimeOriginal: string | null = null) => ({
  captureTime,
  offsetTimeOriginal,
})

describe('zoneAt', () => {
  it('reads the zone at a point, across a gap only where both ends agree', () => {
    expect(zoneAt(trip, t('2026-11-01T12:30:00Z'))).toBe('Europe/Berlin')
    // Mid-flight, 7 h from either end: the track can't tell.
    expect(zoneAt(trip, t('2026-11-02T15:00:00Z'))).toBeNull()
    // Just after landing.
    expect(zoneAt(trip, t('2026-11-02T20:00:00Z'))).toBe('America/Los_Angeles')
    expect(zoneAt(trip, t('2026-10-01T00:00:00Z'))).toBeNull()
    expect(zoneAt({ points: [], zones: [] }, 0)).toBeNull()
  })
})

describe('detectCameraSettings', () => {
  it('finds the zone the clock was set to and each change along the trip', () => {
    // Clock set to local time throughout: Berlin, then SF, then Vancouver.
    const photos = [
      photo('2026:11:01 14:00:00'),
      photo('2026:11:02 08:30:00'),
      photo('2026:11:03 10:00:00'),
      photo('2026:11:05 16:00:00'),
      photo('2026:11:08 12:00:00'),
      photo('2026:11:09 09:00:00'),
    ]
    const settings = detectCameraSettings(photos, trip, true)
    expect(settings?.segments).toEqual([
      { tz: { kind: 'zone', id: 'Europe/Berlin' }, driftSeconds: 0 },
      {
        startsAt: '2026-11-03T10:00:00',
        tz: { kind: 'zone', id: 'America/Los_Angeles' },
        driftSeconds: 0,
      },
      {
        startsAt: '2026-11-08T12:00:00',
        tz: { kind: 'zone', id: 'America/Vancouver' },
        driftSeconds: 0,
      },
    ])
    // Every photo then lands where the track was.
    for (const p of photos) {
      const { utc } = photoUtc({ ...p, subSec: null }, settings as CameraTimeSettings)
      expect(zoneAt(trip, instantSeconds(utc as Temporal.Instant))).not.toBeNull()
    }
  })

  it('keeps one zone across neighbours with the same offset', () => {
    const border = trackOf([
      ['2026-06-01T06:00:00Z', '2026-06-01T12:00:00Z', 52.37, 4.9, 'Europe/Amsterdam'],
      ['2026-06-01T13:00:00Z', '2026-06-01T20:00:00Z', 52.21, 7.02, 'Europe/Berlin'],
    ])
    const settings = detectCameraSettings(
      [photo('2026:06:01 10:00:00'), photo('2026:06:01 18:00:00')],
      border,
      true,
    )
    expect(settings?.segments).toHaveLength(1)
  })

  it('prefers the zone the first photo was taken in when several fit', () => {
    const settings = detectCameraSettings([photo('2026:11:06 10:00:00')], trip, true)
    expect(settings?.segments[0].tz).toEqual({ kind: 'zone', id: 'America/Los_Angeles' })
  })

  it('skips photos with a recorded offset, and returns null when nothing is left to place', () => {
    expect(detectCameraSettings([photo('2026:11:08 12:00:00', '-07:00')], trip, true)).toBeNull()
    expect(
      detectCameraSettings([photo('2026:11:08 12:00:00', '-07:00')], trip, false)?.segments[0].tz,
    ).toEqual({ kind: 'zone', id: 'America/Vancouver' })
    expect(detectCameraSettings([photo(null)], trip, true)).toBeNull()
    expect(
      detectCameraSettings([photo('2026:11:08 12:00:00')], { points: [], zones: [] }, true),
    ).toBeNull()
  })

  it('ignores photos the track can’t place', () => {
    // 2026-12-01 is past the track; it must not start a change.
    const settings = detectCameraSettings(
      [photo('2026:11:08 12:00:00'), photo('2026:12:01 12:00:00')],
      trip,
      true,
    )
    expect(settings?.segments).toEqual([
      { tz: { kind: 'zone', id: 'America/Vancouver' }, driftSeconds: 0 },
    ])
  })
})
