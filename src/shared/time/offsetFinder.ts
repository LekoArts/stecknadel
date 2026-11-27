import type { Temporal } from 'temporal-polyfill'
import { formatOffset, wallAsUtcSeconds } from './exifDate'

export interface FinderPoint {
  /** Unix seconds (UTC). */
  t: number
  lat: number
  lon: number
}

export interface FinderOptions {
  /** Only point pairs at most this far apart in time are used (the pairs ExifTool interpolates). */
  geoMaxIntSecs: number
  /** Max distance from the click to the track. */
  radiusMeters?: number
  /**
   * "Stationary": the track stays within `stationaryMeters` of the matched point for longer than
   * `stationarySecs`, so the click has no unique time.
   */
  stationaryMeters?: number
  stationarySecs?: number
}

export interface OffsetCandidate {
  /** The track time at the click (Unix seconds); for stationary windows, the closest projection. */
  trackUtc: number
  /** Distance from the click to the track, meters. */
  distanceMeters: number
  /** Correction C = wall time read as UTC − track time, seconds. */
  correctionSeconds: number
  /** C rounded to the nearest 15 min. */
  offsetSeconds: number
  /** `±HH:MM` of `offsetSeconds`. */
  offset: string
  /** C − offset (camera fast = positive); null for a stationary window. */
  driftSeconds: number | null
  /** Set when the window is stationary: the time range the photo could be from. */
  stationary: { from: number; to: number } | null
}

const RADIUS = 150
const STATIONARY = 20
const STATIONARY_SECS = 120
const QUARTER_HOUR = 900
const EARTH = 6_371_008.8
const RAD = Math.PI / 180

interface Hit {
  segment: number
  t: number
  d: number
  /** The projected point, in the click-centred plane. */
  x: number
  y: number
}

/**
 * Map-click offset finder (inverse direction: position → time, for a suggestion only).
 * Projects the click onto every eligible track segment within the radius, groups consecutive hit
 * segments into windows (each keeps its closest projection), and turns each window into a
 * suggested offset (rounded to 15 min) plus residual drift. Ordered by closeness to
 * `currentCorrectionSeconds` (the camera's present setting for this photo), nearest first.
 */
export function findOffsetCandidates(
  track: FinderPoint[],
  click: { lat: number; lon: number },
  wall: Temporal.PlainDateTime,
  currentCorrectionSeconds: number,
  options: FinderOptions,
): OffsetCandidate[] {
  const radius = options.radiusMeters ?? RADIUS
  const stationaryLimit = options.stationaryMeters ?? STATIONARY
  const stationarySecs = options.stationarySecs ?? STATIONARY_SECS
  const cosLat = Math.cos(click.lat * RAD)
  // Local equirectangular plane around the click, meters; fine at 150 m scale. Longitude
  // differences wrap to ±180°, so a segment across the antimeridian stays short.
  const wrap = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180
  const xy = (p: { lat: number; lon: number }): [number, number] => [
    wrap(p.lon - click.lon) * RAD * EARTH * cosLat,
    (p.lat - click.lat) * RAD * EARTH,
  ]

  const hits: Hit[] = []
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i]
    const b = track[i + 1]
    const [ax, ay] = xy(a)
    const [, by] = xy(b)
    const dx = wrap(b.lon - a.lon) * RAD * EARTH * cosLat
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const dt = b.t - a.t
    if (dt <= 0 || dt > options.geoMaxIntSecs) continue
    const f = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2))
    const d = Math.hypot(ax + f * dx, ay + f * dy)
    if (d <= radius) hits.push({ segment: i, t: a.t + f * dt, d, x: ax + f * dx, y: ay + f * dy })
  }

  const windows: Hit[][] = []
  for (const hit of hits) {
    const last = windows[windows.length - 1]
    if (last && last[last.length - 1].segment === hit.segment - 1) last.push(hit)
    else windows.push([hit])
  }

  const wallUtc = wallAsUtcSeconds(wall)
  const candidates = windows.map((window): OffsetCandidate => {
    const best = window.reduce((x, y) => (y.d < x.d ? y : x))
    // How long the track lingers near the matched point, walking out over eligible pairs.
    const near = (k: number): boolean => {
      const [x, y] = xy(track[k])
      return Math.hypot(x - best.x, y - best.y) <= stationaryLimit
    }
    const eligible = (k: number): boolean =>
      track[k + 1].t - track[k].t > 0 && track[k + 1].t - track[k].t <= options.geoMaxIntSecs
    let first = best.segment + 1
    for (let k = best.segment; k >= 0 && near(k) && eligible(k); k--) first = k
    let last = best.segment
    for (let k = best.segment + 1; k < track.length && near(k) && eligible(k - 1); k++) last = k
    const from = Math.min(best.t, first <= best.segment ? track[first].t : best.t)
    const to = Math.max(best.t, last > best.segment ? track[last].t : best.t)
    const stationary = to - from > stationarySecs ? { from, to } : null
    const correction = wallUtc - best.t
    const offsetSeconds = stationary
      ? (stationaryOffset(wallUtc, stationary, currentCorrectionSeconds) ??
        Math.round(correction / QUARTER_HOUR) * QUARTER_HOUR)
      : Math.round(correction / QUARTER_HOUR) * QUARTER_HOUR
    return {
      trackUtc: best.t,
      distanceMeters: best.d,
      correctionSeconds: correction,
      offsetSeconds,
      offset: formatOffset(offsetSeconds),
      driftSeconds: stationary ? null : correction - offsetSeconds,
      stationary,
    }
  })
  return candidates.sort(
    (a, b) =>
      Math.abs(a.correctionSeconds - currentCorrectionSeconds) -
      Math.abs(b.correctionSeconds - currentCorrectionSeconds),
  )
}

/**
 * A stationary window fits several quarter-hour offsets (any with `wall − offset` inside it).
 * Prefer whole hours, then half hours, then the one closest to the current setting.
 */
function stationaryOffset(
  wallUtc: number,
  window: { from: number; to: number },
  currentCorrectionSeconds: number,
): number | null {
  const lo = Math.ceil((wallUtc - window.to) / QUARTER_HOUR)
  const hi = Math.floor((wallUtc - window.from) / QUARTER_HOUR)
  const fits: number[] = []
  for (let k = lo; k <= hi; k++) fits.push(k * QUARTER_HOUR)
  if (fits.length === 0) return null
  const rank = (o: number): number => (o % 3600 === 0 ? 0 : o % 1800 === 0 ? 1 : 2)
  return fits.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Math.abs(a - currentCorrectionSeconds) - Math.abs(b - currentCorrectionSeconds),
  )[0]
}
