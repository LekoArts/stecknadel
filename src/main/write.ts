import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { writesSidecar, xmpWallTime } from '@shared/effective'
import type { PhotoSummary } from '@shared/library'
import { type MatchKind, PLACED_KINDS, STATUS_LABELS, statusDetail } from '@shared/match/status'
import type { PhotoPreview, Position, PreviewInput, PreviewSnapshot } from '@shared/preview'
import type { WritingSettings } from '@shared/settings'
import { formatGeotime, formatOffset } from '@shared/time/exifDate'
import { type PhotoUtc, photoUtc, type TimeWarning } from '@shared/time/toUtc'
import type { ReportRow, WriteOutcome, WriteProgress, WriteResult } from '@shared/write'
import type { ExifTool } from 'exiftool-vendored'
import { runBatch } from './exiftool-raw'
import {
  identityOf,
  type Journal,
  type Journals,
  type JournalTarget,
  newJournalId,
} from './journal'
import { type LoadedPhoto, type Stamp, stampOf } from './library/library'
import { geotagArgs, geotimeCsv, type PreviewContext, type PreviewEngine } from './preview'
import { errorsByFile, normPath, readAffected, readPositions, samePosition } from './tags'

export interface WriteHooks {
  /** Test-only: alters the position a target is verified against. */
  expected?: (id: string, position: Position) => Position
  /** Test-only: runs right before the geotag batch starts. */
  beforeBatch?: (files: string[]) => void
}

export interface WriteDeps {
  et: ExifTool
  preview: PreviewEngine
  journals: Journals
  resolve: (id: string) => LoadedPhoto
  /** The current preview context (photos, track, options), or null without photos or track. */
  context: () => PreviewContext | null
  writing: () => WritingSettings
  onProgress?: (progress: WriteProgress) => void
  hooks?: WriteHooks
}

const SKIPPED: ReadonlySet<MatchKind> = new Set(['has-gps', 'excluded', 'no-capture-time'])

const WARNING_TEXT: Record<TimeWarning, string> = {
  'offset-conflict': "The offset saved in the photo differs from the camera's time zone",
  'ambiguous-local-time': 'The capture time falls in a clock change, so it could be either hour',
}

type Resolved = Extract<PhotoUtc, { source: string }>

interface Target {
  loaded: LoadedPhoto
  photo: PhotoSummary
  preview: PhotoPreview
  name: string
  kind: 'photo' | 'sidecar'
  path: string
  existed: boolean
  utc: Resolved | null
  warnings: string[]
  oto: string | null
  xmpDto: string | null
  error: string | null
}

const nameOf = (p: PhotoSummary): string => (p.relDir ? `${p.relDir}/${p.name}` : p.name)

const sameStamp = (a: Stamp | null, b: Stamp | null): boolean =>
  a === null || b === null ? a === b : a.size === b.size && a.mtimeMs === b.mtimeMs

function sameResults(a: PreviewSnapshot, b: PreviewSnapshot): boolean {
  if (a.results.length !== b.results.length) return false
  return a.results.every((r, i) => {
    const o = b.results[i]
    return (
      r.id === o.id &&
      JSON.stringify(r.status) === JSON.stringify(o.status) &&
      JSON.stringify(r.position) === JSON.stringify(o.position)
    )
  })
}

const sameWriting = (a: WritingSettings, b: WritingSettings): boolean =>
  JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort())

async function allSettled<T>(tasks: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(tasks)
}

/** Below this many files per process, a chunk's startup cost outweighs the split. */
const MIN_CHUNK = 25

