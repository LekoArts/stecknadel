import { haversineMeters } from '@shared/geo'
import { type FetchRange, isOutsideFetchedRange } from '@shared/track/range'

export interface MatchLimits {
  geoMaxIntSecs: number
  geoMaxExtSecs: number
}

export interface BridgeRules {
  enabled: boolean
  radiusMeters: number
  maxGapHours: number
}

export const DEFAULT_LIMITS: MatchLimits = { geoMaxIntSecs: 1800, geoMaxExtSecs: 1800 }
export const DEFAULT_BRIDGE: BridgeRules = { enabled: true, radiusMeters: 250, maxGapHours: 24 }

/** A stationary gap that bridging filled, between two real fixes (Unix seconds). */
export interface BridgedInterval {
  from: number
  to: number
}

export type MatchStatus =
  | { kind: 'matched' }
  | { kind: 'matched-stay' }
  | { kind: 'manual' }
  | { kind: 'has-gps' }
  /** `seconds`: how long before the first fix. */
  | { kind: 'before-track'; seconds: number }
  /** `seconds`: how long after the last fix. */
  | { kind: 'after-track'; seconds: number }
  | { kind: 'in-gap'; gapMinutes: number; distanceMeters: number }
  | { kind: 'outside-fetched-range' }
  | { kind: 'no-capture-time' }
  | { kind: 'excluded'; reason: string }

export type MatchKind = MatchStatus['kind']

export const SIDECAR_COLLISION =
  'Another RAW in this folder has the same name, so they would share one .xmp sidecar'

/** Statuses that get coordinates written. */
export const PLACED_KINDS: ReadonlySet<MatchKind> = new Set(['matched', 'matched-stay', 'manual'])

export interface ClassifyPhoto {
  /** Computed UTC capture time (Unix seconds), null without a capture time. */
  utc: number | null
  readError: string | null
  hasGps: boolean
  /** A RAW sharing its base name with another RAW in the folder (one `.xmp` for both). */
  sidecarCollision: boolean
  manual: boolean
  /** Whether ExifTool's `-geotag` set a position for this photo. */
  exiftoolMatched: boolean
}

export interface ClassifyContext {
  points: { t: number; lat: number; lon: number }[]
  intervals: BridgedInterval[]
  limits: MatchLimits
  overwriteGps: boolean
  rawTarget: 'in-file' | 'sidecar'
  /** The Dawarich fetch range; null for GPX tracks (a file has no "outside"). */
  fetchedRange: FetchRange | null
}

/**
 * A photo's status. ExifTool alone decides matched vs not (`exiftoolMatched`); this only labels
 * which kind of match it was, or why there was none.
 */
export function classify(photo: ClassifyPhoto, ctx: ClassifyContext): MatchStatus {
  if (photo.readError) return { kind: 'excluded', reason: photo.readError }
  if (photo.sidecarCollision && ctx.rawTarget === 'sidecar')
    return { kind: 'excluded', reason: SIDECAR_COLLISION }
  if (photo.manual) return { kind: 'manual' }
  if (photo.hasGps && !ctx.overwriteGps) return { kind: 'has-gps' }
  if (photo.utc === null) return { kind: 'no-capture-time' }
  const utc = photo.utc
  if (photo.exiftoolMatched) {
    const stay = ctx.intervals.some((i) => utc > i.from && utc < i.to)
    return { kind: stay ? 'matched-stay' : 'matched' }
  }
  if (ctx.fetchedRange && isOutsideFetchedRange(utc, ctx.fetchedRange, ctx.limits.geoMaxExtSecs)) {
    return { kind: 'outside-fetched-range' }
  }
  const { points } = ctx
  if (points.length === 0 || utc < points[0].t) {
    return { kind: 'before-track', seconds: points.length ? points[0].t - utc : 0 }
  }
  const last = points[points.length - 1]
  if (utc > last.t) return { kind: 'after-track', seconds: utc - last.t }
  // Binary search for the pair around utc.
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= utc) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  return {
    kind: 'in-gap',
    gapMinutes: Math.round((b.t - a.t) / 60),
    distanceMeters: Math.round(haversineMeters(a, b)),
  }
}

const duration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 120) return `${minutes} min`
  const hours = Math.round(minutes / 6) / 10
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} days`
}

const distance = (meters: number): string =>
  meters < 1000
    ? `${meters} m`
    : meters < 100_000
      ? `${Math.round(meters / 100) / 10} km`
      : `${Math.round(meters / 1000)} km`

export const STATUS_LABELS: Record<MatchKind, string> = {
  matched: 'Matched',
  'matched-stay': 'Placed at stay location',
  manual: 'Placed by hand',
  'has-gps': 'Already has GPS',
  'before-track': 'Before the track',
  'after-track': 'After the track',
  'in-gap': 'In a track gap',
  'outside-fetched-range': 'Outside the fetched range',
  'no-capture-time': 'No capture time',
  excluded: 'Excluded',
}

/** One line on why a photo has this status. */
export function statusReason(status: MatchStatus): string {
  switch (status.kind) {
    case 'matched':
      return 'Position from the track'
    case 'matched-stay':
      return 'Inside a stationary gap; placed where you stayed'
    case 'manual':
      return 'Position chosen by you'
    case 'has-gps':
      return 'Kept as is'
    case 'before-track':
      return `${duration(status.seconds)} before the first track point`
    case 'after-track':
      return `${duration(status.seconds)} after the last track point`
    case 'in-gap':
      return `In a ${duration(status.gapMinutes * 60)} gap between points ${distance(status.distanceMeters)} apart`
    case 'outside-fetched-range':
      return 'The fetched track may not cover this time; fetch a wider range'
    case 'no-capture-time':
      return 'The photo has no capture date'
    case 'excluded':
      return status.reason
  }
}
