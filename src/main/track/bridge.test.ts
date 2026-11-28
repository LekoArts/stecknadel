import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEG_TOLERANCE, expectedStay } from '@oracle/expected'
import { haversineMeters } from '@shared/geo'
import { DEFAULT_BRIDGE } from '@shared/match/status'
import type { TrackPoint } from '@shared/track/types'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { geotagStubs } from '../preview'
import { bridgeTrack } from './bridge'
import { toGpx } from './toGpx'

const geotime = (t: number): string =>
  `${new Date(t * 1000).toISOString().slice(0, 19).replaceAll('-', ':').replace('T', ' ')}Z`

const T0 = Date.UTC(2026, 10, 3, 18, 0) / 1000
// About 52 m apart (0.000468° of latitude).
const STAY_A = { lat: 37.34, lon: -121.89, ele: 10 }
const STAY_B = { lat: 37.340468, lon: -121.89, ele: 12 }

/** A few fixes a minute apart, a gap, then a few more. */
function withGap(gapSecs: number, a = STAY_A, b = STAY_B): TrackPoint[] {
  const before = [0, 60, 120].map((d) => ({ ...a, t: T0 + d }))
  const end = T0 + 120 + gapSecs
  const after = [0, 60, 120].map((d) => ({ ...b, t: end + d }))
  return [...before, ...after]
}

describe('bridgeTrack', () => {
  it('bridges a 237 min gap whose ends are 52 m apart', () => {
    const points = withGap(237 * 60)
    expect(Math.round(haversineMeters(points[2], points[3]))).toBe(52)
    const { points: out, intervals } = bridgeTrack(points, 1800, DEFAULT_BRIDGE)
    expect(intervals).toEqual([{ from: points[2].t, to: points[3].t }])
    const fillers = out.slice(3, -3)
    expect(fillers.length).toBeGreaterThan(0)
    const mid = points[2].t + (237 * 60) / 2
    for (const f of fillers) {
      // Only copies of the real end fixes, never a new coordinate.
      const end = f.t <= mid ? points[2] : points[3]
      expect({ lat: f.lat, lon: f.lon, ele: f.ele }).toEqual({
        lat: end.lat,
        lon: end.lon,
        ele: end.ele,
      })
    }
    // Every consecutive pair is now within GeoMaxIntSecs.
    for (let i = 1; i < out.length; i++) expect(out[i].t - out[i - 1].t).toBeLessThanOrEqual(1800)
    expect(out.map((p) => p.t)).toEqual([...out.map((p) => p.t)].sort((x, y) => x - y))
  })

  it('does not bridge the 697 min flight gap', () => {
    const points = withGap(
      697 * 60,
      { lat: 52.2, lon: 7.0, ele: 40 },
      { lat: 37.15, lon: -121.89, ele: 3 },
    )
    expect(haversineMeters(points[2], points[3])).toBeGreaterThan(1_000_000)
    expect(bridgeTrack(points, 1800, DEFAULT_BRIDGE)).toEqual({ points, intervals: [] })
  })

  it('does not bridge a 30 h stationary gap', () => {
    const points = withGap(30 * 3600)
    expect(bridgeTrack(points, 1800, DEFAULT_BRIDGE)).toEqual({ points, intervals: [] })
  })

  it('does nothing when bridging is off', () => {
    const points = withGap(237 * 60)
    expect(bridgeTrack(points, 1800, { ...DEFAULT_BRIDGE, enabled: false })).toEqual({
      points,
      intervals: [],
    })
  })

  it.each([
    [1800, 900],
    [60, 30],
  ])('spaces fillers at GeoMaxIntSecs=%i every %i s', (limit, step) => {
    const points = withGap(237 * 60)
    const out = bridgeTrack(points, limit, DEFAULT_BRIDGE).points
    const a = points[2].t
    const b = points[3].t
    const mid = a + (b - a) / 2
    const first = out.filter((p) => p.t > a && p.t <= mid).map((p) => p.t - a)
    const second = out.filter((p) => p.t > mid && p.t < b).map((p) => b - p.t)
    expect(first).toEqual(
      Array.from({ length: Math.floor((mid - a) / step) }, (_, i) => (i + 1) * step),
    )
    expect(second.sort((x, y) => x - y)).toEqual(
      Array.from({ length: Math.ceil((b - mid) / step) - 1 }, (_, i) => (i + 1) * step),
    )
  })

  it('at GeoMaxIntSecs=604800 no gap qualifies (max gap is 72 h), ExifTool interpolates itself', () => {
    const points = withGap(237 * 60)
    expect(bridgeTrack(points, 604_800, { ...DEFAULT_BRIDGE, maxGapHours: 72 })).toEqual({
      points,
      intervals: [],
    })
  })
})

describe('bridged gaps with real ExifTool', () => {
  let et: ExifTool
  let dir: string
  beforeAll(async () => {
    et = new ExifTool({ maxProcs: 1 })
    dir = await mkdtemp(join(tmpdir(), 'steck-bridge-'))
  })
  afterAll(async () => {
    await et.end()
    await rm(dir, { recursive: true, force: true })
  })

  it.each([1800, 60, 604_800])(
    'a photo inside the gap is matched at GeoMaxIntSecs=%i',
    async (limit) => {
      const points = withGap(237 * 60)
      const { points: bridged } = bridgeTrack(points, limit, DEFAULT_BRIDGE)
      const gpx = join(dir, `track-${limit}.gpx`)
      await writeFile(gpx, toGpx(bridged))
      const limits = { geoMaxIntSecs: limit, geoMaxExtSecs: 1800 }
      const cases = [points[2].t + 3600, points[2].t + 118.5 * 60, points[3].t - 3600]
      const rows = cases.map((t, i) => ({
        id: `p${String(i).padStart(24, '0')}`,
        geotime: geotime(t),
      }))
      const result = await geotagStubs(et, rows, gpx, limits)
      rows.forEach((row, i) => {
        const got = result.get(row.id)
        expect(got, row.geotime).not.toBeNull()
        const want = expectedStay(points, cases[i], limits, {
          radiusMeters: DEFAULT_BRIDGE.radiusMeters,
          maxGapSecs: DEFAULT_BRIDGE.maxGapHours * 3600,
        })
        expect(want).not.toBeNull()
        expect(Math.abs(Number(got?.lat) - (want?.lat as number))).toBeLessThan(DEG_TOLERANCE)
        expect(Math.abs(Number(got?.lon) - (want?.lon as number))).toBeLessThan(DEG_TOLERANCE)
      })
    },
  )

  it('without bridging the same mid-gap photo is not matched', async () => {
    const points = withGap(237 * 60)
    const gpx = join(dir, 'plain.gpx')
    await writeFile(gpx, toGpx(points))
    const t = points[2].t + 118.5 * 60
    const id = `p${'1'.repeat(24)}`
    const result = await geotagStubs(et, [{ id, geotime: geotime(t) }], gpx, {
      geoMaxIntSecs: 1800,
      geoMaxExtSecs: 1800,
    })
    expect(result.get(id)).toBeNull()
  })
})
