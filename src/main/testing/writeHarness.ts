// Test-only: a real library + preview + writer over temp copies of the fixtures.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { effectivePhoto } from '@shared/effective'
import { DEFAULT_BRIDGE, DEFAULT_LIMITS } from '@shared/match/status'
import type { Position, PreviewSnapshot } from '@shared/preview'
import type { WritingSettings } from '@shared/settings'
import type { CameraTimeSettings } from '@shared/time/cameraSettings'
import type { Track } from '@shared/track/types'
import type { WriteResult } from '@shared/write'
import type { ExifTool } from 'exiftool-vendored'
import { Recovery } from '../backups'
import { runRaw } from '../exiftool-raw'
import { Journals } from '../journal'
import { Library } from '../library/library'
import { PreviewEngine, STUB_XMP } from '../preview'
import { parseGpx } from '../track/gpx'
import { type WriteHooks, Writer } from '../write'

export const FIXTURES = join(__dirname, '../../../test/fixtures')
export const CACHE = join(FIXTURES, 'cache')

/** Every format, as fixture files. */
export const FORMATS = {
  JPEG: join(FIXTURES, 'base.jpg'),
  HEIC: join(CACHE, 'exiftool-QuickTime.heic'),
  CR3: join(CACHE, 'Canon-EOS-R.CR3'),
  NEF: join(CACHE, 'Nikon-Z6.NEF'),
  ARW: join(CACHE, 'Sony-a7III.ARW'),
  RAF: join(CACHE, 'Fujifilm-X-T4.RAF'),
  DNG: join(CACHE, 'Ricoh-GR-III.DNG'),
} as const

/** `src` for an empty `.xmp` sidecar. */
export const STUB = 'stub'

export interface FixtureFile {
  src: string
  /** Path inside the photo folder, `/`-separated. */
  name: string
  /** `YYYY:MM:DD HH:MM:SS`; null removes it. */
  wall: string | null
  /** More ExifTool arguments for the copy (applied before loading). */
  tags?: string[]
}

export const sha256 = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

export const utcZone: CameraTimeSettings = {
  segments: [{ tz: { kind: 'zone', id: 'UTC' }, driftSeconds: 0 }],
  useRecordedOffsets: true,
  confirmed: true,
}

export const DEFAULT_WRITING: WritingSettings = {
  overwriteGps: false,
  writeOffsetTime: true,
  rawTarget: 'in-file',
  backups: false,
}

export async function syntheticTrack(): Promise<Track> {
  const xml = await readFile(join(FIXTURES, 'synthetic-trip.gpx'), 'utf8')
  return parseGpx(xml, 'synthetic-trip.gpx')
}

export class Harness {
  readonly journals: Journals
  readonly recovery: Recovery
  readonly library: Library
  readonly engine: PreviewEngine
  readonly writer: Writer
  writing: WritingSettings = { ...DEFAULT_WRITING }
  limits = { ...DEFAULT_LIMITS }
  hooks: WriteHooks = {}
  cameras: Record<string, CameraTimeSettings> = {}
  manual: Record<string, Position> = {}
  now = Date.now()
  private generation = 0

  constructor(
    readonly et: ExifTool,
    readonly dir: string,
    readonly journalDir: string,
    public track: Track,
  ) {
    this.journals = new Journals(journalDir, () => this.now)
    this.recovery = new Recovery(et, this.journals)
    this.library = new Library(et, () => ({}))
    this.engine = new PreviewEngine(et)
    this.writer = new Writer({
      et,
      preview: this.engine,
      journals: this.journals,
      resolve: (id) => this.library.resolve(id),
      context: () => this.context(),
      writing: () => this.writing,
      hooks: {
        expected: (id, p) => this.hooks.expected?.(id, p) ?? p,
        afterJournal: () => this.hooks.afterJournal?.(),
        beforeBatch: (files) => this.hooks.beforeBatch?.(files),
      },
    })
  }

  path(name: string): string {
    return join(this.dir, ...name.split('/'))
  }

  context() {
    return {
      loadId: this.library.loadId,
      photos: this.library.all().map((p) => effectivePhoto(p.summary, this.writing.rawTarget)),
      track: this.track,
      options: {
        limits: this.limits,
        bridge: DEFAULT_BRIDGE,
        overwriteGps: this.writing.overwriteGps,
        rawTarget: this.writing.rawTarget,
      },
    }
  }

  async load(): Promise<void> {
    await this.library.load(this.dir)
  }

  idOf(name: string): string {
    const photo = this.library
      .all()
      .find(
        (p) =>
          (p.summary.relDir ? `${p.summary.relDir}/${p.summary.name}` : p.summary.name) === name,
      )
    if (!photo) throw new Error(`no photo ${name}`)
    return photo.id
  }

  /** Runs the preview the user would confirm. */
  async preview(): Promise<PreviewSnapshot> {
    const cameras: Record<string, CameraTimeSettings> = {}
    for (const p of this.library.all())
      cameras[p.summary.cameraKey] = this.cameras[p.summary.cameraKey] ?? utcZone
    const snap = await this.engine.run(
      { generation: ++this.generation, cameras, manual: this.manual },
      this.context(),
    )
    if (!snap) throw new Error('preview superseded')
    return snap
  }

  /** Writes `ids`, or every photo in the library. */
  write(
    writing: WritingSettings = this.writing,
    ids: readonly string[] = this.library.all().map((p) => p.summary.id),
  ): Promise<WriteResult> {
    return this.writer.write(this.generation, writing, ids)
  }

  async previewAndWrite() {
    const snap = await this.preview()
    const result = await this.write()
    if (result.kind !== 'done') throw new Error(`stale: ${result.reason}`)
    return { snap, report: result.report }
  }

  async dispose(): Promise<void> {
    await this.engine.dispose()
    await rm(dirname(this.dir), { recursive: true, force: true })
  }
}

/** Copies the fixtures into a fresh folder, sets their capture time and clears their GPS. */
export async function harness(et: ExifTool, files: FixtureFile[]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'steck-write-'))
  const dir = join(root, 'photos')
  await mkdir(dir)
  for (const f of files) {
    const dest = join(dir, ...f.name.split('/'))
    await mkdir(dirname(dest), { recursive: true })
    if (f.src === STUB) await writeFile(dest, STUB_XMP)
    else await copyFile(f.src, dest)
    if (/\.xmp$/i.test(f.name) && !f.tags) continue
    await runRaw(et, [
      '-overwrite_original',
      ...(/\.xmp$/i.test(f.name)
        ? []
        : [
            '-GPS:all=',
            '-XMP-exif:GPS*=',
            '-OffsetTimeOriginal=',
            '-SubSecTimeOriginal=',
            `-DateTimeOriginal=${f.wall ?? ''}`,
            ...(f.wall ? [] : ['-CreateDate=']),
          ]),
      ...(f.tags ?? []),
      dest,
    ])
  }
  const h = new Harness(et, dir, join(root, 'journal'), await syntheticTrack())
  await h.load()
  return h
}
