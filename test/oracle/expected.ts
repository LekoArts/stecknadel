// TEST ORACLE ONLY. Never imported by src/ (tests reach it through the `@oracle` alias) and never
// imports src/. It independently states the outcome ExifTool's documented geotag rule should give,
// so the app's time model can be checked by where a photo lands, not just by its time.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export interface OraclePoint {
  /** Unix seconds (UTC). */
  t: number
  lat: number
  lon: number
  ele?: number
}

export interface OraclePosition {
  lat: number
  lon: number
  ele?: number
}

export interface Limits {
  geoMaxIntSecs: number
  geoMaxExtSecs: number
}

export const EXIFTOOL_DEFAULT_LIMITS: Limits = { geoMaxIntSecs: 1800, geoMaxExtSecs: 1800 }

/** Tolerances: ExifTool rounds what it writes. */
export const DEG_TOLERANCE = 1e-5
export const ELE_TOLERANCE = 0.05

const at = (p: OraclePoint): OraclePosition =>
  p.ele === undefined ? { lat: p.lat, lon: p.lon } : { lat: p.lat, lon: p.lon, ele: p.ele }

/**
 * ExifTool's rule (Geotag.pm): between two fixes no more than GeoMaxIntSecs apart, linear
 * interpolation; otherwise the nearest fix when it is within GeoMaxExtSecs; otherwise no match.
 * `track` must be sorted by time.
 */
export function expectedMatch(
  track: OraclePoint[],
  utc: number,
  limits: Limits = EXIFTOOL_DEFAULT_LIMITS,
): OraclePosition | null {
  if (track.length === 0) return null
  let after = track.findIndex((p) => p.t >= utc)
  if (after === -1) after = track.length
  const next = track[after]
  if (next && next.t === utc) return at(next)
  const prev = track[after - 1]
  if (prev && next && next.t - prev.t <= limits.geoMaxIntSecs) {
    const f = (utc - prev.t) / (next.t - prev.t)
    const out: OraclePosition = {
      lat: prev.lat + (next.lat - prev.lat) * f,
      lon: prev.lon + (next.lon - prev.lon) * f,
    }
    if (prev.ele !== undefined && next.ele !== undefined)
      out.ele = prev.ele + (next.ele - prev.ele) * f
    return out
  }
  const candidates = [prev, next].filter((p): p is OraclePoint => p !== undefined)
  candidates.sort((a, b) => Math.abs(a.t - utc) - Math.abs(b.t - utc))
  const nearest = candidates[0]
  return Math.abs(nearest.t - utc) <= limits.geoMaxExtSecs ? at(nearest) : null
}

export interface BridgeRules {
  radiusMeters: number
  maxGapSecs: number
}

export const DEFAULT_BRIDGE_RULES: BridgeRules = { radiusMeters: 250, maxGapSecs: 24 * 3600 }

/** Great-circle distance in meters (mean Earth radius). */
export function distanceMeters(a: OraclePosition, b: OraclePosition): number {
  const R = 6_371_008.8
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The track with stationary gaps bridged, built from the rule text (user decision 19): a gap longer
 * than GeoMaxIntSecs, ≤ maxGap long, whose end fixes are ≤ radius apart, gets filler points every
 * min(15 min, GeoMaxIntSecs / 2): in its first half at the first end, in its second half at the
 * second end.
 */
export function bridgedTrack(
  track: OraclePoint[],
  limits: Limits,
  rules: BridgeRules,
): OraclePoint[] {
  const out: OraclePoint[] = []
  const step = Math.min(900, limits.geoMaxIntSecs / 2)
  for (let i = 0; i < track.length; i++) {
    const a = track[i]
    out.push(a)
    const b = track[i + 1]
    if (!b) break
    const gap = b.t - a.t
    if (gap <= limits.geoMaxIntSecs || gap > rules.maxGapSecs) continue
    if (distanceMeters(a, b) > rules.radiusMeters) continue
    const mid = a.t + gap / 2
    for (let t = a.t + step; t <= mid; t += step) out.push({ ...a, t })
    const second: OraclePoint[] = []
    for (let t = b.t - step; t > mid; t -= step) second.unshift({ ...b, t })
    out.push(...second)
  }
  return out
}

/** Where a photo in a bridged stationary gap should land: ExifTool's rule on the bridged track. */
export function expectedStay(
  track: OraclePoint[],
  utc: number,
  limits: Limits = EXIFTOOL_DEFAULT_LIMITS,
  rules: BridgeRules = DEFAULT_BRIDGE_RULES,
): OraclePosition | null {
  return expectedMatch(bridgedTrack(track, limits, rules), utc, limits)
}

/** A manually placed photo keeps exactly the chosen coordinates. */
export function expectedManual(lat: number, lon: number): OraclePosition {
  return { lat, lon }
}

/** A skipped file is byte-identical: compare this before and after. */
export async function expectedSkipped(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

/** Whether two positions agree within the oracle tolerances. */
export function samePosition(
  actual: OraclePosition | null,
  expected: OraclePosition | null,
): boolean {
  if (actual === null || expected === null) return actual === expected
  if (Math.abs(actual.lat - expected.lat) > DEG_TOLERANCE) return false
  if (Math.abs(actual.lon - expected.lon) > DEG_TOLERANCE) return false
  if (expected.ele !== undefined) {
    return actual.ele !== undefined && Math.abs(actual.ele - expected.ele) <= ELE_TOLERANCE
  }
  return true
}

/** Minimal GPX reader for fixtures (trkpt with lat/lon, optional ele, required UTC time). */
export function readGpxPoints(xml: string): OraclePoint[] {
  const points: OraclePoint[] = []
  const re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"\s*>([\s\S]*?)<\/trkpt>/g
  for (const m of xml.matchAll(re)) {
    const time = /<time>([^<]+)<\/time>/.exec(m[3])?.[1]
    if (!time) continue
    const ele = /<ele>([^<]+)<\/ele>/.exec(m[3])?.[1]
    const p: OraclePoint = { t: Date.parse(time) / 1000, lat: Number(m[1]), lon: Number(m[2]) }
    if (ele !== undefined) p.ele = Number(ele)
    points.push(p)
  }
  return points.sort((a, b) => a.t - b.t)
}
