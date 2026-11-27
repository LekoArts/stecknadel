/** 26 h covers every UTC offset from −12:00 to +14:00. */
export const OFFSET_MARGIN_SECS = 26 * 3600
export const DEFAULT_GEO_MAX_EXT_SECS = 1800

export interface FetchRange {
  /** ISO 8601 UTC. */
  start: string
  end: string
}

const WALL_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/

/** A camera wall time (`YYYY:MM:DD HH:MM:SS`) read as if it were UTC, in Unix seconds. */
export function wallTimeAsUtc(wallTime: string): number | null {
  const m = WALL_TIME.exec(wallTime)
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(ms) ? ms / 1000 : null
}

const iso = (t: number): string => new Date(t * 1000).toISOString().replace('.000Z', 'Z')

/**
 * The Dawarich fetch range for the loaded photos, from their raw wall times — before any time
 * zone is known: `[min − 26 h − GeoMaxExtSecs, max + 26 h + GeoMaxExtSecs]`. Null without photos
 * that have a capture time.
 */
export function defaultFetchRange(
  wallTimes: (string | null)[],
  geoMaxExtSecs = DEFAULT_GEO_MAX_EXT_SECS,
): FetchRange | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const wall of wallTimes) {
    const t = wall ? wallTimeAsUtc(wall) : null
    if (t === null) continue
    if (t < min) min = t
    if (t > max) max = t
  }
  if (!Number.isFinite(min)) return null
  const margin = OFFSET_MARGIN_SECS + geoMaxExtSecs
  return { start: iso(min - margin), end: iso(max + margin) }
}

/**
 * Whether a photo's computed UTC can't be judged against the fetched track: the track could have
 * fixes within GeoMaxExtSecs of it that weren't fetched. Such photos are `outside-fetched-range`,
 * never `before-track`/`after-track`.
 */
export function isOutsideFetchedRange(
  utc: number,
  range: FetchRange,
  geoMaxExtSecs = DEFAULT_GEO_MAX_EXT_SECS,
): boolean {
  const start = Date.parse(range.start) / 1000
  const end = Date.parse(range.end) / 1000
  return utc - geoMaxExtSecs < start || utc + geoMaxExtSecs > end
}
