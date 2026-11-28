import { appendFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NeedsConfirmation } from './backups'
import type { TagValues } from './journal'
import { normPath, readAffected } from './tags'
import {
  type FixtureFile,
  FORMATS,
  type Harness,
  harness,
  STUB,
  sha256,
} from './testing/writeHarness'

let et: ExifTool
const open: Harness[] = []

beforeAll(() => {
  et = new ExifTool({ maxProcs: 2 })
})
afterAll(async () => {
  for (const h of open) await h.dispose()
  await et.end()
})

async function make(files: FixtureFile[]): Promise<Harness> {
  const h = await harness(et, files)
  open.push(h)
  return h
}

const wall = (minutes: number): string =>
  new Date(Date.UTC(2026, 5, 1, 6, minutes))
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')
    .replaceAll('-', ':')

const affected = async (h: Harness, name: string): Promise<TagValues> =>
  (await readAffected(et, [h.path(name)])).get(normPath(h.path(name))) ?? {}

/** Equal tag sets, numbers to 1e-9 (EXIF rationals round-trip through decimals). */
function expectSameTags(actual: TagValues, expected: TagValues) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === 'number') expect(Math.abs((actual[k] as number) - v), k).toBeLessThan(1e-9)
    else expect(actual[k], k).toBe(v)
  }
}

async function written(h: Harness) {
  const { report } = await h.previewAndWrite()
  expect(report.writeId).not.toBeNull()
  return report
}

describe('restore previous values', () => {
  it('brings back exactly the pre-write GPS and offsets, for every kind of target', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'untagged.jpg', wall: wall(20) },
      {
        src: FORMATS.JPEG,
        name: 'tagged.jpg',
        wall: wall(30),
        tags: [
          '-GPSLatitude*=-33.5',
          '-GPSLongitude*=151.2',
          '-GPSAltitude*=12',
          '-OffsetTimeOriginal=+00:00',
        ],
      },
      {
        src: FORMATS.JPEG,
        name: 'both.jpg',
        wall: wall(40),
        tags: [
          '-EXIF:GPSLatitude*=10',
          '-EXIF:GPSLongitude*=20',
          '-XMP-exif:GPSLatitude=11',
          '-XMP-exif:GPSLongitude=21',
        ],
      },
      { src: FORMATS.CR3, name: 'plain.CR3', wall: wall(50) },
      {
        src: STUB,
        name: 'plain.xmp',
        wall: null,
        tags: [`-XMP-exif:DateTimeOriginal=${wall(50)}`],
      },
      { src: FORMATS.NEF, name: 'zoned.NEF', wall: wall(60 + 9 * 60) },
      {
        src: STUB,
        name: 'zoned.xmp',
        wall: null,
        tags: [`-XMP-exif:DateTimeOriginal=${wall(60 + 9 * 60)}+09:00`],
      },
      { src: FORMATS.ARW, name: 'fresh.ARW', wall: wall(70) },
    ])
    h.writing = { ...h.writing, overwriteGps: true, rawTarget: 'sidecar' }
    const names = ['untagged.jpg', 'tagged.jpg', 'both.jpg', 'plain.xmp', 'zoned.xmp']
    const before = new Map<string, TagValues>()
    for (const n of names) before.set(n, await affected(h, n))
    h.hooks.expected = (id, p) => (id === h.idOf('tagged.jpg') ? { ...p, lat: p.lat + 1 } : p)
    const report = await written(h)
    expect(report.rows.find((r) => r.name === 'tagged.jpg')?.reason).toBe('verification mismatch')
    expect((await affected(h, 'plain.xmp'))['XMP-exif:DateTimeOriginal']).toBe(`${wall(50)}+00:00`)
    expect(await readdir(h.dir)).toContain('fresh.xmp')

    const [view] = await h.recovery.list()
    expect(view).toMatchObject({
      writeId: report.writeId,
      interrupted: false,
      targets: 6,
      restorable: 6,
    })
    const result = await h.recovery.restoreValues(report.writeId as string, false)
    expect(result).toEqual({ done: 6, skipped: [] })
    for (const n of names) expectSameTags(await affected(h, n), before.get(n) as TagValues)
    expect(await affected(h, 'untagged.jpg')).toEqual({})
    expect(await readdir(h.dir)).not.toContain('fresh.xmp')
    // Nothing left to restore and no backups: the journal is gone.
    expect(await h.recovery.list()).toEqual([])
  })

  it('refuses a target edited after the write, and restores the rest', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) },
      { src: FORMATS.JPEG, name: 'b.jpg', wall: wall(30) },
    ])
    const report = await written(h)
    await appendFile(h.path('b.jpg'), Buffer.from([0]))
    const edited = await sha256(h.path('b.jpg'))
    const result = await h.recovery.restoreValues(report.writeId as string, false)
    expect(result).toEqual({ done: 1, skipped: [{ name: 'b.jpg', reason: 'changed since write' }] })
    expect(await sha256(h.path('b.jpg'))).toBe(edited)
    expect(await affected(h, 'a.jpg')).toEqual({})
  })

  it('an interrupted write needs confirmation before restoring', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) },
      { src: FORMATS.CR3, name: 'r.CR3', wall: wall(30) },
    ])
    h.writing.rawTarget = 'sidecar'
    h.hooks.beforeBatch = () => {
      throw new Error('killed')
    }
    await h.preview()
    await expect(h.write()).rejects.toThrow('killed')
    h.hooks.beforeBatch = undefined
    const [view] = await h.recovery.list()
    expect(view).toMatchObject({ interrupted: true, targets: 2 })
    const inspect = await h.recovery.inspect(view.writeId)
    expect(inspect.map((t) => t.name).sort()).toEqual(['a.jpg', 'r.CR3'])
    await expect(h.recovery.restoreValues(view.writeId, false)).rejects.toBeInstanceOf(
      NeedsConfirmation,
    )
    expect(await h.recovery.restoreValues(view.writeId, true)).toEqual({ done: 2, skipped: [] })
    expect((await readdir(h.dir)).sort()).toEqual(['a.jpg', 'r.CR3'])
  })
})

