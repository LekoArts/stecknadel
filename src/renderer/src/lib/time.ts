import type { SegmentTz } from '@shared/time/cameraSettings'
import { Temporal } from 'temporal-polyfill'

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

let zones: string[] | null = null
/** Every IANA zone the runtime knows, UTC first. */
export function allZones(): string[] {
  if (!zones) {
    const list = Intl.supportedValuesOf('timeZone')
    zones = ['UTC', ...list.filter((z) => z !== 'UTC')]
  }
  return zones
}

/** `-07:00` → `UTC−07:00`. */
export const offsetLabel = (value: string): string => `UTC${value.replace('-', '−')}`

export const tzLabel = (tz: SegmentTz): string =>
  tz.kind === 'zone' ? tz.id.replaceAll('_', ' ') : offsetLabel(tz.value)

/** The zone's current UTC offset, e.g. `+01:00`. */
export const currentOffset = (zone: string): string => Temporal.Now.zonedDateTimeISO(zone).offset

/** `2026-11-07T20:28:21.25Z` → `2026-11-07 20:28:21Z` (fractions are kept only in Geotime). */
export const formatInstant = (instant: Temporal.Instant): string =>
  `${instant.toString({ smallestUnit: 'second' }).replace('T', ' ')}`

/** Camera-local `2026-11-07T00:00:00` → `2026-11-07 00:00:00`. */
export const formatWall = (wall: string): string => wall.replace('T', ' ')

/** EXIF `2026:11:07 13:28:21` → the `datetime-local` value `2026-11-07T13:28:21`. */
export const exifToInput = (exif: string): string =>
  `${exif.slice(0, 10).replaceAll(':', '-')}T${exif.slice(11, 19)}`

/** Signed seconds as `+73 s` / `−73 s`. */
export const formatDrift = (seconds: number): string =>
  `${seconds > 0 ? '+' : seconds < 0 ? '−' : ''}${Math.abs(seconds)} s`
