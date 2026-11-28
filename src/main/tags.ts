import type { Position } from '@shared/preview'
import type { ExifTool } from 'exiftool-vendored'
import { runBatch } from './exiftool-raw'
import type { TagValues } from './journal'

/** Every tag a write can change, in every group a photo or sidecar may carry it. */
export const AFFECTED_TAGS = [
  '-EXIF:GPS*',
  '-XMP-exif:GPS*',
  '-EXIF:OffsetTimeOriginal',
  '-XMP-exif:DateTimeOriginal',
]

/** ExifTool prints paths with forward slashes on Windows too. */
export const normPath = (path: string): string => path.replaceAll('\\', '/')

async function readJson(
  et: ExifTool,
  args: string[],
  files: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  if (files.length === 0) return out
  const { stdout } = await runBatch(et, ['-j', '-n', ...args, ...files])
  if (!stdout.trim()) return out
  for (const entry of JSON.parse(stdout) as Record<string, unknown>[]) {
    const { SourceFile, ...rest } = entry
    if (typeof SourceFile === 'string') out.set(normPath(SourceFile), rest)
  }
  return out
}

/**
 * The affected tags of each file, group-qualified (`-G1 -a`). A file ExifTool couldn't read is
 * missing from the map: "no values" and "couldn't read the values" must not look alike.
 */
export async function readAffected(et: ExifTool, files: string[]): Promise<Map<string, TagValues>> {
  const raw = await readJson(et, ['-G1', '-a', ...AFFECTED_TAGS], files)
  const out = new Map<string, TagValues>()
  for (const [file, tags] of raw) {
    if ('Error' in tags || 'ExifTool:Error' in tags) continue
    const values: TagValues = {}
    for (const [k, v] of Object.entries(tags)) {
      if (typeof v === 'string' || typeof v === 'number') values[k] = v
    }
    out.set(file, values)
  }
  return out
}

/**
 * Puts the affected tags back to `values`: everything a write could have added is deleted, then
 * each recorded tag is rewritten in its own group (`^=` keeps a recorded empty value).
 */
export function restoreArgs(values: TagValues): string[] {
  return [
    '-overwrite_original',
    '-n',
    ...AFFECTED_TAGS.map((t) => `${t}=`),
    ...Object.entries(values).map(([k, v]) => (v === '' ? `-${k}^=` : `-${k}=${v}`)),
  ]
}

/**
 * Whether `now` holds the journaled `values` again: every recorded tag as recorded, and no
 * coordinates where none were recorded (ExifTool may add bookkeeping such as GPSVersionID).
 */
export function restored(values: TagValues, now: TagValues | undefined): boolean {
  if (!now) return false
  for (const [k, v] of Object.entries(values)) if (String(now[k]) !== String(v)) return false
  return Object.keys(now).every((k) => k in values || !/:GPS(Latitude|Longitude|Altitude)$/.test(k))
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

/**
 * Reads back the coordinates the write left: the composite (signed, EXIF) position for in-file
 * targets, XMP-exif for sidecars.
 */
export async function readPositions(
  et: ExifTool,
  files: { path: string; kind: 'photo' | 'sidecar' }[],
): Promise<Map<string, Position | null>> {
  const raw = await readJson(
    et,
    [
      '-G1',
      '-Composite:GPSLatitude',
      '-Composite:GPSLongitude',
      '-Composite:GPSAltitude',
      '-XMP-exif:GPSLatitude',
      '-XMP-exif:GPSLongitude',
      '-XMP-exif:GPSAltitude',
      '-XMP-exif:GPSAltitudeRef',
    ],
    files.map((f) => f.path),
  )
  const out = new Map<string, Position | null>()
  for (const f of files) {
    const tags = raw.get(normPath(f.path))
    let lat: number | null = null
    let lon: number | null = null
    let ele: number | null = null
    if (tags && f.kind === 'photo') {
      lat = num(tags['Composite:GPSLatitude'])
      lon = num(tags['Composite:GPSLongitude'])
      ele = num(tags['Composite:GPSAltitude'])
    } else if (tags) {
      lat = num(tags['XMP-exif:GPSLatitude'])
      lon = num(tags['XMP-exif:GPSLongitude'])
      const alt = num(tags['XMP-exif:GPSAltitude'])
      ele = alt === null ? null : tags['XMP-exif:GPSAltitudeRef'] === 1 ? -alt : alt
    }
    out.set(normPath(f.path), lat === null || lon === null ? null : { lat, lon, ele })
  }
  return out
}

/** Within the verification tolerance: 1e-6° and 0.01 m, altitude absent on both or neither. */
export function samePosition(a: Position | null, b: Position | null): boolean {
  if (a === null || b === null) return a === b
  if (Math.abs(a.lat - b.lat) > 1e-6 || Math.abs(a.lon - b.lon) > 1e-6) return false
  if (a.ele === null || b.ele === null) return a.ele === b.ele
  return Math.abs(a.ele - b.ele) <= 0.01
}

/** Per-file `Error:` lines of a batch, by the target path they end with. */
export function errorsByFile(messages: string[], paths: string[]): Map<string, string> {
  const out = new Map<string, string>()
  // Longest first, so `a.jpg` never claims a line about `a.jpg.xmp`.
  const byLength = [...paths].sort((a, b) => b.length - a.length)
  for (const line of messages) {
    if (!/^error/i.test(line)) continue
    const n = normPath(line)
    // Most errors end in ` - <file>`; some (renaming the temp file on Windows) name it inline.
    const path = byLength.find((p) => n.includes(normPath(p)))
    if (!path || out.has(path)) continue
    const suffix = ` - ${normPath(path)}`
    const text = n.endsWith(suffix) ? line.slice(0, -suffix.length) : line
    out.set(path, text.replace(/^error:\s*/i, ''))
  }
  return out
}
