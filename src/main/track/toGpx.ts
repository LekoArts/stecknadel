import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TrackPoint } from '@shared/track/types'

function isoTime(t: number): string {
  const ms = Math.round(t * 1000)
  const s = new Date(ms).toISOString()
  return ms % 1000 === 0 ? s.replace('.000Z', 'Z') : s
}

/** A GPX 1.1 document with one track segment, for `exiftool -geotag`. */
export function toGpx(points: TrackPoint[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Stecknadel" xmlns="http://www.topografix.com/GPX/1/1">',
    '<trk><trkseg>',
  ]
  for (const p of points) {
    const ele = p.ele === undefined ? '' : `<ele>${Math.round(p.ele * 100) / 100}</ele>`
    // Fixed notation: String(1e-7) would be exponent notation.
    lines.push(
      `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${ele}<time>${isoTime(p.t)}</time></trkpt>`,
    )
  }
  lines.push('</trkseg></trk>', '</gpx>', '')
  return lines.join('\n')
}

/** Writes the points to `track.gpx` in a fresh temp directory and returns its path. */
export async function writeTempGpx(points: TrackPoint[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stecknadel-track-'))
  const file = join(dir, 'track.gpx')
  await writeFile(file, toGpx(points))
  return file
}
