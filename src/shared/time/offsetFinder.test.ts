import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  distanceMeters,
  expectedMatch,
  type OraclePoint,
  type OraclePosition,
  readGpxPoints,
} from '@oracle/expected'
import type { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { parseExifDateTime } from './exifDate'
import { findOffsetCandidates } from './offsetFinder'

const synthetic = readGpxPoints(
  readFileSync(join(__dirname, '../../../test/fixtures/synthetic-trip.gpx'), 'utf8'),
)
const utc = (iso: string): number => Date.parse(iso) / 1000
const H = 3600
const LIMITS = { geoMaxIntSecs: 1800 }

/** The wall time a camera shows for a true UTC: clock = UTC + offset + drift. */
function wall(trueUtc: number, offsetSeconds: number, driftSeconds = 0): Temporal.PlainDateTime {
  const d = new Date((trueUtc + offsetSeconds + driftSeconds) * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  const exif = `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  return parseExifDateTime(exif) as Temporal.PlainDateTime
}

/** The click: exactly where the oracle puts the true capture instant. */
function clickAt(track: OraclePoint[], trueUtc: number): OraclePosition {
  const at = expectedMatch(track, trueUtc)
  if (!at) throw new Error('oracle has no position')
  return at
}

/** Moves a position `meters` north. */
const north = (p: OraclePosition, meters: number): OraclePosition => ({
  lat: p.lat + meters / 111_195,
  lon: p.lon,
})

describe('findOffsetCandidates', () => {
  // Not on a minute boundary, so the click is interpolated mid-segment.
  const trueUtc = utc('2026-06-01T07:30:20Z')

  it('Vancouver-time photo on a camera set to −08:00 → offset −07:00, drift 0', () => {
    const [best, ...rest] = findOffsetCandidates(
      synthetic,
      clickAt(synthetic, trueUtc),
      wall(trueUtc, -7 * H),
      -8 * H,
      LIMITS,
    )
    expect(rest).toEqual([])
    expect(best.offset).toBe('-07:00')
    expect(best.offsetSeconds).toBe(-7 * H)
    expect(Math.abs(best.driftSeconds as number)).toBeLessThanOrEqual(1)
    expect(Math.abs(best.trackUtc - trueUtc)).toBeLessThanOrEqual(1)
    expect(best.stationary).toBeNull()
  })

  it('the same camera 73 s fast → offset −07:00, drift +73', () => {
    const [best] = findOffsetCandidates(
      synthetic,
      clickAt(synthetic, trueUtc),
      wall(trueUtc, -7 * H, 73),
      -8 * H,
      LIMITS,
    )
    expect(best.offset).toBe('-07:00')
    expect(Math.abs((best.driftSeconds as number) - 73)).toBeLessThanOrEqual(1)
  })

  it('a click > 150 m from the track gives no suggestion', () => {
    const click = north(clickAt(synthetic, trueUtc), 160)
    expect(findOffsetCandidates(synthetic, click, wall(trueUtc, 2 * H), 2 * H, LIMITS)).toEqual([])
    // …while 140 m still finds it.
    const near = north(clickAt(synthetic, trueUtc), 140)
    expect(findOffsetCandidates(synthetic, near, wall(trueUtc, 2 * H), 2 * H, LIMITS)).toHaveLength(
      1,
    )
  })

  it('a track crossing the click twice lists both, nearest the current setting first', () => {
    // East for an hour, then back west along the same line.
    const t0 = utc('2026-06-01T06:00:00Z')
    const track: OraclePoint[] = []
    for (let i = 0; i <= 60; i++) track.push({ t: t0 + i * 60, lat: 46.5, lon: 7.9 + i * 3e-4 })
    for (let i = 1; i <= 60; i++)
      track.push({ t: t0 + (60 + i) * 60, lat: 46.5, lon: 7.9 + (60 - i) * 3e-4 })
    const outbound = t0 + 15 * 60 + 20
    const click = clickAt(track, outbound) // the return pass crosses it at t0 + 105 min − 20 s
    const w = wall(outbound, 2 * H)

    const nearFirst = findOffsetCandidates(track, click, w, 2 * H, LIMITS)
    expect(nearFirst).toHaveLength(2)
    expect(Math.abs(nearFirst[0].trackUtc - outbound)).toBeLessThanOrEqual(1)
    expect(nearFirst[0].offset).toBe('+02:00')
    expect(Math.abs(nearFirst[1].trackUtc - (t0 + 105 * 60 - 20))).toBeLessThanOrEqual(1)

    // With the camera currently set an hour and a half earlier, the return pass ranks first.
    const nearSecond = findOffsetCandidates(track, click, w, 2 * H - 90 * 60, LIMITS)
    expect(nearSecond.map((c) => c.trackUtc)).toEqual([
      nearFirst[1].trackUtc,
      nearFirst[0].trackUtc,
    ])
  })

  it('a click on the straight line across a long travel gap gives no candidate from the gap', () => {
    const gapStart = synthetic.findIndex(
      (p, i) => synthetic[i + 1] && synthetic[i + 1].t - p.t > 6 * H,
    )
    const a = synthetic[gapStart]
    const b = synthetic[gapStart + 1]
    expect(distanceMeters(a, b)).toBeGreaterThan(20_000)
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }
    const w = wall((a.t + b.t) / 2, 2 * H)
    expect(findOffsetCandidates(synthetic, mid, w, 2 * H, LIMITS)).toEqual([])
    // Raising the limit past the gap would make it eligible: proof the gap is what's excluded.
    expect(
      findOffsetCandidates(synthetic, mid, w, 2 * H, { geoMaxIntSecs: b.t - a.t }).length,
    ).toBe(1)
  })

  it('never derives a time from inside the stationary gap', () => {
    const gapStart = synthetic.findIndex(
      (p, i) =>
        synthetic[i + 1] && synthetic[i + 1].t - p.t > 1800 && synthetic[i + 1].t - p.t < 6 * H,
    )
    const a = synthetic[gapStart]
    const b = synthetic[gapStart + 1]
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }
    const candidates = findOffsetCandidates(
      synthetic,
      mid,
      wall((a.t + b.t) / 2, 2 * H),
      2 * H,
      LIMITS,
    )
    for (const c of candidates) expect(c.trackUtc <= a.t || c.trackUtc >= b.t).toBe(true)
  })

  it('a click at a stationary window → offset only, no drift, with the window’s time range', () => {
    // Drive in fast, stand still 30 min (sub-metre GPS jitter), drive away fast.
    const t0 = utc('2026-06-01T06:00:00Z')
    const stay = { lat: 46.6, lon: 8.0 }
    const track: OraclePoint[] = []
    for (let i = -10; i < 0; i++)
      track.push({ t: t0 + i * 60, lat: stay.lat + i * 0.005, lon: stay.lon })
    for (let i = 0; i <= 30; i++) {
      track.push({ t: t0 + i * 60, lat: stay.lat + (i % 2) * 3e-6, lon: stay.lon + (i % 3) * 3e-6 })
    }
    for (let i = 1; i <= 10; i++)
      track.push({ t: t0 + (30 + i) * 60, lat: stay.lat, lon: stay.lon + i * 0.007 })
    const photoUtc = t0 + 12 * 60
    const [best, ...rest] = findOffsetCandidates(
      track,
      clickAt(track, photoUtc),
      wall(photoUtc, -7 * H, 73),
      -8 * H,
      LIMITS,
    )
    expect(rest).toEqual([])
    expect(best.offset).toBe('-07:00')
    expect(best.driftSeconds).toBeNull()
    expect(best.stationary).not.toBeNull()
    expect(best.stationary?.from).toBeLessThanOrEqual(t0)
    expect(best.stationary?.to).toBeGreaterThanOrEqual(t0 + 30 * 60)
  })
})