describe('a sidecar from an interrupted write', () => {
  /** Interrupts a sidecar write right before the geotag; then forgets it put the sidecar in place. */
  async function interrupted(h: Harness): Promise<string> {
    h.writing.rawTarget = 'sidecar'
    h.hooks.beforeBatch = () => {
      throw new Error('killed')
    }
    await h.preview()
    await expect(h.write()).rejects.toThrow('killed')
    h.hooks.beforeBatch = undefined
    const [view] = await h.recovery.list()
    const journal = await h.journals.get(view.writeId)
    if (!journal) throw new Error('no journal')
    // As if the crash came between journaling the new sidecar and recording it in place.
    for (const t of journal.targets) t.owned = false
    await h.journals.save(journal)
    return view.writeId
  }

  it('is deleted while it is exactly what the write created', async () => {
    const h = await make([{ src: FORMATS.CR3, name: 'r.CR3', wall: wall(30) }])
    const id = await interrupted(h)
    expect(await h.recovery.restoreValues(id, true)).toEqual({ done: 1, skipped: [] })
    expect(await readdir(h.dir)).toEqual(['r.CR3'])
  })

  it('is kept when another file took its path', async () => {
    const h = await make([{ src: FORMATS.CR3, name: 'r.CR3', wall: wall(30) }])
    const id = await interrupted(h)
    await writeFile(h.path('r.xmp'), 'someone else')
    await h.recovery.restoreValues(id, true)
    expect((await readdir(h.dir)).sort()).toEqual(['r.CR3', 'r.xmp'])
  })
})

