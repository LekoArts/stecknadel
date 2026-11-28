import { Temporal } from 'temporal-polyfill'
import { type CameraTimeSettings, type Segment, segmentFor } from './cameraSettings'
import { formatGeotime, parseExifDateTime, parseOffset } from './exifDate'

export type TimeWarning = 'ambiguous-local-time' | 'offset-conflict'

/** What the time model needs from a photo (a subset of `PhotoSummary`). */
export interface PhotoTimeInput {
  /** `DateTimeOriginal`, falling back to `CreateDate`, as written by the camera. */
  captureTime: string | null
  subSec: string | null
  /** EXIF `OffsetTimeOriginal`, e.g. `-07:00`. */
  offsetTimeOriginal: string | null
}

export type PhotoUtc =
  | { utc: null; source: null; wall: null; warnings: TimeWarning[] }
  | {
      utc: Temporal.Instant
      source: 'recorded-offset' | 'segment'
      wall: Temporal.PlainDateTime
      /** The UTC offset the camera clock is read in (seconds, before drift): what a write records. */
      offsetSeconds: number
      warnings: TimeWarning[]
    }

const DISAMBIGUATION = 'compatible' as const

/** The segment's UTC offset (seconds) at this wall time, and whether that wall time is ambiguous. */
function resolveSegment(
  segment: Segment,
  wall: Temporal.PlainDateTime,
): { instant: Temporal.Instant; ambiguous: boolean } {
  if (segment.tz.kind === 'offset') {
    const offset = parseOffset(segment.tz.value)
    if (offset === null) throw new Error(`Invalid offset ${segment.tz.value}`)
    const utcNs = wall.toZonedDateTime('UTC').epochNanoseconds - BigInt(offset) * 1_000_000_000n
    return { instant: Temporal.Instant.fromEpochNanoseconds(utcNs), ambiguous: false }
  }
  const zone = segment.tz.id
  const zdt = wall.toZonedDateTime(zone, { disambiguation: DISAMBIGUATION })
  // 0 possible instants = skipped hour (spring forward), 2 = repeated hour (fall back).
  const ambiguous = possibleInstantCount(wall, zone) !== 1
  return { instant: zdt.toInstant(), ambiguous }
}

function possibleInstantCount(wall: Temporal.PlainDateTime, zone: string): number {
  const earlier = wall.toZonedDateTime(zone, { disambiguation: 'earlier' })
  const later = wall.toZonedDateTime(zone, { disambiguation: 'later' })
  if (!earlier.toPlainDateTime().equals(wall)) return 0
  return earlier.epochNanoseconds === later.epochNanoseconds ? 1 : 2
}

const minusDrift = (instant: Temporal.Instant, driftSeconds: number): Temporal.Instant =>
  instant.subtract({ nanoseconds: Math.round(driftSeconds * 1e9) })

/**
 * The photo's UTC capture instant under its camera's settings (see the plan's time model):
 * a recorded offset wins when "use recorded offsets" is on, otherwise the segment containing the
 * wall time applies; the segment's drift (camera fast = positive) is subtracted either way.
 */
export function photoUtc(photo: PhotoTimeInput, settings: CameraTimeSettings): PhotoUtc {
  const wall = parseExifDateTime(photo.captureTime, photo.subSec)
  if (!wall) return { utc: null, source: null, wall: null, warnings: [] }

  const segment = segmentFor(settings, wall)
  const resolved = resolveSegment(segment, wall)
  const recorded = parseOffset(photo.offsetTimeOriginal)
  const warnings: TimeWarning[] = []
  const segmentOffset = Number(
    (wall.toZonedDateTime('UTC').epochNanoseconds - resolved.instant.epochNanoseconds) /
      1_000_000_000n,
  )
  if (recorded !== null && settings.confirmed && segmentOffset !== recorded)
    warnings.push('offset-conflict')

  if (settings.useRecordedOffsets && recorded !== null) {
    const utcNs = wall.toZonedDateTime('UTC').epochNanoseconds - BigInt(recorded) * 1_000_000_000n
    return {
      utc: minusDrift(Temporal.Instant.fromEpochNanoseconds(utcNs), segment.driftSeconds),
      source: 'recorded-offset',
      wall,
      offsetSeconds: recorded,
      warnings,
    }
  }

  if (resolved.ambiguous) warnings.push('ambiguous-local-time')
  return {
    utc: minusDrift(resolved.instant, segment.driftSeconds),
    source: 'segment',
    wall,
    offsetSeconds: segmentOffset,
    warnings,
  }
}

/** The photo's ExifTool `Geotime`, or null without a capture time. */
export function photoGeotime(photo: PhotoTimeInput, settings: CameraTimeSettings): string | null {
  const { utc } = photoUtc(photo, settings)
  return utc ? formatGeotime(utc) : null
}
