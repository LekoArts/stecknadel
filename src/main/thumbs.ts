import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThumbnailResult } from '@shared/library'
import type { ExifTool } from 'exiftool-vendored'

export const THUMB_SIZE = 256
export const THUMB_ID_PATTERN = /^[0-9a-f]{40}$/
export const THUMB_SCHEME = 'stecknadel-thumb'

const EMBEDDED_TAGS = ['ThumbnailImage', 'PreviewImage', 'JpgFromRaw'] as const

/** Image operations main provides via Electron's `nativeImage` (injected so the chain is testable). */
export interface ImageOps {
  /** Downscales a JPEG so its long side is at most `size` and re-encodes it as JPEG. */
  resizeJpeg(jpeg: Buffer, size: number): Buffer | null
  /** OS thumbnailer (Quick Look / Windows shell), already orientation-corrected, as JPEG. */
  osThumbnail(file: string, size: number): Promise<Buffer | null>
}

/** Width × height from a JPEG's SOF marker, or null if `buf` isn't a parseable JPEG. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null
    const marker = buf[i + 1]
    if (marker === 0xff) {
      i += 1
      continue
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

/** Embedded previews are stored in sensor orientation; the renderer rotates them by EXIF Orientation. */
export function rotationFor(orientation: number): ThumbnailResult['rotate'] {
  switch (orientation) {
    case 3:
    case 4:
      return 180
    case 5:
    case 6:
      return 90
    case 7:
    case 8:
      return 270
    default:
      return 0
  }
}

/**
 * First usable embedded JPEG: ThumbnailImage → PreviewImage → JpgFromRaw. Tiny embedded thumbnails
 * (long side < 256 px, e.g. the 160 px ones in Fujifilm/Canon/Sony RAWs) are skipped in favour of a
 * larger preview so tiles stay sharp on HiDPI screens, but used if nothing larger exists.
 */
export async function embeddedJpeg(et: ExifTool, file: string): Promise<Buffer | null> {
  let small: Buffer | null = null
  for (const tag of EMBEDDED_TAGS) {
    let buf: Buffer
    try {
      buf = await et.extractBinaryTagToBuffer(tag, file)
    } catch {
      continue
    }
    const size = jpegSize(buf)
    if (!size || size.width < 64) continue
    if (Math.max(size.width, size.height) >= THUMB_SIZE) return buf
    small ??= buf
  }
  return small
}

interface Cached {
  url: string | null
  rotate: ThumbnailResult['rotate']
}

/**
 * Thumbnails as 256 px JPEGs in `dir`, keyed by sha1(path + mtime + size). Results without a
 * thumbnail (`url: null`) let the renderer show the format placeholder.
 */
export class ThumbnailCache {
  private readonly pending = new Map<string, Promise<Cached>>()
  private ready: Promise<unknown> | null = null

  constructor(
    readonly dir: string,
    private readonly et: ExifTool,
    private readonly ops: ImageOps,
  ) {}

  async get(file: string, orientation: number): Promise<ThumbnailResult> {
    const info = await stat(file)
    const id = createHash('sha1').update(`${file}\0${info.mtimeMs}\0${info.size}`).digest('hex')
    let job = this.pending.get(id)
    if (!job) {
      const created = this.create(id, file, orientation)
      job = created
      this.pending.set(id, created)
      // Only in-flight jobs are kept: the disk cache answers the next call, and holding every
      // result would keep the whole library in memory for the life of the process.
      const settle = (): void => {
        if (this.pending.get(id) === created) this.pending.delete(id)
      }
      created.then(settle, settle)
    }
    return job
  }

  /** Resolves a protocol request path (`/<id>.jpg`) to a file inside the cache dir, or null. */
  resolve(pathname: string): string | null {
    const match = /^\/([0-9a-f]{40})\.jpg$/.exec(pathname)
    return match ? join(this.dir, `${match[1]}.jpg`) : null
  }

  private async create(id: string, file: string, orientation: number): Promise<Cached> {
    const target = join(this.dir, `${id}.jpg`)
    const meta = join(this.dir, `${id}.json`)
    try {
      return JSON.parse(await readFile(meta, 'utf8')) as Cached
    } catch {
      // not cached yet
    }

    let jpeg: Buffer | null = null
    let rotate: Cached['rotate'] = 0
    const embedded = await embeddedJpeg(this.et, file)
    if (embedded) {
      jpeg = this.ops.resizeJpeg(embedded, THUMB_SIZE)
      rotate = rotationFor(orientation)
    }
    if (!jpeg) {
      jpeg = await this.ops.osThumbnail(file, THUMB_SIZE).catch(() => null)
      rotate = 0
    }

    this.ready ??= mkdir(this.dir, { recursive: true })
    await this.ready
    const result: Cached = { url: jpeg ? `${THUMB_SCHEME}://thumb/${id}.jpg` : null, rotate }
    if (jpeg) await atomicWrite(target, jpeg)
    await atomicWrite(meta, JSON.stringify(result))
    return result
  }
}

async function atomicWrite(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}
