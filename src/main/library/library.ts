import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { cameraIdentity } from '@shared/cameras/identity'
import type {
  CameraSummary,
  LibraryProgress,
  LibrarySnapshot,
  PhotoFormat,
  PhotoSummary,
} from '@shared/library'
import type { ExifTool } from 'exiftool-vendored'
import { type PhotoTags, readAll, readSidecarTags } from './read'
import { type ScannedPhoto, scanFolder } from './scan'

/** Size and modification time, to tell whether a file changed since it was read. */
export interface Stamp {
  size: number
  mtimeMs: number
}

export async function stampOf(path: string): Promise<Stamp | null> {
  try {
    const s = await lstat(path)
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}

export interface LoadedPhoto {
  id: string
  file: ScannedPhoto
  /** The photo and its sidecar as they were when their metadata was read. */
  stamps: { photo: Stamp | null; sidecar: Stamp | null }
  tags: PhotoTags
  summary: PhotoSummary
}

interface CameraInfo extends Omit<CameraSummary, 'name'> {}

const photoId = (path: string): string =>
  `p${createHash('sha1').update(path).digest('hex').slice(0, 24)}`

/**
 * The currently opened folder. Main keeps the paths; the renderer only ever sees photo IDs, and
 * every request naming a photo goes through `resolve`, which rejects IDs not in this library.
 */
export class Library {
  private root: string | null = null
  private photos = new Map<string, LoadedPhoto>()
  private cameras = new Map<string, CameraInfo>()
  private generation = 0
  private loaded = 0

  constructor(
    private readonly et: ExifTool,
    private readonly cameraNames: () => Record<string, string>,
  ) {}

  /** Scans and reads `root`. A newer `load` supersedes an older one still in flight. */
  async load(
    root: string,
    onProgress?: (progress: LibraryProgress) => void,
  ): Promise<LibrarySnapshot | null> {
    const generation = ++this.generation
    const files = await scanFolder(root, (found) =>
      onProgress?.({ phase: 'scanning', done: found, total: 0 }),
    )
    if (generation !== this.generation) return null
    const stamps = await Promise.all(
      files.map(async (f) => ({
        photo: await stampOf(f.path),
        sidecar: f.sidecarPath ? await stampOf(f.sidecarPath) : null,
      })),
    )
    onProgress?.({ phase: 'reading', done: 0, total: files.length })
    let last = 0
    const tags = await readAll(
      this.et,
      files.map((f) => f.path),
      (done, total) => {
        const now = Date.now()
        if (done === total || now - last > 100) {
          last = now
          onProgress?.({ phase: 'reading', done, total })
        }
      },
    )
    if (generation !== this.generation) return null
    const sidecars = await Promise.all(
      files.map((f) => (f.sidecarPath ? readSidecarTags(this.et, f.sidecarPath) : null)),
    )
    if (generation !== this.generation) return null

    const photos = new Map<string, LoadedPhoto>()
    const cameras = new Map<string, CameraInfo>()
    files.forEach((file, i) => {
      const t = tags[i]
      const identity = cameraIdentity(t.camera)
      const id = photoId(file.path)
      const summary: PhotoSummary = {
        id,
        name: file.name,
        relDir: file.relDir,
        format: file.format,
        cameraKey: identity.key,
        captureTime: t.captureTime,
        subSec: t.subSec,
        offsetTimeOriginal: t.offsetTimeOriginal,
        gps: t.gps,
        orientation: t.orientation,
        sidecar: sidecars[i],
        sidecarCollision: file.sidecarCollision,
        readError: t.error,
      }
      photos.set(id, { id, file, stamps: stamps[i], tags: t, summary })

      const camera = cameras.get(identity.key) ?? {
        key: identity.key,
        defaultName: identity.defaultName,
        make: identity.make,
        model: identity.model,
        serial: identity.serial,
        count: 0,
        formats: [] as PhotoFormat[],
        recordsOffsets: false,
      }
      camera.count += 1
      if (!camera.formats.includes(file.format)) camera.formats.push(file.format)
      if (t.offsetTimeOriginal) camera.recordsOffsets = true
      cameras.set(identity.key, camera)
    })

    this.root = root
    this.photos = photos
    this.cameras = cameras
    this.loaded = generation
    return this.snapshot()
  }

  /** Reads the open folder again (after a write changed its files). */
  reload(onProgress?: (progress: LibraryProgress) => void): Promise<LibrarySnapshot | null> {
    return this.root === null ? Promise.resolve(null) : this.load(this.root, onProgress)
  }

  /** Changes whenever a new folder finishes loading. */
  get loadId(): number {
    return this.loaded
  }

  all(): LoadedPhoto[] {
    return [...this.photos.values()]
  }

  snapshot(): LibrarySnapshot | null {
    if (this.root === null) return null
    return {
      folderName: basename(this.root),
      photos: [...this.photos.values()].map((p) => p.summary),
      cameras: this.cameraList(),
    }
  }

  cameraList(): CameraSummary[] {
    const names = this.cameraNames()
    return [...this.cameras.values()]
      .map((c) => ({ ...c, formats: [...c.formats].sort(), name: names[c.key] ?? c.defaultName }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  hasCamera(key: string): boolean {
    return this.cameras.has(key)
  }

  resolve(id: string): LoadedPhoto {
    const photo = this.photos.get(id)
    if (!photo) throw new Error('Unknown photo')
    return photo
  }
}
