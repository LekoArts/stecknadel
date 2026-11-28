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

// Berlin, a flight, San Jose, then Whistler (permanent −07:00 from Nov 2026).
const trip = trackOf([
  ['2026-11-01T08:00:00Z', '2026-11-02T08:00:00Z', 52.52, 13.4, 'Europe/Berlin'],
  ['2026-11-02T22:00:00Z', '2026-11-06T20:00:00Z', 37.34, -121.89, 'America/Los_Angeles'],
  ['2026-11-07T02:00:00Z', '2026-11-09T20:00:00Z', 50.12, -122.96, 'America/Vancouver'],
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

  it('fits a photo with a recorded offset only to zones with that offset', () => {
    const plain = photo('2026:11:05 10:00:00')
    const segments = (photos: ReturnType<typeof photo>[]) =>
      detectCameraSettings(photos, trip, true)?.segments.map((s) => [s.startsAt, s.tz])
    // -07:00 on Nov 8 is Vancouver (Los Angeles is −08:00 by then): a change starts there.
    expect(segments([plain, photo('2026:11:08 12:00:00', '-07:00')])).toEqual([
      [undefined, { kind: 'zone', id: 'America/Los_Angeles' }],
      ['2026-11-08T12:00:00', { kind: 'zone', id: 'America/Vancouver' }],
    ])
    // An offset no zone on the track had then, or a time past the track: no say.
    const alone = [[undefined, { kind: 'zone', id: 'America/Los_Angeles' }]]
    expect(segments([plain, photo('2026:11:08 12:00:00', '+05:30')])).toEqual(alone)
    expect(segments([plain, photo('2026:12:20 12:00:00', '-07:00')])).toEqual(alone)
    // When every photo says its offset, the camera setting isn't needed.
    expect(detectCameraSettings([photo('2026:11:08 12:00:00', '-07:00')], trip, true)).toBeNull()
    expect(
      detectCameraSettings([photo('2026:11:08 12:00:00', '-07:00')], trip, false)?.segments[0].tz,
    ).toEqual({ kind: 'zone', id: 'America/Vancouver' })
    expect(detectCameraSettings([photo(null)], trip, true)).toBeNull()
    expect(
      detectCameraSettings([photo('2026:11:08 12:00:00')], { points: [], zones: [] }, true),
    ).toBeNull()
  })

  it('takes either reading of a repeated DST hour that a photo recorded, and no other', () => {
    const la = trackOf([
      ['2026-10-31T16:00:00Z', '2026-11-02T08:00:00Z', 34.05, -118.24, 'America/Los_Angeles'],
    ])
    const photos = [
      photo('2026:10:31 12:00:00'),
      photo('2026:11:01 01:30:00', '-07:00'),
      photo('2026:11:01 01:30:00', '-08:00'),
    ]
    const settings = detectCameraSettings(photos, la, true) as CameraTimeSettings
    expect(settings.segments).toEqual([
      { tz: { kind: 'zone', id: 'America/Los_Angeles' }, driftSeconds: 0 },
    ])
    const timed = (p: ReturnType<typeof photo>) => photoUtc({ ...p, subSec: null }, settings)
    expect(timed(photos[1]).utc?.toString()).toBe('2026-11-01T08:30:00Z')
    expect(timed(photos[2]).utc?.toString()).toBe('2026-11-01T09:30:00Z')
    for (const p of photos) expect(timed(p).warnings).toEqual([])
    expect(timed(photo('2026:11:01 01:30:00', '-06:00')).warnings).toEqual(['offset-conflict'])
  })

  it('a recorded offset for a skipped spring-forward time still conflicts', () => {
    const berlin: CameraTimeSettings = {
      useRecordedOffsets: true,
      segments: [{ tz: { kind: 'zone', id: 'Europe/Berlin' }, driftSeconds: 0 }],
      confirmed: true,
    }
    const warnings = (wall: string, offset: string) =>
      photoUtc({ captureTime: wall, subSec: null, offsetTimeOriginal: offset }, berlin).warnings
    // 02:30 doesn't exist in Berlin on 2026-03-29: neither side's offset is a reading of it.
    expect(warnings('2026:03:29 02:30:00', '+02:00')).toEqual(['offset-conflict'])
    // Either side of the change, the right offset is fine.
    expect(warnings('2026:03:29 01:30:00', '+01:00')).toEqual([])
    expect(warnings('2026:03:29 03:30:00', '+02:00')).toEqual([])
  })

  it('finds the same zone change after the first photo in the new zone got its offset written', () => {
    const walls = ['2026:11:05 10:00:00', '2026:11:07 13:28:21', '2026:11:09 09:00:00']
    const before = detectCameraSettings(
      walls.map((w) => photo(w)),
      trip,
      true,
    ) as CameraTimeSettings
    expect(before.segments.map((s) => s.startsAt)).toEqual([undefined, '2026-11-07T13:28:21'])

    // Placed at UTC−07:00, which writing saves in the photo; the library then reloads it.
    const timed = (p: ReturnType<typeof photo>) => ({ ...p, subSec: null })
    expect(photoUtc(timed(photo(walls[1])), before).utc?.toString()).toBe('2026-11-07T20:28:21Z')
    const written = walls.map((w, i) => photo(w, i === 1 ? '-07:00' : null))
    const after = detectCameraSettings(written, trip, true) as CameraTimeSettings
    expect(after.segments).toEqual(before.segments)
    for (const p of written) expect(photoUtc(timed(p), after).warnings).toEqual([])
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