function chunked<T>(items: T[], procs: number): T[][] {
  const size = Math.max(MIN_CHUNK, Math.ceil(items.length / Math.max(1, procs)))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Writes the confirmed preview into the files: one geotag batch with the preview's exact GPX,
 * CSV and arguments, a write per manual placement, then a read-back of every target. One write
 * runs at a time; every target's previous values are journaled before anything is touched.
 */
export class Writer {
  private busy = false

  constructor(private readonly deps: WriteDeps) {}

  async write(generation: number, confirmedWriting: WritingSettings): Promise<WriteResult> {
    if (this.busy) throw new Error('A write is already running')
    this.busy = true
    try {
      return await this.run(generation, confirmedWriting)
    } finally {
      this.busy = false
    }
  }

  private async run(generation: number, confirmedWriting: WritingSettings): Promise<WriteResult> {
    const { et, preview, journals } = this.deps
    const started = performance.now()
    const stale = (reason: string): WriteResult => ({ kind: 'stale', reason })
    const progress = (phase: WriteProgress['phase'], done: number, total: number): void =>
      this.deps.onProgress?.({ phase, done, total })

    const input = preview.confirmed(generation)
    const confirmed = preview.snapshot
    if (!input || !confirmed) return stale('The preview changed since you confirmed it.')
    const writing = this.deps.writing()
    if (!sameWriting(writing, confirmedWriting))
      return stale('The writing options changed since you confirmed them.')
    const ctx = this.deps.context()
    if (!ctx) return stale('The photos or the track are no longer loaded.')
    progress('checking', 0, 1)
    // The confirmed inputs against the current settings, track and files: any difference
    // means the user would get something other than what they saw.
    const rerun = await preview.run(input, ctx)
    if (!rerun || !sameResults(rerun, confirmed))
      return stale('The preview changed since you confirmed it.')
    const gpx = preview.gpx
    if (!gpx) return stale('The track is no longer loaded.')

    const byId = new Map(ctx.photos.map((p) => [p.id, p]))
    const rows = new Map<string, ReportRow>()
    const targets: Target[] = []
    for (const result of rerun.results) {
      const photo = byId.get(result.id) as PhotoSummary
      const name = nameOf(photo)
      const kind = result.status.kind
      if (!PLACED_KINDS.has(kind)) {
        rows.set(result.id, {
          id: result.id,
          name,
          outcome: SKIPPED.has(kind) ? 'skipped' : 'unmatched',
          status: kind,
          reason: statusDetail(result.status) ?? STATUS_LABELS[kind],
          warnings: [],
          target: null,
          written: null,
        })
        continue
      }
      targets.push(this.target(result, photo, input, writing))
    }

    // Changed on disk since the folder was read: the preview no longer describes the file.
    await Promise.all(
      targets.map(async (t) => {
        const { photo: before, sidecar } = t.loaded.stamps
        const nowPhoto = await stampOf(t.loaded.file.path)
        const nowSidecar = t.kind === 'sidecar' ? await stampOf(t.path) : null
        const sidecarOk = t.kind !== 'sidecar' || sameStamp(t.existed ? sidecar : null, nowSidecar)
        if (!sameStamp(before, nowPhoto) || !sidecarOk) t.error = 'changed since preview'
      }),
    )
    const live = targets.filter((t) => t.error === null)

    // The journal comes first: if it can't be written, nothing is touched.
    const values = await readAffected(
      et,
      live.filter((t) => t.existed).map((t) => t.path),
    )
    const journal: Journal = {
      version: 1,
      id: newJournalId(),
      createdAt: Date.now(),
      state: 'pending',
      backups: writing.backups,
      targets: live.map(
        (t): JournalTarget => ({
          photoId: t.loaded.id,
          name: t.name,
          path: t.path,
          kind: t.kind,
          existed: t.existed,
          values: t.existed ? (values.get(normPath(t.path)) ?? {}) : {},
          after: null,
        }),
      ),
    }
    try {
      await journals.save(journal)
    } catch (e) {
      throw new Error(
        `Nothing was written: the recovery journal could not be saved (${(e as Error).message})`,
      )
    }

    try {
      await this.createSidecars(live)
      const total = live.length
      progress('writing', 0, total)
      const overwrite = writing.backups ? [] : ['-overwrite_original']
      const geotag = live.filter((t) => t.error === null && t.preview.status.kind !== 'manual')
      const manual = live.filter((t) => t.error === null && t.preview.status.kind === 'manual')
      await this.geotag(geotag, gpx, ctx, overwrite, (n) => progress('writing', n, total))
      await this.placeManual(manual, overwrite)
      progress('writing', total, total)
    } finally {
      await removeTempFiles(live.map((t) => t.path))
    }

    progress('verifying', 0, live.length)
    const positions = await readPositions(et, live)
    for (const t of live) {
      const written = positions.get(normPath(t.path)) ?? null
      const expectedRaw = t.preview.position as Position
      const expected = this.deps.hooks?.expected?.(t.loaded.id, expectedRaw) ?? expectedRaw
      let outcome: WriteOutcome = 'written'
      let reason: string | null = null
      if (t.error && !samePosition(written, expected)) {
        outcome = 'failed'
        reason = t.error
      } else if (!samePosition(written, expected)) {
        outcome = 'failed'
        reason = 'verification mismatch'
      }
      rows.set(t.loaded.id, {
        id: t.loaded.id,
        name: t.name,
        outcome,
        status: t.preview.status.kind,
        reason,
        warnings: t.warnings,
        target: t.kind,
        written,
      })
    }
    for (const t of targets) {
      if (rows.has(t.loaded.id)) continue
      rows.set(t.loaded.id, {
        id: t.loaded.id,
        name: t.name,
        outcome: 'failed',
        status: t.preview.status.kind,
        reason: t.error,
        warnings: t.warnings,
        target: t.kind,
        written: null,
      })
    }

    for (const jt of journal.targets) jt.after = await identityOf(jt.path)
    journal.state = 'done'
    await journals.save(journal)

    const ordered = rerun.results.map((r) => rows.get(r.id) as ReportRow)
    const counts: Record<WriteOutcome, number> = { written: 0, skipped: 0, unmatched: 0, failed: 0 }
    for (const r of ordered) counts[r.outcome] += 1
    progress('verifying', live.length, live.length)
    return {
      kind: 'done',
      report: {
        writeId: live.length > 0 ? journal.id : null,
        rows: ordered,
        counts,
        durationMs: Math.round(performance.now() - started),
      },
    }
  }

  /** Where a placed photo's coordinates go, and which offset (if any) goes with them. */
  private target(
    result: PhotoPreview,
    photo: PhotoSummary,
    input: PreviewInput,
    writing: WritingSettings,
  ): Target {
    const loaded = this.deps.resolve(photo.id)
    const sidecar = writesSidecar(photo, writing.rawTarget)
    const file = loaded.file
    const path = sidecar
      ? (file.sidecarPath ??
        join(dirname(file.path), `${basename(file.name, extname(file.name))}.xmp`))
      : file.path
    const settings = input.cameras[photo.cameraKey]
    const time = settings ? photoUtc(photo, settings) : null
    const utc = time?.source ? time : null
    const warnings = (time?.warnings ?? []).map((w) => WARNING_TEXT[w])
    let oto: string | null = null
    let xmpDto: string | null = null
    if (writing.writeOffsetTime && utc && photo.offsetTimeOriginal === null) {
      const suffix = formatOffset(utc.offsetSeconds)
      if (!sidecar) oto = suffix
      else if (file.sidecarPath) {
        const existing = loaded.summary.sidecar?.dateTimeOriginal ?? null
        xmpDto = this.sidecarDate(existing, photo, suffix, warnings)
      } else {
        // Filled in once the sidecar exists: `exiftool -o` copies the RAW's date into it.
        xmpDto = suffix
      }
    }
    return {
      loaded,
      photo,
      preview: result,
      name: nameOf(photo),
      kind: sidecar ? 'sidecar' : 'photo',
      path,
      existed: !sidecar || file.sidecarPath !== null,
      utc,
      warnings,
      oto,
      xmpDto,
      error: null,
    }
  }

  /**
   * The sidecar's `DateTimeOriginal` with the offset appended: its own text verbatim when it has
   * one (fraction kept), else the RAW's wall time. Null (with a warning) when the two disagree.
   */
  private sidecarDate(
    existing: string | null,
    photo: PhotoSummary,
    suffix: string,
    warnings: string[],
  ): string | null {
    const raw = photo.captureTime
    if (!raw) return null
    if (existing === null || existing.trim() === '')
      return `${raw}${photo.subSec ? `.${photo.subSec}` : ''}${suffix}`
    if (xmpWallTime(existing) !== raw) {
      warnings.push(`sidecar capture time differs from RAW (${existing.trim()} vs ${raw})`)
      return null
    }
    return `${existing.trim()}${suffix}`
  }

  /** Creates the missing sidecars from their RAWs (`exiftool -o`), then fills in their dates. */
  private async createSidecars(targets: Target[]): Promise<void> {
    const fresh = targets.filter((t) => !t.existed)
    if (fresh.length === 0) return
    const { et } = this.deps
    const results = await allSettled(
      fresh.map((t) => runBatch(et, ['-o', t.path, t.loaded.file.path])),
    )
    results.forEach((r, i) => {
      const t = fresh[i]
      const message =
        r.status === 'rejected'
          ? (r.reason as Error).message
          : r.value.messages.find((m) => /^error/i.test(m))
      if (message) t.error = message.replace(/^error:\s*/i, '')
    })
    const created = fresh.filter((t) => t.error === null && t.xmpDto !== null)
    if (created.length === 0) return
    const dates = await readAffected(
      et,
      created.map((t) => t.path),
    )
    for (const t of created) {
      const dto = dates.get(normPath(t.path))?.['XMP-exif:DateTimeOriginal']
      t.xmpDto = this.sidecarDate(
        dto === undefined ? null : String(dto),
        t.photo,
        t.xmpDto as string,
        t.warnings,
      )
    }
  }

  private async geotag(
    targets: Target[],
    gpx: string,
    ctx: PreviewContext,
    overwrite: string[],
    onDone: (n: number) => void,
  ): Promise<void> {
    if (targets.length === 0) return
    const { et } = this.deps
    const dir = await mkdtemp(join(tmpdir(), 'stecknadel-write-'))
    try {
      const csv = join(dir, 'geotime.csv')
      await writeFile(
        csv,
        geotimeCsv(
          targets.map((t) => ({
            file: t.path,
            geotime: t.utc ? formatGeotime(t.utc.utc) : '',
            oto: t.oto,
            xmpDto: t.xmpDto,
          })),
        ),
      )
      const args = [
        ...overwrite,
        // A track point without altitude must not leave a stale one next to new coordinates.
        '-GPSAltitude=',
        '-GPSAltitudeRef=',
        ...geotagArgs(csv, gpx, ctx.options.limits),
      ]
      this.deps.hooks?.beforeBatch?.(targets.map((t) => t.path))
      let done = 0
      const chunks = chunked(targets, et.options.maxProcs)
      await allSettled(
        chunks.map(async (chunk) => {
          const paths = chunk.map((t) => t.path)
          try {
            const { messages } = await runBatch(et, [...args, ...paths])
            const errors = errorsByFile(messages, paths)
            for (const t of chunk) t.error = errors.get(t.path) ?? null
          } catch (e) {
            for (const t of chunk) t.error = (e as Error).message
          }
          done += chunk.length
          onDone(done)
        }),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Manual placements: the user's coordinates, written directly, signed (`Tag*=`). */
  private async placeManual(targets: Target[], overwrite: string[]): Promise<void> {
    const { et } = this.deps
    await allSettled(
      targets.map(async (t) => {
        const p = t.preview.position as Position
        const args = [
          ...overwrite,
          `-GPSLatitude*=${p.lat}`,
          `-GPSLongitude*=${p.lon}`,
          ...(p.ele === null ? ['-GPSAltitude=', '-GPSAltitudeRef='] : [`-GPSAltitude*=${p.ele}`]),
          ...(t.oto ? [`-ExifIFD:OffsetTimeOriginal=${t.oto}`] : []),
          ...(t.xmpDto ? [`-XMP-exif:DateTimeOriginal=${t.xmpDto}`] : []),
          t.path,
        ]
        try {
          const { messages } = await runBatch(et, args)
          t.error = errorsByFile(messages, [t.path]).get(t.path) ?? null
        } catch (e) {
          t.error = (e as Error).message
        }
      }),
    )
  }
}

/** Deletes `<target>_exiftool_tmp` leftovers of these targets only. */
export async function removeTempFiles(paths: string[]): Promise<void> {
  const byDir = new Map<string, Set<string>>()
  for (const p of paths) {
    const set = byDir.get(dirname(p)) ?? new Set<string>()
    set.add(`${basename(p)}_exiftool_tmp`)
    byDir.set(dirname(p), set)
  }
  await Promise.all(
    [...byDir].map(async ([dir, names]) => {
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        return
      }
      await Promise.all(
        entries.filter((e) => names.has(e)).map((e) => rm(join(dir, e), { force: true })),
      )
    }),
  )
}
