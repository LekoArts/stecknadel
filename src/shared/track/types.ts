export interface TrackPoint {
  /** Unix seconds (UTC). */
  t: number
  lat: number
  lon: number
  ele?: number
}

export type TrackSource =
  | { kind: 'gpx'; fileName: string }
  | { kind: 'dawarich'; start: string; end: string }

export interface DroppedCounts {
  /** Non-finite coordinates, |lat| > 90 or |lon| > 180. */
  invalid: number
  /** Same timestamp as an earlier point (the first one is kept). */
  duplicate: number
  /** GPX points without a usable `<time>`. */
  noTime: number
  /** Dawarich points flagged `anomaly: true`. */
  anomaly: number
}

export interface Track {
  /** Sorted by `t`, unique `t`. */
  points: TrackPoint[]
  source: TrackSource
  dropped: DroppedCounts
}

/** What the renderer is told about the loaded track. */
export interface TrackSummary {
  source: TrackSource
  count: number
  /** ISO 8601 UTC of the first and last point, null for an empty track. */
  first: string | null
  last: string | null
  dropped: DroppedCounts
}

export const emptyDropped = (): DroppedCounts => ({
  invalid: 0,
  duplicate: 0,
  noTime: 0,
  anomaly: 0,
})

const validPoint = (p: TrackPoint): boolean =>
  Number.isFinite(p.t) &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180

/**
 * One time-ordered series: segments and tracks are flattened (a long gap stays a gap — ExifTool
 * and the bridging rules decide by time and distance, not by segment), invalid coordinates are
 * dropped, and of several points with the same timestamp the first one in input order is kept.
 */
export function normalizeTrack(
  raw: TrackPoint[],
  source: TrackSource,
  dropped: DroppedCounts = emptyDropped(),
): Track {
  const counts = { ...dropped }
  const valid: TrackPoint[] = []
  for (const p of raw) {
    if (!validPoint(p)) {
      counts.invalid += 1
      continue
    }
    const point: TrackPoint = { t: p.t, lat: p.lat, lon: p.lon }
    if (p.ele !== undefined && Number.isFinite(p.ele)) point.ele = p.ele
    valid.push(point)
  }
  // Array.prototype.sort is stable, so equal timestamps stay in input order.
  valid.sort((a, b) => a.t - b.t)
  const points: TrackPoint[] = []
  for (const p of valid) {
    if (points.length > 0 && points[points.length - 1].t === p.t) counts.duplicate += 1
    else points.push(p)
  }
  return { points, source, dropped: counts }
}

const iso = (t: number): string => new Date(t * 1000).toISOString().replace('.000Z', 'Z')

export function summarizeTrack(track: Track): TrackSummary {
  const { points } = track
  return {
    source: track.source,
    count: points.length,
    first: points.length > 0 ? iso(points[0].t) : null,
    last: points.length > 0 ? iso(points[points.length - 1].t) : null,
    dropped: track.dropped,
  }
}
