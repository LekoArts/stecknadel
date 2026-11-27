import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PhotoSummary } from '@shared/library'
import {
  type BridgedInterval,
  type BridgeRules,
  classify,
  type MatchLimits,
} from '@shared/match/status'
import type { PhotoPreview, Position, PreviewInput, PreviewSnapshot } from '@shared/preview'
import { formatGeotime } from '@shared/time/exifDate'
import { photoUtc } from '@shared/time/toUtc'
import type { FetchRange } from '@shared/track/range'
import type { Track } from '@shared/track/types'
import type { ExifTool } from 'exiftool-vendored'
import { runRaw } from './exiftool-raw'
import { bridgeTrack } from './track/bridge'
import { toGpx } from './track/toGpx'

/** An empty XMP packet: ExifTool geotags it exactly like a real sidecar. */
export const STUB_XMP =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'

/**
 * The geotag arguments shared by preview and write. The guard comes before `-csv=`: a file
 * missing from the CSV (or with an empty Geotime) would otherwise fall back to its local
 * `DateTimeOriginal` and get wrong coordinates.
 */
export function geotagArgs(csvPath: string, gpxPath: string, limits: MatchLimits): string[] {
  return [
    '-Geotime<StecknadelNoSuchTag',
    `-csv=${csvPath}`,
    '-geotag',
    gpxPath,
    '-api',
    `GeoMaxIntSecs=${limits.geoMaxIntSecs}`,
    '-api',
    `GeoMaxExtSecs=${limits.geoMaxExtSecs}`,
  ]
}

const csvField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

/** `SourceFile,Geotime` rows; the same path strings must be passed as the file arguments. */
export function geotimeCsv(rows: { file: string; geotime: string }[]): string {
  return `SourceFile,Geotime\n${rows.map((r) => `${csvField(r.file)},${r.geotime}`).join('\n')}\n`
}

/** GPS as ExifTool printed it (`-n`), decimal strings verbatim. */
export interface RawPosition {
  lat: string
  lon: string
  /** Signed (negated when `GPSAltitudeRef` = 1). */
  alt: string | null
}

const READ_FORMAT = [
  '$filename',
  '$XMP-exif:GPSLatitude',
  '$XMP-exif:GPSLongitude',
  '$XMP-exif:GPSAltitude',
  '$XMP-exif:GPSAltitudeRef',
].join('\t')

/** Reads the XMP-exif GPS of the stubs back; files without a position map to null. */
export async function readStubPositions(
  et: ExifTool,
  files: string[],
): Promise<Map<string, RawPosition | null>> {
  const out = new Map<string, RawPosition | null>()
  if (files.length === 0) return out
  const { stdout } = await runRaw(et, ['-f', '-n', '-p', READ_FORMAT, ...files])
  for (const line of stdout.split(/\r?\n/)) {
    const [name, lat, lon, alt, ref] = line.split('\t')
    if (!name || lat === undefined) continue
    if (lat === '-' || lon === '-') {
      out.set(name, null)
      continue
    }
    const altitude = alt === '-' || alt === undefined ? null : ref === '1' ? `-${alt}` : alt
    out.set(name, { lat, lon, alt: altitude })
  }
  return out
}

export interface GeotagRow {
  id: string
  geotime: string
}

/**
 * The preview itself: one stub per row in a fresh temp dir, one ExifTool batch with the exact
 * write arguments, then read back. Positions come only from ExifTool.
 */
