import { Temporal } from 'temporal-polyfill'
import { z } from 'zod'
import { parseOffset } from './exifDate'

export type SegmentTz = { kind: 'zone'; id: string } | { kind: 'offset'; value: string }

export interface Segment {
  /** Camera-local wall time (`YYYY-MM-DDTHH:MM:SS`) where this segment starts; absent on the first. */
  startsAt?: string
  tz: SegmentTz
  /** Seconds the camera clock runs ahead (camera fast = positive). */
  driftSeconds: number
}

export interface CameraTimeSettings {
  /** Prefer the photo's own `OffsetTimeOriginal` over the segment's zone/offset. */
  useRecordedOffsets: boolean
  segments: Segment[]
  /**
   * False while the first segment still holds the computer's zone that was filled in by default:
   * the UI marks it "unconfirmed", and it raises no offset conflicts.
   */
  confirmed: boolean
}

const isZone = (id: string): boolean => {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(id)
    return true
  } catch {
    return false
  }
}

const isPlainDateTime = (value: string): boolean => {
  try {
    Temporal.PlainDateTime.from(value, { overflow: 'reject' })
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)
  } catch {
    return false
  }
}

const tzSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('zone'),
    id: z.string().max(64).refine(isZone, 'Unknown zone'),
  }),
  z.strictObject({
    kind: z.literal('offset'),
    value: z.string().refine((v) => parseOffset(v) !== null, 'Use ±HH:MM'),
  }),
])

const segmentSchema = z.strictObject({
  startsAt: z.string().refine(isPlainDateTime, 'Use YYYY-MM-DDTHH:MM:SS').optional(),
  tz: tzSchema,
  driftSeconds: z.number().min(-86_400).max(86_400),
})

export const cameraTimeSettingsSchema = z
  .strictObject({
    useRecordedOffsets: z.boolean(),
    segments: z.array(segmentSchema).min(1).max(100),
    confirmed: z.boolean(),
  })
  .refine((s) => s.segments[0].startsAt === undefined, 'The first segment has no start')
  .refine(
    (s) =>
      s.segments.slice(1).every((seg, i) => {
        if (seg.startsAt === undefined) return false
        const prev = s.segments[i].startsAt
        return (
          prev === undefined ||
          Temporal.PlainDateTime.compare(
            Temporal.PlainDateTime.from(prev),
            Temporal.PlainDateTime.from(seg.startsAt),
          ) < 0
        )
      }),
    'Later segments need increasing start times',
  )

export function defaultCameraSettings(zone: string): CameraTimeSettings {
  return {
    useRecordedOffsets: true,
    segments: [{ tz: { kind: 'zone', id: zone }, driftSeconds: 0 }],
    confirmed: false,
  }
}

/** The segment whose range contains the wall time: the last one starting at or before it. */
export function segmentFor(settings: CameraTimeSettings, wall: Temporal.PlainDateTime): Segment {
  let found = settings.segments[0]
  for (const segment of settings.segments) {
    if (
      segment.startsAt === undefined ||
      Temporal.PlainDateTime.compare(Temporal.PlainDateTime.from(segment.startsAt), wall) <= 0
    ) {
      found = segment
    } else {
      break
    }
  }
  return found
}

/**
 * Another camera's time zones and changes, applied to this camera: each change keeps the clock
 * drift this camera had there, since drift belongs to the clock, not the trip.
 */
export function copyZones(
  target: CameraTimeSettings,
  source: CameraTimeSettings,
): CameraTimeSettings {
  const segments = source.segments.map((segment): Segment => {
    const own = segment.startsAt
      ? segmentFor(target, Temporal.PlainDateTime.from(segment.startsAt))
      : target.segments[0]
    return { ...segment, driftSeconds: own.driftSeconds }
  })
  return { ...target, segments, confirmed: true }
}

/** Inserts a segment starting at `startsAt`, copying the settings in effect there. */
export function splitAt(
  settings: CameraTimeSettings,
  startsAt: Temporal.PlainDateTime,
  patch: Partial<Omit<Segment, 'startsAt'>> = {},
): CameraTimeSettings {
  const key = startsAt.toString({ smallestUnit: 'second' })
  const current = segmentFor(settings, startsAt)
  const segments = settings.segments.filter((s) => s.startsAt !== key)
  const next: Segment = { ...current, ...patch, startsAt: key }
  const index = segments.findIndex(
    (s) =>
      s.startsAt !== undefined &&
      Temporal.PlainDateTime.compare(Temporal.PlainDateTime.from(s.startsAt), startsAt) > 0,
  )
  if (index === -1) segments.push(next)
  else segments.splice(index, 0, next)
  return { ...settings, segments, confirmed: true }
}
