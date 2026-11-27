import type { Temporal } from 'temporal-polyfill'
import { type CameraTimeSettings, type Segment, segmentFor } from './cameraSettings'
import { parseOffset } from './exifDate'
import type { OffsetCandidate } from './offsetFinder'
import type { PhotoUtc } from './toUtc'

/**
 * Applies an offset-finder suggestion to the camera segment the photo falls in.
 * - Photo timed by its recorded offset: the offset is the camera's own; only drift changes.
 * - Otherwise the segment's zone stays when it already has the suggested offset at that moment,
 *   else it becomes the suggested fixed offset. Drift is set from the suggestion.
 * A stationary window pins no exact moment, so drift is left as it was there.
 */
export function applyOffsetCandidate(
  settings: CameraTimeSettings,
  time: Extract<PhotoUtc, { wall: Temporal.PlainDateTime }>,
  recordedOffset: string | null,
  candidate: OffsetCandidate,
): CameraTimeSettings {
  const segment = segmentFor(settings, time.wall)
  let next: Segment
  if (time.source === 'recorded-offset') {
    const recorded = parseOffset(recordedOffset)
    if (recorded === null || candidate.stationary) return { ...settings, confirmed: true }
    next = { ...segment, driftSeconds: Math.round(candidate.correctionSeconds - recorded) }
  } else {
    const keepZone =
      segment.tz.kind === 'zone' &&
      parseOffset(time.wall.toZonedDateTime(segment.tz.id).offset) === candidate.offsetSeconds
    next = {
      ...segment,
      tz: keepZone ? segment.tz : { kind: 'offset', value: candidate.offset },
      driftSeconds:
        candidate.driftSeconds === null ? segment.driftSeconds : Math.round(candidate.driftSeconds),
    }
  }
  return {
    ...settings,
    segments: settings.segments.map((s) => (s === segment ? next : s)),
    confirmed: true,
  }
}