export async function geotagStubs(
  et: ExifTool,
  rows: GeotagRow[],
  gpxPath: string,
  limits: MatchLimits,
): Promise<Map<string, RawPosition | null>> {
  const result = new Map<string, RawPosition | null>()
  if (rows.length === 0) return result
  const dir = await mkdtemp(join(tmpdir(), 'stecknadel-preview-'))
  try {
    const files = rows.map((r) => join(dir, `${r.id}.xmp`))
    await Promise.all(files.map((f) => writeFile(f, STUB_XMP)))
    const csv = join(dir, 'geotime.csv')
    await writeFile(csv, geotimeCsv(rows.map((r, i) => ({ file: files[i], geotime: r.geotime }))))
    await runRaw(et, ['-overwrite_original', ...geotagArgs(csv, gpxPath, limits), ...files])
    const positions = await readStubPositions(et, files)
    rows.forEach((r) => {
      result.set(r.id, positions.get(`${r.id}.xmp`) ?? null)
    })
    return result
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export interface PreviewOptions {
  limits: MatchLimits
  bridge: BridgeRules
  overwriteGps: boolean
  rawTarget: 'in-file' | 'sidecar'
}

export interface PreviewContext {
  loadId: number
  photos: PhotoSummary[]
  track: Track
  options: PreviewOptions
}

interface PreparedTrack {
  track: Track
  key: string
  dir: string
  gpx: string
  points: { t: number; lat: number; lon: number }[]
  intervals: BridgedInterval[]
}

interface CameraCache {
  key: string
  positions: Map<string, RawPosition | null>
}

const toPosition = (raw: RawPosition): Position => ({
  lat: Number(raw.lat),
  lon: Number(raw.lon),
  ele: raw.alt === null ? null : Number(raw.alt),
})

/**
 * Runs previews with generation handling and a per-camera cache: only cameras whose settings
 * (or the track, limits, bridging or folder) changed go through ExifTool again. A run whose
 * generation was superseded while it ran returns null and its result is never shown.
 */
export class PreviewEngine {
  private sequence = 0
  private queue: Promise<unknown> = Promise.resolve()
  private prepared: PreparedTrack | null = null
  private cache = new Map<string, CameraCache>()
  private last: PreviewSnapshot | null = null

  constructor(private readonly et: ExifTool) {}

  /** The latest snapshot shown to the renderer; what a write confirms. */
  get snapshot(): PreviewSnapshot | null {
    return this.last
  }

  run(input: PreviewInput, ctx: PreviewContext): Promise<PreviewSnapshot | null> {
    // The sequence is ours, not the renderer's: a new window starts its counter over and must
    // still be served, while a run the next request superseded is dropped.
    const sequence = ++this.sequence
    // One run at a time: runs share the prepared GPX and the cache.
    const result = this.queue.then(async () => {
      if (sequence !== this.sequence) return null
      return this.runNow(input, ctx, sequence)
    })
    this.queue = result.catch(() => null)
    return result
  }

  private async runNow(
    input: PreviewInput,
    ctx: PreviewContext,
    sequence: number,
  ): Promise<PreviewSnapshot | null> {
    const started = performance.now()
    const { limits, bridge, overwriteGps, rawTarget } = ctx.options
    const skipped = (photo: PhotoSummary): boolean =>
      (photo.gps !== null && !overwriteGps) || (photo.sidecarCollision && rawTarget === 'sidecar')
    const prepared = await this.prepare(ctx.track, limits, bridge)
    if (sequence !== this.sequence) return null

    const utcs = new Map<string, number | null>()
    const geotimes = new Map<string, string>()
    const byCamera = new Map<string, PhotoSummary[]>()
    for (const photo of ctx.photos) {
      const settings = input.cameras[photo.cameraKey]
      const utc = settings && !photo.readError ? photoUtc(photo, settings).utc : null
      utcs.set(photo.id, utc ? Number(utc.epochNanoseconds) / 1e9 : null)
      if (utc) geotimes.set(photo.id, formatGeotime(utc))
      const list = byCamera.get(photo.cameraKey) ?? []
      list.push(photo)
      byCamera.set(photo.cameraKey, list)
    }

    const rows: GeotagRow[] = []
    const keys = new Map<string, string>()
    for (const [camera, photos] of byCamera) {
      const settings = input.cameras[camera]
      const key = JSON.stringify([
        ctx.loadId,
        prepared.key,
        overwriteGps,
        rawTarget,
        settings ?? null,
      ])
      keys.set(camera, key)
      if (this.cache.get(camera)?.key === key) continue
      for (const photo of photos) {
        const geotime = geotimes.get(photo.id)
        if (geotime && !skipped(photo)) rows.push({ id: photo.id, geotime })
      }
    }
    const recomputed = [...keys].filter(([c, k]) => this.cache.get(c)?.key !== k).map(([c]) => c)
    const positions = await geotagStubs(this.et, rows, prepared.gpx, limits)
    if (sequence !== this.sequence) return null

    for (const camera of recomputed) {
      const map = new Map<string, RawPosition | null>()
      for (const photo of byCamera.get(camera) ?? [])
        map.set(photo.id, positions.get(photo.id) ?? null)
      this.cache.set(camera, { key: keys.get(camera) as string, positions: map })
    }

    const results = ctx.photos.map((photo): PhotoPreview => {
      const utc = utcs.get(photo.id) ?? null
      const raw = this.cache.get(photo.cameraKey)?.positions.get(photo.id) ?? null
      const manual = input.manual[photo.id]
      const status = classify(
        {
          utc,
          readError: photo.readError,
          hasGps: photo.gps !== null,
          sidecarCollision: photo.sidecarCollision,
          manual: manual !== undefined,
          exiftoolMatched: raw !== null,
        },
        {
          points: prepared.points,
          intervals: prepared.intervals,
          limits,
          overwriteGps,
          rawTarget,
          fetchedRange: fetchedRange(ctx.track),
        },
      )
      const position =
        status.kind === 'manual'
          ? manual
          : status.kind === 'matched' || status.kind === 'matched-stay'
            ? toPosition(raw as RawPosition)
            : null
      return { id: photo.id, status, position, utc }
    })

    this.last = {
      generation: input.generation,
      results,
      recomputed,
      durationMs: Math.round(performance.now() - started),
    }
    return this.last
  }

  /** The bridged track as GPX on disk, rebuilt only when the track or rules change. */
  private async prepare(
    track: Track,
    limits: MatchLimits,
    bridge: BridgeRules,
  ): Promise<PreparedTrack> {
    const rules = JSON.stringify([limits, bridge])
    if (this.prepared?.track === track && this.prepared.key.endsWith(rules)) return this.prepared
    const old = this.prepared
    const { points, intervals } = bridgeTrack(track.points, limits.geoMaxIntSecs, bridge)
    const dir = await mkdtemp(join(tmpdir(), 'stecknadel-track-'))
    const gpx = join(dir, 'track.gpx')
    await writeFile(gpx, toGpx(points))
    this.prepared = {
      track,
      key: `${++trackSerial}:${rules}`,
      dir,
      gpx,
      points: track.points,
      intervals,
    }
    this.cache.clear()
    if (old) await rm(old.dir, { recursive: true, force: true })
    return this.prepared
  }

  async dispose(): Promise<void> {
    if (this.prepared) await rm(this.prepared.dir, { recursive: true, force: true })
    this.prepared = null
  }
}

let trackSerial = 0

const fetchedRange = (track: Track): FetchRange | null =>
  track.source.kind === 'dawarich' ? { start: track.source.start, end: track.source.end } : null
