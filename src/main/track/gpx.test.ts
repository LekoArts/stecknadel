import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GpxError, parseGpx } from './gpx'
import { toGpx } from './toGpx'

const gpx11 = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`

const trkpt = (lat: number | string, lon: number | string, time?: string, ele?: number): string =>
  `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}${
    time ? `<time>${time}</time>` : ''
  }</trkpt>`

const seg = (...pts: string[]): string => `<trkseg>${pts.join('')}</trkseg>`

describe('parseGpx', () => {
  it('reads track points with elevation and time', () => {
    const track = parseGpx(
      gpx11(`<trk>${seg(trkpt(47.1, 8.2, '2026-06-01T06:00:00Z', 512.5))}</trk>`),
      'a.gpx',
    )
    expect(track.points).toEqual([
      { t: Date.UTC(2026, 5, 1, 6) / 1000, lat: 47.1, lon: 8.2, ele: 512.5 },
    ])
    expect(track.source).toEqual({ kind: 'gpx', fileName: 'a.gpx' })
  })

  it('reads waypoint-only files', () => {
    const track = parseGpx(
      gpx11(
        '<wpt lat="47" lon="8"><time>2026-06-01T06:00:00Z</time></wpt><wpt lat="47.5" lon="8.5"><time>2026-06-01T07:00:00Z</time></wpt>',
      ),
      'w.gpx',
    )
    expect(track.points.map((p) => p.lat)).toEqual([47, 47.5])
  })

  it('merges track points and waypoints by time, ignoring routes', () => {
    const track = parseGpx(
      gpx11(
        `<wpt lat="1" lon="1"><time>2026-06-01T06:30:00Z</time></wpt>
         <rte><rtept lat="9" lon="9"><time>2026-06-01T06:15:00Z</time></rtept></rte>
         <trk>${seg(trkpt(0, 0, '2026-06-01T06:00:00Z'), trkpt(2, 2, '2026-06-01T07:00:00Z'))}</trk>`,
      ),
      'm.gpx',
    )
    expect(track.points.map((p) => p.lat)).toEqual([0, 1, 2])
  })

  it('reads GPX 1.0', () => {
    const track = parseGpx(
      `<?xml version="1.0"?><gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0"><trk><trkseg>
        <trkpt lat="46.5" lon="7.5"><ele>1000</ele><time>2026-06-01T06:00:00Z</time><speed>1.2</speed></trkpt>
      </trkseg></trk></gpx>`,
      'old.gpx',
    )
    expect(track.points).toEqual([
      { t: Date.UTC(2026, 5, 1, 6) / 1000, lat: 46.5, lon: 7.5, ele: 1000 },
    ])
  })

  it('drops and counts points without a time', () => {
    const track = parseGpx(
      gpx11(
        `<trk>${seg(trkpt(1, 1), trkpt(2, 2, ''), trkpt(3, 3, 'yesterday'), trkpt(4, 4, '2026-06-01T06:00:00Z'))}</trk>`,
      ),
      't.gpx',
    )
    expect(track.points.map((p) => p.lat)).toEqual([4])
    expect(track.dropped.noTime).toBe(3)
  })

  it('reads zone-less and offset times as their UTC instant', () => {
    const track = parseGpx(
      gpx11(
        `<trk>${seg(trkpt(1, 1, '2026-06-01T06:00:00'), trkpt(2, 2, '2026-06-01T09:00:01+02:00'), trkpt(3, 3, '2026-06-01T07:00:02.500Z'))}</trk>`,
      ),
      'z.gpx',
    )
    const base = Date.UTC(2026, 5, 1, 6) / 1000
    expect(track.points.map((p) => p.t)).toEqual([base, base + 3601, base + 3602.5])
  })

  it('keeps the first of several points with the same time', () => {
    const track = parseGpx(
      gpx11(
        `<trk>${seg(trkpt(1, 1, '2026-06-01T06:00:00Z'), trkpt(2, 2, '2026-06-01T06:00:00Z'), trkpt(3, 3, '2026-06-01T06:00:01Z'))}</trk>`,
      ),
      'd.gpx',
    )
    expect(track.points.map((p) => p.lat)).toEqual([1, 3])
    expect(track.dropped.duplicate).toBe(1)
  })

  it('drops and counts invalid coordinates, including empty attributes', () => {
    const t = '2026-06-01T06:00:0'
    const track = parseGpx(
      gpx11(
        `<trk>${seg(
          trkpt(91, 0, `${t}0Z`),
          trkpt(0, -180.5, `${t}1Z`),
          trkpt('', '', `${t}2Z`),
          trkpt('abc', 1, `${t}3Z`),
          '<trkpt><time>2026-06-01T06:00:04Z</time></trkpt>',
          trkpt(-90, 180, `${t}5Z`),
        )}</trk>`,
      ),
      'i.gpx',
    )
    expect(track.points).toEqual([{ t: Date.UTC(2026, 5, 1, 6, 0, 5) / 1000, lat: -90, lon: 180 }])
    expect(track.dropped.invalid).toBe(5)
  })

  it('flattens several tracks and segments into one time-ordered series', () => {
    const track = parseGpx(
      gpx11(
        `<trk>${seg(trkpt(3, 3, '2026-06-02T08:00:00Z'))}${seg(trkpt(1, 1, '2026-06-01T06:00:00Z'))}</trk>
         <trk>${seg(trkpt(2, 2, '2026-06-01T13:00:00Z'))}</trk>`,
      ),
      'f.gpx',
    )
    expect(track.points.map((p) => p.lat)).toEqual([1, 2, 3])
  })

  it('rejects malformed XML and non-GPX documents', () => {
    expect(() => parseGpx('<gpx><trk>', 'x.gpx')).toThrow(GpxError)
    expect(() => parseGpx('<kml></kml>', 'x.gpx')).toThrow(/no <gpx>/)
  })

  it('does not expand entities', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x "1">]><gpx version="1.1"><trk>${seg(trkpt('&x;', 1, '2026-06-01T06:00:00Z'))}</trk></gpx>`
    expect(() => parseGpx(xml, 'e.gpx').points).not.toThrow()
    expect(parseGpx(xml, 'e.gpx').points).toEqual([])
  })

  it('parses the synthetic trip fixture', async () => {
    const xml = await readFile(join(__dirname, '../../../test/fixtures/synthetic-trip.gpx'), 'utf8')
    const track = parseGpx(xml, 'synthetic-trip.gpx')
    expect(track.points).toHaveLength(663)
    expect(track.dropped).toEqual({ invalid: 0, duplicate: 0, noTime: 0, anomaly: 0 })
    expect(new Date(track.points[0].t * 1000).toISOString()).toBe('2026-06-01T06:00:00.000Z')
    expect(track.points.every((p) => p.ele !== undefined)).toBe(true)
  })
})

describe('toGpx', () => {
  it('round-trips through parseGpx', async () => {
    const xml = await readFile(join(__dirname, '../../../test/fixtures/synthetic-trip.gpx'), 'utf8')
    const track = parseGpx(xml, 'synthetic-trip.gpx')
    const again = parseGpx(toGpx(track.points), 'tmp.gpx')
    expect(again.points).toHaveLength(track.points.length)
    for (const [i, p] of again.points.entries()) {
      expect(p.t).toBe(track.points[i].t)
      expect(p.lat).toBeCloseTo(track.points[i].lat, 7)
      expect(p.lon).toBeCloseTo(track.points[i].lon, 7)
    }
  })

  it('writes small coordinates in fixed notation and keeps sub-second times', () => {
    const xml = toGpx([{ t: 1.5, lat: 1e-8, lon: -0.0000001 }])
    expect(xml).toContain('lat="0.0000000" lon="-0.0000001"')
    expect(xml).toContain('<time>1970-01-01T00:00:01.500Z</time>')
    expect(xml).not.toContain('<ele>')
  })
})
