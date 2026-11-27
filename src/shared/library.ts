/** File formats Stecknadel loads, keyed by lower-case extension. */
export const PHOTO_FORMATS = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  heic: 'HEIC',
  heif: 'HEIC',
  cr3: 'CR3',
  nef: 'NEF',
  arw: 'ARW',
  raf: 'RAF',
  dng: 'DNG',
} as const

export type PhotoExtension = keyof typeof PHOTO_FORMATS
export type PhotoFormat = (typeof PHOTO_FORMATS)[PhotoExtension]

export const RAW_FORMATS: ReadonlySet<PhotoFormat> = new Set(['CR3', 'NEF', 'ARW', 'RAF', 'DNG'])

/** Opaque photo identifier handed to the renderer; main resolves it against the loaded library. */
export const PHOTO_ID_PATTERN = /^p[0-9a-f]{24}$/

export interface PhotoGps {
  latitude: number
  longitude: number
  altitude: number | null
}

/** What the renderer knows about one photo. Never used to address files: only `id` goes back. */
export interface PhotoSummary {
  id: string
  name: string
  /** Directory relative to the opened folder ('' for the folder itself). */
  relDir: string
  format: PhotoFormat
  cameraKey: string
  /** EXIF DateTimeOriginal (or CreateDate) as written by the camera, `YYYY:MM:DD HH:MM:SS`. */
  captureTime: string | null
  subSec: string | null
  offsetTimeOriginal: string | null
  gps: PhotoGps | null
  orientation: number
  hasSidecar: boolean
  sidecarCollision: boolean
  readError: string | null
}

export interface CameraSummary {
  key: string
  name: string
  defaultName: string
  make: string | null
  model: string | null
  serial: string | null
  count: number
  formats: PhotoFormat[]
  recordsOffsets: boolean
}

export interface LibrarySnapshot {
  folderName: string
  photos: PhotoSummary[]
  cameras: CameraSummary[]
}

export interface LibraryProgress {
  phase: 'scanning' | 'reading'
  done: number
  total: number
}

export interface ThumbnailResult {
  url: string | null
  /** Clockwise degrees the renderer rotates the image by (embedded previews are stored unrotated). */
  rotate: 0 | 90 | 180 | 270
}

/** `-G1 -a` metadata, group → tag → printable value. */
export type MetadataGroups = Record<string, Record<string, string>>
