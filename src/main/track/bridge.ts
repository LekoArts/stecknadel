import { haversineMeters } from '@shared/geo'
import type { BridgedInterval, BridgeRules } from '@shared/match/status'
import type { TrackPoint } from '@shared/track/types'

/**
 * Bridges stationary gaps (user decision 19): a gap longer than GeoMaxIntSecs, at most
 * `maxGapSecs` long, whose end fixes are at most `radiusMeters` apart, gets filler points every
 * `min(900, floor(GeoMaxIntSecs / 2))` s — in its first half copies of the first end (coordinates
 * and altitude), in its second half copies of the second end. No new coordinates are invented, so
 * ExifTool places a photo in the gap at one stay end, or on the straight line between them around
 * the midpoint.
 */
export function bridgeTrack(
  points: TrackPoint[],
  geoMaxIntSecs: number,
  rules: BridgeRules,
): { points: TrackPoint[]; intervals: BridgedInterval[] } {
  if (!rules.enabled) return { points, intervals: [] }
  const step = Math.min(900, Math.floor(geoMaxIntSecs / 2))
  const out: TrackPoint[] = []
  const intervals: BridgedInterval[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    out.push(a)
    const b = points[i + 1]
    if (!b) break
    const gap = b.t - a.t
    if (gap <= geoMaxIntSecs || gap > rules.maxGapHours * 3600) continue
    if (haversineMeters(a, b) > rules.radiusMeters) continue
    const mid = a.t + gap / 2
    for (let t = a.t + step; t <= mid; t += step) out.push({ ...a, t })
    const second: TrackPoint[] = []
    for (let t = b.t - step; t > mid; t -= step) second.push({ ...b, t })
    out.push(...second.reverse())
    intervals.push({ from: a.t, to: b.t })
  }
  return { points: out, intervals }
}
