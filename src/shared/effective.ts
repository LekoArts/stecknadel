import { type PhotoSummary, RAW_FORMATS } from './library'

const DTO = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

/** The zone suffix of an XMP `DateTimeOriginal` (`Z` reads as `+00:00`), or null. */
export function xmpOffset(dateTimeOriginal: string | null): string | null {
  const m = dateTimeOriginal ? DTO.exec(dateTimeOriginal.trim()) : null
  if (!m?.[1]) return null
  return m[1] === 'Z' ? '+00:00' : m[1]
}

/** The `YYYY:MM:DD HH:MM:SS` wall time of an XMP `DateTimeOriginal`, or null. */
export const xmpWallTime = (dateTimeOriginal: string | null): string | null =>
  dateTimeOriginal && DTO.test(dateTimeOriginal.trim())
    ? dateTimeOriginal.trim().slice(0, 19)
    : null

export const writesSidecar = (photo: PhotoSummary, rawTarget: 'in-file' | 'sidecar'): boolean =>
  rawTarget === 'sidecar' && RAW_FORMATS.has(photo.format)

/**
 * The photo as a write would see it. In sidecar mode a RAW's metadata is the RAW together with
 * its sidecar: GPS in either counts, and with no `OffsetTimeOriginal` in the RAW the sidecar's
 * `DateTimeOriginal` suffix is the recorded offset. In-file targets are the file alone.
 */
export function effectivePhoto(
  photo: PhotoSummary,
  rawTarget: 'in-file' | 'sidecar',
): PhotoSummary {
  if (!writesSidecar(photo, rawTarget) || !photo.sidecar) return photo
  return {
    ...photo,
    gps: photo.gps ?? photo.sidecar.gps,
    offsetTimeOriginal: photo.offsetTimeOriginal ?? xmpOffset(photo.sidecar.dateTimeOriginal),
  }
}
