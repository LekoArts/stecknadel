import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  distanceMeters,
  expectedMatch,
  type OraclePoint,
  type OraclePosition,
  readGpxPoints,
  samePosition,
} from '@oracle/expected'
import { describe, expect, it } from 'vitest'
import { type CameraTimeSettings, defaultCameraSettings, splitAt } from './cameraSettings'
import { formatGeotime, instantSeconds, parseExifDateTime } from './exifDate'
import { type PhotoTimeInput, photoGeotime, photoUtc } from './toUtc'

const synthetic = readGpxPoints(
  readFileSync(join(__dirname, '../../../test/fixtures/synthetic-trip.gpx'), 'utf8'),
)
const utc = (iso: string): number => Date.parse(iso) / 1000

/** The EXIF wall time a camera shows for a true UTC instant: clock = UTC + offset + drift. */
function wallFor(trueUtc: number, offsetSeconds: number, driftSeconds = 0): string {
  const d = new Date((trueUtc + offsetSeconds + driftSeconds) * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

const photo = (
  captureTime: string | null,
  offsetTimeOriginal: string | null = null,
): PhotoTimeInput => ({
  captureTime,
  subSec: null,
  offsetTimeOriginal,
})

const H = 3600

/** A straight track around `centerUtc`: one fix per minute for ±2 h, moving ~30 m per minute. */
function lineTrack(centerUtc: number): OraclePoint[] {
  const points: OraclePoint[] = []
  for (let i = -120; i <= 120; i++) {
    points.push({
      t: centerUtc + i * 60,
      lat: 47 + (i + 120) * 2e-4,
      lon: 8 + (i + 120) * 3e-4,
      ele: 500 + i,
    })
  }
  return points
}

/** Where the app's computed UTC puts the photo, per the oracle. */
function landing(
  track: OraclePoint[],
  p: PhotoTimeInput,
  settings: CameraTimeSettings,
): OraclePosition | null {
  const { utc } = photoUtc(p, settings)
  return utc ? expectedMatch(track, instantSeconds(utc)) : null
}

/** Asserts the photo lands exactly where the oracle puts its true capture instant. */
function expectLandsAt(
  track: OraclePoint[],
  p: PhotoTimeInput,
  settings: CameraTimeSettings,
  trueUtc: number,
): OraclePosition {
  const expected = expectedMatch(track, trueUtc)
  expect(expected, 'oracle has a position for the true time').not.toBeNull()
  const actual = landing(track, p, settings)
  expect(
    samePosition(actual, expected),
    `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
  ).toBe(true)
  return expected as OraclePosition
}

const zone = (id: string, driftSeconds = 0): CameraTimeSettings => ({
  useRecordedOffsets: true,
  segments: [{ tz: { kind: 'zone', id }, driftSeconds }],
  confirmed: true,
})
const fixed = (value: string, driftSeconds = 0): CameraTimeSettings => ({
  useRecordedOffsets: true,
  segments: [{ tz: { kind: 'offset', value }, driftSeconds }],
  confirmed: true,
})

describe('several cameras, one trip, each with its own settings', () => {
  it('puts every camera’s photo of the same moment at the same place', () => {
    const trueUtc = utc('2026-06-01T07:30:00Z')
    // A: zone Europe/Zurich, right clock. B: fixed +02:00, 40 s fast. C: a wrong default zone, but
    // the camera records its offset. D: set to UTC (offset +00:00) and 5 min slow.
    const a = expectLandsAt(
      synthetic,
      photo(wallFor(trueUtc, 2 * H)),
      zone('Europe/Zurich'),
      trueUtc,
    )
    const b = expectLandsAt(
      synthetic,
      photo(wallFor(trueUtc, 2 * H, 40)),
      fixed('+02:00', 40),
      trueUtc,
    )
    const c = expectLandsAt(
      synthetic,
      photo(wallFor(trueUtc, 2 * H), '+02:00'),
      defaultCameraSettings('Asia/Tokyo'),
      trueUtc,
    )
    const d = expectLandsAt(
      synthetic,
      photo(wallFor(trueUtc, 0, -300)),
      fixed('+00:00', -300),
      trueUtc,
    )
    expect([b, c, d].every((p) => samePosition(p, a))).toBe(true)
  })
})

describe('mid-trip zone change (segment split)', () => {
  // Day 1 the camera shows UTC+02:00, day 2 UTC+01:00 (synthetic-trip.gpx scenario).
  const split = splitAt(
    zone('Europe/Zurich'),
    parseExifDateTime('2026:06:02 00:00:00') as NonNullable<ReturnType<typeof parseExifDateTime>>,
    { tz: { kind: 'offset', value: '+01:00' } },
  )
  const day1 = utc('2026-06-01T14:10:00Z')
  const day2 = utc('2026-06-02T09:15:00Z')

  it('places day-1 and day-2 photos with their own offsets', () => {
    expect(split.segments.map((s) => s.startsAt)).toEqual([undefined, '2026-06-02T00:00:00'])
    expectLandsAt(synthetic, photo(wallFor(day1, 2 * H)), split, day1)
    expectLandsAt(synthetic, photo(wallFor(day2, 1 * H)), split, day2)
    expect(photoGeotime(photo(wallFor(day2, 1 * H)), split)).toBe('2026:06:02 09:15:00Z')
  })

  it('forgotten zone change: a day-2 photo on the day-1 setting is 1 h off and lands elsewhere; the split fixes it', () => {
    const p = photo(wallFor(day2, 1 * H))
    const forgotten = zone('Europe/Zurich')
    const { utc: wrong } = photoUtc(p, forgotten)
    expect(instantSeconds(wrong as NonNullable<typeof wrong>) - day2).toBe(-H)
    const wrongAt = landing(synthetic, p, forgotten)
    const rightAt = expectLandsAt(synthetic, p, split, day2)
    expect(wrongAt).not.toBeNull()
    expect(distanceMeters(wrongAt as OraclePosition, rightAt)).toBeGreaterThan(500)
  })
})

describe('drift ±73 s', () => {
  const trueUtc = utc('2026-06-01T08:20:00Z')
  it.each([73, -73])('a camera %i s off lands right once drift is set', (drift) => {
    const p = photo(wallFor(trueUtc, 2 * H, drift))
    expectLandsAt(synthetic, p, zone('Europe/Zurich', drift), trueUtc)
    const uncorrected = landing(synthetic, p, zone('Europe/Zurich'))
    const right = expectedMatch(synthetic, trueUtc) as OraclePosition
    expect(samePosition(uncorrected, right)).toBe(false)
    expect(distanceMeters(uncorrected as OraclePosition, right)).toBeGreaterThan(10)
  })
})

describe('recorded OffsetTimeOriginal is used automatically', () => {
  it('2024:05:10 12:05:39 with −07:00 → 2024:05:10 19:05:39Z, at the oracle position', () => {
    const p = photo('2024:05:10 12:05:39', '-07:00')
    const settings = defaultCameraSettings('Europe/Berlin')
    const result = photoUtc(p, settings)
    expect(result.source).toBe('recorded-offset')
    expect(photoGeotime(p, settings)).toBe('2024:05:10 19:05:39Z')
    const trueUtc = utc('2024-05-10T19:05:39Z')
    expectLandsAt(lineTrack(trueUtc), p, settings, trueUtc)
  })

  it('a synthetic-trip photo with a recorded offset ignores a wrong segment until the toggle is off', () => {
    const trueUtc = utc('2026-06-01T09:00:00Z')
    const p = photo(wallFor(trueUtc, 2 * H), '+02:00')
    const settings = defaultCameraSettings('America/New_York')
    expectLandsAt(synthetic, p, settings, trueUtc)
    const off = { ...settings, useRecordedOffsets: false }
    expect(photoUtc(p, off).source).toBe('segment')
    expect(samePosition(landing(synthetic, p, off), expectedMatch(synthetic, trueUtc))).toBe(false)
  })
})

describe('offset-conflict warning', () => {
  const trueUtc = utc('2026-06-01T15:00:00Z')

  it('warns when a confirmed segment disagrees with the recorded offset; the recorded one still wins', () => {
    const p = photo(wallFor(trueUtc, 1 * H), '+01:00')
    const result = photoUtc(p, zone('Europe/Zurich'))
    expect(result.warnings).toEqual(['offset-conflict'])
    expect(result.source).toBe('recorded-offset')
    expectLandsAt(synthetic, p, zone('Europe/Zurich'), trueUtc)
  })

  it('does not warn when they agree, or while the zone is the unconfirmed default', () => {
    const agree = photo(wallFor(trueUtc, 2 * H), '+02:00')
    expect(photoUtc(agree, zone('Europe/Zurich')).warnings).toEqual([])
    expectLandsAt(synthetic, agree, zone('Europe/Zurich'), trueUtc)
    const unconfirmed = photo(wallFor(trueUtc, 1 * H), '+01:00')
    expect(photoUtc(unconfirmed, defaultCameraSettings('Europe/Zurich')).warnings).toEqual([])
    expectLandsAt(synthetic, unconfirmed, defaultCameraSettings('Europe/Zurich'), trueUtc)
  })

  it('still warns with recorded offsets turned off (the segment then wins)', () => {
    const p = photo(wallFor(trueUtc, 2 * H), '+01:00')
    const off = { ...zone('Europe/Zurich'), useRecordedOffsets: false }
    const result = photoUtc(p, off)
    expect(result).toMatchObject({ source: 'segment', warnings: ['offset-conflict'] })
    expectLandsAt(synthetic, p, off, trueUtc)
  })
})

describe('DST transitions', () => {
  it.each([
    // [zone, wall, expected UTC (compatible), ambiguous]
    ['Europe/Berlin', '2026:03:29 01:30:00', '2026-03-29T00:30:00Z', false],
    ['Europe/Berlin', '2026:03:29 02:30:00', '2026-03-29T01:30:00Z', true], // skipped → later (03:30 CEST)
    ['Europe/Berlin', '2026:03:29 03:30:00', '2026-03-29T01:30:00Z', false],
    ['Europe/Berlin', '2026:10:25 01:30:00', '2026-10-24T23:30:00Z', false],
    ['Europe/Berlin', '2026:10:25 02:30:00', '2026-10-25T00:30:00Z', true], // repeated → earlier (CEST)
    ['Europe/Berlin', '2026:10:25 03:30:00', '2026-10-25T02:30:00Z', false],
    ['America/Los_Angeles', '2026:11:01 00:30:00', '2026-11-01T07:30:00Z', false],
    ['America/Los_Angeles', '2026:11:01 01:30:00', '2026-11-01T08:30:00Z', true], // repeated → earlier (PDT)
    ['America/Los_Angeles', '2026:11:01 02:30:00', '2026-11-01T10:30:00Z', false],
  ])('%s %s → %s (ambiguous: %s)', (id, wall, expectedIso, ambiguous) => {
    const result = photoUtc(photo(wall), zone(id))
    expect(result.utc?.toString()).toBe(expectedIso)
    expect(result.warnings).toEqual(ambiguous ? ['ambiguous-local-time'] : [])
    const trueUtc = utc(expectedIso)
    expectLandsAt(lineTrack(trueUtc), photo(wall), zone(id), trueUtc)
  })

  it('a recorded offset makes a repeated hour unambiguous', () => {
    const result = photoUtc(
      photo('2026:10:25 02:30:00', '+01:00'),
      defaultCameraSettings('Europe/Berlin'),
    )
    expect(result.utc?.toString()).toBe('2026-10-25T01:30:00Z')
    expect(result.warnings).toEqual([])
  })
})

describe('British Columbia’s 2026 permanent −07:00', () => {
  it.each([
    ['America/Vancouver', '2026:11:07 13:28:21', '2026-11-07T20:28:21Z'],
    ['America/Vancouver', '2027:01:07 13:28:21', '2027-01-07T20:28:21Z'],
    ['America/Los_Angeles', '2026:11:07 13:28:21', '2026-11-07T21:28:21Z'],
  ])('%s %s → %s', (id, wall, expectedIso) => {
    const result = photoUtc(photo(wall), zone(id))
    expect(result.utc?.toString()).toBe(expectedIso)
    expect(result.warnings).toEqual([])
    const trueUtc = utc(expectedIso)
    expectLandsAt(lineTrack(trueUtc), photo(wall), zone(id), trueUtc)
  })

  it('Vancouver vs. Los Angeles for the same wall time are 1 h, and far, apart', () => {
    const track = lineTrack(utc('2026-11-07T21:00:00Z'))
    const p = photo('2026:11:07 13:28:21')
    const van = landing(track, p, zone('America/Vancouver')) as OraclePosition
    const la = landing(track, p, zone('America/Los_Angeles')) as OraclePosition
    expect(distanceMeters(van, la)).toBeGreaterThan(1000)
  })
})

describe('photos before and after the track', () => {
  const first = synthetic[0].t
  const last = synthetic[synthetic.length - 1].t

  it.each([
    ['31 min before the first fix', first - 31 * 60, null],
    ['20 min before the first fix', first - 20 * 60, 'first'],
    ['20 min after the last fix', last + 20 * 60, 'last'],
    ['31 min after the last fix', last + 31 * 60, null],
  ])('%s', (_, trueUtc, expected) => {
    const p = photo(wallFor(trueUtc, 2 * H))
    const settings = fixed('+02:00')
    expect(
      instantSeconds(photoUtc(p, settings).utc as NonNullable<ReturnType<typeof photoUtc>['utc']>),
    ).toBe(trueUtc)
    const at = landing(synthetic, p, settings)
    if (expected === null) expect(at).toBeNull()
    else {
      const fix = expected === 'first' ? synthetic[0] : synthetic[synthetic.length - 1]
      expect(samePosition(at, { lat: fix.lat, lon: fix.lon, ele: fix.ele })).toBe(true)
    }
  })
})

describe('missing capture time', () => {
  it.each([null, '', '0000:00:00 00:00:00', '2026:02:30 10:00:00', 'not a date'])(
    '%j → no UTC, no Geotime, no position',
    (captureTime) => {
      const p = photo(captureTime, '+02:00')
      expect(photoUtc(p, zone('Europe/Zurich'))).toEqual({
        utc: null,
        source: null,
        wall: null,
        warnings: [],
      })
      expect(photoGeotime(p, zone('Europe/Zurich'))).toBeNull()
      expect(landing(synthetic, p, zone('Europe/Zurich'))).toBeNull()
    },
  )
})

describe('Geotime format', () => {
  it('is ExifTool’s `YYYY:mm:dd HH:MM:SSZ`, fractions only when present', () => {
    expect(photoGeotime(photo('2026:11:06 14:34:00'), zone('America/Los_Angeles'))).toBe(
      '2026:11:06 22:34:00Z',
    )
    const sub: PhotoTimeInput = {
      captureTime: '2026:06:01 09:30:15',
      subSec: '25',
      offsetTimeOriginal: null,
    }
    expect(photoGeotime(sub, zone('Europe/Zurich'))).toBe('2026:06:01 07:30:15.25Z')
    expect(
      formatGeotime(
        photoUtc(sub, zone('Europe/Zurich')).utc as NonNullable<ReturnType<typeof photoUtc>['utc']>,
      ),
    ).toMatch(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
    expectLandsAt(synthetic, sub, zone('Europe/Zurich'), utc('2026-06-01T07:30:15.25Z'))
  })
})
