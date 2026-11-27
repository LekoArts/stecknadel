import { Temporal } from 'temporal-polyfill'
import type { CameraTimeSettings, Segment } from './cameraSettings'
import { parseExifDateTime, parseOffset } from './exifDate'

/** The track with the IANA zone at each point (null where ExifTool found none). */
export interface ZonedTrack {
  /** `[t, lat, lon]` per point, sorted by t. */
  points: [number, number, number][]
  zones: (string | null)[]
}

export interface DetectInput {
  captureTime: string | null
  offsetTimeOriginal: string | null
}

/** Within this of a point, its zone is the zone there; across longer gaps both ends must agree. */
const NEAR_SECS = 3 * 3600

/** The zone where the track was at `t`, or null when the track can't tell. */
export function zoneAt(track: ZonedTrack, t: number): string | null {
  const { points, zones } = track
  if (points.length === 0) return null
  let lo = 0
  let hi = points.length - 1
  if (t <= points[0][0]) return points[0][0] - t <= NEAR_SECS ? zones[0] : null
  if (t >= points[hi][0]) return t - points[hi][0] <= NEAR_SECS ? zones[hi] : null
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid][0] <= t) lo = mid
    else hi = mid
  }
  if (zones[lo] === zones[hi]) return zones[lo]
  const nearer = t - points[lo][0] <= points[hi][0] - t ? lo : hi
  return Math.abs(points[nearer][0] - t) <= NEAR_SECS ? zones[nearer] : null
}

const offsetNs = (zone: string, epochNs: bigint): number =>
  Temporal.Instant.fromEpochNanoseconds(epochNs).toZonedDateTimeISO(zone).offsetNanoseconds

/**
 * Camera time settings that put every photo where the track was at the time: the clock is assumed
 * to have shown local time. A zone holds as long as the track agrees on the UTC offset; when it
 * stops agreeing, a time change starts at that photo. Photos with a recorded offset (when used)
 * and photos the track can't place are skipped. Null when no photo could be placed.
 */
export function detectCameraSettings(
  photos: DetectInput[],
  track: ZonedTrack,
  useRecordedOffsets: boolean,
): CameraTimeSettings | null {
  const candidates = [...new Set(track.zones.filter((z): z is string => z !== null))]
  if (candidates.length === 0) return null

  const walls: Temporal.PlainDateTime[] = []
  for (const p of photos) {
    if (useRecordedOffsets && p.offsetTimeOriginal && parseOffset(p.offsetTimeOriginal) !== null) {
      continue
    }
    const wall = p.captureTime ? parseExifDateTime(p.captureTime) : null
    if (wall) walls.push(wall)
  }
  walls.sort(Temporal.PlainDateTime.compare)

  // Per photo: the candidate zones whose reading of the wall time lands where that zone's offset
  // is in force, and the zone actually there (preferred when several fit).
  const fits: { wall: Temporal.PlainDateTime; zones: Set<string>; here: string | null }[] = []
  for (const wall of walls) {
    const zones = new Set<string>()
    let here: string | null = null
    for (const zone of candidates) {
      const instant = wall.toZonedDateTime(zone, { disambiguation: 'compatible' }).toInstant()
      const local = zoneAt(track, Number(instant.epochNanoseconds / 1_000_000_000n))
      if (!local) continue
      if (offsetNs(local, instant.epochNanoseconds) === offsetNs(zone, instant.epochNanoseconds)) {
        zones.add(zone)
        if (local === zone) here = zone
      }
    }
    if (zones.size > 0) fits.push({ wall, zones, here })
  }
  if (fits.length === 0) return null

  // How many photos in a row, from each one on, a zone keeps fitting.
  const run: Map<string, number>[] = new Array(fits.length)
  for (let i = fits.length - 1; i >= 0; i--) {
    const next = run[i + 1]
    run[i] = new Map(
      [...fits[i].zones].map((zone): [string, number] => [zone, 1 + (next?.get(zone) ?? 0)]),
    )
  }
  const best = (i: number): string => {
    let pick = ''
    let length = -1
    for (const [zone, n] of run[i]) {
      if (n > length || (n === length && zone === fits[i].here)) {
        pick = zone
        length = n
      }
    }
    return pick
  }

  const segments: Segment[] = [{ tz: { kind: 'zone', id: best(0) }, driftSeconds: 0 }]
  let current = segments[0].tz.kind === 'zone' ? segments[0].tz.id : ''
  for (let i = 1; i < fits.length; i++) {
    if (fits[i].zones.has(current)) continue
    current = best(i)
    segments.push({
      startsAt: fits[i].wall.toString({ smallestUnit: 'second' }),
      tz: { kind: 'zone', id: current },
      driftSeconds: 0,
    })
  }
  return { useRecordedOffsets, segments, confirmed: true }
}
