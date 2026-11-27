import type { CameraTags } from '@shared/cameras/identity'
import type { PhotoGps } from '@shared/library'
import type { ExifTool } from 'exiftool-vendored'

export const LIBRARY_TAGS = [
  'Make',
  'Model',
  'LensModel',
  'Software',
  'SerialNumber',
  'InternalSerialNumber',
  'BodySerialNumber',
  'CameraSerialNumber',
  'DateTimeOriginal',
  'SubSecTimeOriginal',
  'CreateDate',
  'OffsetTimeOriginal',
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'GPSAltitudeRef',
  'ImageSize',
  'Orientation',
  'FileType',
  'Error',
] as const

const PHOTO_FILE_TYPES = new Set([
  'JPEG',
  'HEIC',
  'HEIF',
  'CR3',
  'NEF',
  'NRW',
  'ARW',
  'SR2',
  'RAF',
  'DNG',
])

export interface PhotoTags {
  camera: CameraTags
  /** `YYYY:MM:DD HH:MM:SS` wall time from DateTimeOriginal, else CreateDate. */
  captureTime: string | null
  subSec: string | null
  offsetTimeOriginal: string | null
  gps: PhotoGps | null
  imageSize: string | null
  orientation: number
  error: string | null
}

const WALL_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/
const OFFSET = /^[+-]\d{2}:\d{2}$/

function wallTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = WALL_TIME.exec(value)
  if (!m || m[1] === '0000' || m[2] === '00' || m[3] === '00') return null
  return m[0]
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function gpsOf(raw: Record<string, unknown>): PhotoGps | null {
  const latitude = finite(raw.GPSLatitude)
  const longitude = finite(raw.GPSLongitude)
  if (latitude === null || longitude === null) return null
  let altitude = finite(raw.GPSAltitude)
  if (altitude !== null && altitude > 0 && Number(raw.GPSAltitudeRef) === 1) altitude = -altitude
  return { latitude, longitude, altitude }
}

/** Reads the library tags of one file. `-n` keeps GPS numeric and signed. */
export async function readPhotoTags(et: ExifTool, file: string): Promise<PhotoTags> {
  try {
    const raw: Record<string, unknown> = await et.readRaw(file, {
      readArgs: ['-fast', '-n', ...LIBRARY_TAGS.map((tag) => `-${tag}`)],
    })
    const offset = typeof raw.OffsetTimeOriginal === 'string' ? raw.OffsetTimeOriginal.trim() : ''
    const subSec = raw.SubSecTimeOriginal
    const errors = Array.isArray(raw.errors) ? raw.errors.filter(Boolean).map(String) : []
    if (typeof raw.Error === 'string') errors.unshift(raw.Error)
    const fileType = typeof raw.FileType === 'string' ? raw.FileType : null
    if (!fileType || !PHOTO_FILE_TYPES.has(fileType)) {
      errors.unshift(
        fileType ? `Not a photo (contents look like ${fileType})` : 'Unrecognised file contents',
      )
    }
    return {
      camera: {
        Make: raw.Make,
        Model: raw.Model,
        LensModel: raw.LensModel,
        Software: raw.Software,
        SerialNumber: raw.SerialNumber,
        InternalSerialNumber: raw.InternalSerialNumber,
        BodySerialNumber: raw.BodySerialNumber,
        CameraSerialNumber: raw.CameraSerialNumber,
      },
      captureTime: wallTime(raw.DateTimeOriginal) ?? wallTime(raw.CreateDate),
      subSec: subSec === undefined || subSec === null || subSec === '' ? null : String(subSec),
      offsetTimeOriginal: OFFSET.test(offset) ? offset : null,
      gps: gpsOf(raw),
      imageSize: typeof raw.ImageSize === 'string' ? raw.ImageSize : null,
      orientation: finite(raw.Orientation) ?? 1,
      error: errors[0] ?? null,
    }
  } catch (error) {
    return {
      camera: {},
      captureTime: null,
      subSec: null,
      offsetTimeOriginal: null,
      gps: null,
      imageSize: null,
      orientation: 1,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Reads all files through the ExifTool process pool (exiftool-vendored queues the tasks over
 * `maxProcs` processes). `onProgress` is called after every file.
 */
export async function readAll(
  et: ExifTool,
  files: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<PhotoTags[]> {
  let done = 0
  return Promise.all(
    files.map(async (file) => {
      const tags = await readPhotoTags(et, file)
      done += 1
      onProgress?.(done, files.length)
      return tags
    }),
  )
}
