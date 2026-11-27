import { Temporal } from 'temporal-polyfill'

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/

/**
 * A camera wall time from `YYYY:MM:DD HH:MM:SS[.sss]` plus `SubSecTime*` digits (which win over a
 * fraction in the date string). Anything after the seconds (e.g. a zone suffix) is ignored. Null
 * for unparseable or impossible dates (`0000:00:00 00:00:00`).
 */
export function parseExifDateTime(
  value: string | null | undefined,
  subSec?: string | number | null,
): Temporal.PlainDateTime | null {
  if (!value) return null
  const m = EXIF_DATE.exec(value.trim())
  if (!m) return null
  const sub = subSec === null || subSec === undefined ? '' : String(subSec).trim()
  const fraction = /^\d+$/.test(sub) ? sub : (m[7] ?? '')
  const nanos = fraction ? Number(fraction.slice(0, 9).padEnd(9, '0')) : 0
  try {
    return Temporal.PlainDateTime.from(
      {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +m[4],
        minute: +m[5],
        second: +m[6],
        millisecond: Math.floor(nanos / 1e6),
        microsecond: Math.floor(nanos / 1e3) % 1000,
        nanosecond: nanos % 1000,
      },
      { overflow: 'reject' },
    )
  } catch {
    return null
  }
}

/** `±HH:MM` (or `±HHMM`) → offset in seconds; null when malformed or beyond ±18:00. */
export function parseOffset(value: string | null | undefined): number | null {
  if (!value) return null
  const m = OFFSET.exec(value.trim())
  if (!m) return null
  const minutes = Number(m[2]) * 60 + Number(m[3])
  if (Number(m[3]) > 59 || minutes > 18 * 60) return null
  return (m[1] === '-' ? -minutes : minutes) * 60
}

/** Offset seconds → `±HH:MM` (seconds are dropped; offsets are whole minutes). */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const minutes = Math.round(Math.abs(seconds) / 60)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/**
 * ExifTool's Geotime format: `YYYY:mm:dd HH:MM:SSZ`, with fractional seconds (trailing zeros
 * trimmed) only when present. ISO `2026-11-09T16:20:00Z` is rejected by ExifTool.
 */
export function formatGeotime(instant: Temporal.Instant): string {
  const d = instant.toZonedDateTimeISO('UTC')
  const nanos = d.millisecond * 1e6 + d.microsecond * 1e3 + d.nanosecond
  const fraction = nanos ? `.${pad(nanos, 9).replace(/0+$/, '')}` : ''
  return `${pad(d.year, 4)}:${pad(d.month)}:${pad(d.day)} ${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}${fraction}Z`
}

/** A wall time read as if it were UTC, in (fractional) Unix seconds. */
export function wallAsUtcSeconds(wall: Temporal.PlainDateTime): number {
  return Number(wall.toZonedDateTime('UTC').epochNanoseconds) / 1e9
}

/** Instant → (fractional) Unix seconds. */
export const instantSeconds = (instant: Temporal.Instant): number =>
  Number(instant.epochNanoseconds) / 1e9

/** (Fractional) Unix seconds → Instant, rounded to the microsecond. */
export const secondsToInstant = (seconds: number): Temporal.Instant =>
  Temporal.Instant.fromEpochNanoseconds(BigInt(Math.round(seconds * 1e6)) * 1000n)