describe('backups', () => {
  it('off by default: no _original files', async () => {
    const h = await make([{ src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) }])
    await written(h)
    expect(await readdir(h.dir)).toEqual(['a.jpg'])
  })

  it('on: lists only journaled backups, cleans up exactly those', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) },
      { src: FORMATS.JPEG, name: 'b.jpg', wall: wall(30) },
    ])
    h.writing.backups = true
    await writeFile(h.path('other.jpg_original'), 'stray')
    const report = await written(h)
    // b's backup replaced by a symlink: not managed.
    await rm(h.path('b.jpg_original'))
    await symlink(h.path('other.jpg_original'), h.path('b.jpg_original'))
    const [view] = await h.recovery.list()
    expect(view.backups.count).toBe(1)
    expect(await h.recovery.cleanupBackups(report.writeId as string)).toEqual({
      done: 1,
      skipped: [],
    })
    expect((await readdir(h.dir)).sort()).toEqual([
      'a.jpg',
      'b.jpg',
      'b.jpg_original',
      'other.jpg_original',
    ])
  })

  it('restore values, then restore originals: back to the pre-write bytes; an edit in between refuses', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) },
      { src: FORMATS.JPEG, name: 'b.jpg', wall: wall(30) },
    ])
    h.writing.backups = true
    const pre = [await sha256(h.path('a.jpg')), await sha256(h.path('b.jpg'))]
    const report = await written(h)
    const id = report.writeId as string
    expect(await h.recovery.restoreValues(id, false)).toEqual({ done: 2, skipped: [] })
    await appendFile(h.path('b.jpg'), Buffer.from([0]))
    const result = await h.recovery.restoreOriginals(id, false)
    expect(result).toEqual({ done: 1, skipped: [{ name: 'b.jpg', reason: 'changed since write' }] })
    expect(await sha256(h.path('a.jpg'))).toBe(pre[0])
    expect(await readdir(h.dir)).not.toContain('a.jpg_original')
    expect(await readdir(h.dir)).toContain('b.jpg_original')
  })

  it('sidecars: an existing one comes back, a created one goes, with its stub backup', async () => {
    const h = await make([
      { src: FORMATS.CR3, name: 'old.CR3', wall: wall(20) },
      { src: STUB, name: 'old.xmp', wall: null, tags: ['-XMP-dc:Title=Mine'] },
      { src: FORMATS.RAF, name: 'new.RAF', wall: wall(30) },
    ])
    h.writing = { ...h.writing, rawTarget: 'sidecar', backups: true }
    const pre = await sha256(h.path('old.xmp'))
    const report = await written(h)
    expect((await readdir(h.dir)).sort()).toEqual([
      'new.RAF',
      'new.xmp',
      'new.xmp_original',
      'old.CR3',
      'old.xmp',
      'old.xmp_original',
    ])
    expect(await h.recovery.restoreOriginals(report.writeId as string, false)).toEqual({
      done: 2,
      skipped: [],
    })
    expect((await readdir(h.dir)).sort()).toEqual(['new.RAF', 'old.CR3', 'old.xmp'])
    expect(await sha256(h.path('old.xmp'))).toBe(pre)
    expect(await h.recovery.list()).toEqual([])
  })

  it('after 30 days the values expire, the backups stay listed and cleanable', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) },
      { src: FORMATS.CR3, name: 'r.CR3', wall: wall(30) },
      { src: STUB, name: 'r.xmp', wall: null },
    ])
    h.writing = { ...h.writing, rawTarget: 'sidecar', backups: true }
    const report = await written(h)
    h.now += 31 * 86_400_000
    const [view] = await h.recovery.list()
    expect(view).toMatchObject({ restorable: 0, backups: { count: 2 } })
    expect(await h.recovery.cleanupBackups(report.writeId as string)).toEqual({
      done: 2,
      skipped: [],
    })
    expect((await readdir(h.dir)).sort()).toEqual(['a.jpg', 'r.CR3', 'r.xmp'])
    expect(await h.recovery.list()).toEqual([])
  })

  it('a write whose files are gone shows them missing and can be dismissed', async () => {
    const h = await make([{ src: FORMATS.JPEG, name: 'a.jpg', wall: wall(20) }])
    const report = await written(h)
    await rm(h.path('a.jpg'))
    const [view] = await h.recovery.list()
    expect(view.missing).toBe(1)
    await h.recovery.dismiss(report.writeId as string)
    expect(await h.recovery.list()).toEqual([])
  })
})
