import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TrackPoint } from '@shared/track/types'
import type { ExifTool } from 'exiftool-vendored'
import { Temporal } from 'temporal-polyfill'
import { runRaw } from '../exiftool-raw'

/** Points closer than this (degrees) share one lookup: ~10 km, far below zone-border accuracy needs. */
const CELL = 0.1

const stub = (lat: number, lon: number): string =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="${Math.abs(lat).toFixed(4)},0${lat < 0 ? 'S' : 'N'}" exif:GPSLongitude="${Math.abs(lon).toFixed(4)},0${lon < 0 ? 'W' : 'E'}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`

const isZone = (id: unknown): id is string => {
  if (typeof id !== 'string') return false
  try {
    Temporal.Now.instant().toZonedDateTimeISO(id)
    return true
  } catch {
    return false
  }
}

/**
 * The IANA zone at each track point, from ExifTool's geolocation database (nearest city), in one
 * ExifTool run over a stub per ~10 km cell. Null where no valid zone came back.
 */
export async function trackZones(et: ExifTool, points: TrackPoint[]): Promise<(string | null)[]> {
  const cellOf = points.map((p) => `${Math.round(p.lat / CELL)},${Math.round(p.lon / CELL)}`)
  const cells = [...new Set(cellOf)]
  if (cells.length === 0) return []
  const dir = await mkdtemp(join(tmpdir(), 'stecknadel-zones-'))
  try {
    await Promise.all(
      cells.map((cell, i) => {
        const [lat, lon] = cell.split(',').map((n) => Number(n) * CELL)
        return writeFile(join(dir, `${i}.xmp`), stub(lat, lon))
      }),
    )
    const { stdout } = await runRaw(et, [
      '-json',
      '-api',
      'geolocation',
      '-GeolocationTimeZone',
      '-ext',
      'xmp',
      dir,
    ])
    const zoneOfCell = new Map<string, string>()
    for (const row of JSON.parse(stdout) as {
      SourceFile: string
      GeolocationTimeZone?: unknown
    }[]) {
      const index = Number(/(\d+)\.xmp$/.exec(row.SourceFile)?.[1])
      if (Number.isInteger(index) && isZone(row.GeolocationTimeZone)) {
        zoneOfCell.set(cells[index], row.GeolocationTimeZone)
      }
    }
    return cellOf.map((cell) => zoneOfCell.get(cell) ?? null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
