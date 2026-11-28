import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEG_TOLERANCE, ELE_TOLERANCE, expectedMatch, readGpxPoints } from '@oracle/expected'
import type { Position } from '@shared/preview'
import type { WriteReport } from '@shared/write'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runRaw } from './exiftool-raw'
import { normPath, readPositions } from './tags'
import {
  FIXTURES,
  type FixtureFile,
  FORMATS,
  type Harness,
  harness,
  STUB,
  sha256,
} from './testing/writeHarness'

let et: ExifTool
let oracle: ReturnType<typeof readGpxPoints>
const open: Harness[] = []

beforeAll(async () => {
  et = new ExifTool({ maxProcs: 4 })
  oracle = readGpxPoints(await readFile(join(FIXTURES, 'synthetic-trip.gpx'), 'utf8'))
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

/** Minutes after 06:00Z on day 1 (a moving segment of the synthetic trip), as a wall time. */
const wallAt = (minutes: number): string => {
  const d = new Date(Date.UTC(2026, 5, 1, 6, minutes))
  return d.toISOString().slice(0, 19).replace('T', ' ').replaceAll('-', ':')
}
const utcOfWall = (wall: string, offsetHours = 0): number =>
  Date.parse(`${wall.slice(0, 10).replaceAll(':', '-')}T${wall.slice(11)}Z`) / 1000 -
  offsetHours * 3600

const row = (report: WriteReport, id: string) => report.rows.find((r) => r.id === id)

function expectNear(
  actual: Position | null | undefined,
  want: { lat: number; lon: number; ele?: number },
) {
  expect(actual).toBeTruthy()
  const a = actual as Position
  expect(Math.abs(a.lat - want.lat)).toBeLessThan(DEG_TOLERANCE)
  expect(Math.abs(a.lon - want.lon)).toBeLessThan(DEG_TOLERANCE)
  if (want.ele === undefined) expect(a.ele).toBeNull()
  else expect(Math.abs((a.ele as number) - want.ele)).toBeLessThan(ELE_TOLERANCE)
}

const tag = async (path: string, name: string): Promise<string | number | undefined> => {
  const { stdout } = await runRaw(et, ['-j', '-n', '-G1', '-a', `-${name}`, path])
  return (JSON.parse(stdout) as Record<string, string | number>[])[0][name]
}

const validateWarnings = async (path: string): Promise<string[]> => {
  const { stdout } = await runRaw(et, ['-validate', '-warning', '-a', '-s3', path])
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[?\d+ (Warnings?|errors?)/i.test(l) && l !== 'OK')
}

describe('in-file writes', () => {
  it('writes every format: GPS equals the oracle and the preview, offsets filled or kept', async () => {
    const formats = Object.entries(FORMATS)
    const files: FixtureFile[] = formats.map(([format, src], i) => ({
      src,
      name: `${format}${src.slice(src.lastIndexOf('.'))}`,
      wall: wallAt(30 + i * 10),
    }))
    // An X-T5-like JPEG: it saved -07:00, which differs from the camera's (UTC) zone.
    files.push({
      src: FORMATS.JPEG,
      name: 'recorded.jpg',
      // Saved -07:00: UTC 08:00 on the moving segment.
      wall: wallAt(-300),
      tags: ['-OffsetTimeOriginal=-07:00'],
    })
    const h = await make(files)
    const before = new Map<string, string[]>()
    for (const f of files) before.set(f.name, await validateWarnings(h.path(f.name)))

    const { snap, report } = await h.previewAndWrite()
    expect(report.counts).toEqual({ written: files.length, skipped: 0, unmatched: 0, failed: 0 })

    for (const f of files.slice(0, formats.length)) {
      const id = h.idOf(f.name)
      const want = expectedMatch(oracle, utcOfWall(f.wall as string))
      if (!want) throw new Error('oracle has no match')
      const written = row(report, id)?.written
      expectNear(written, want)
      const preview = snap.results.find((r) => r.id === id)?.position
      expect(Math.abs((written as Position).lat - (preview as Position).lat)).toBeLessThanOrEqual(
        1e-6,
      )
      // Read again, independently of the writer's own read-back.
      const again = (await readPositions(et, [{ path: h.path(f.name), kind: 'photo' }])).get(
        normPath(h.path(f.name)),
      )
      expectNear(again, want)
      expect(await tag(h.path(f.name), 'ExifIFD:OffsetTimeOriginal')).toBe('+00:00')
      expect(await validateWarnings(h.path(f.name))).toEqual(before.get(f.name))
    }

    const recorded = h.idOf('recorded.jpg')
    expect(await tag(h.path('recorded.jpg'), 'ExifIFD:OffsetTimeOriginal')).toBe('-07:00')
    expect(row(report, recorded)?.warnings.join()).toMatch(/offset saved in the photo differs/)
    const want = expectedMatch(oracle, utcOfWall(files.at(-1)?.wall as string, -7))
    expectNear(row(report, recorded)?.written, want as Position & { ele: number })
    expect(await readdir(h.dir)).not.toContain(expect.stringMatching(/_original$|_exiftool_tmp$/))
  })

  it('skips photos with GPS unless overwriting; leaves unmatched photos byte-identical', async () => {
    const h = await make([
      {
        src: FORMATS.JPEG,
        name: 'gps.jpg',
        wall: wallAt(40),
        tags: ['-GPSLatitude*=10', '-GPSLongitude*=20'],
      },
      { src: FORMATS.JPEG, name: 'gap.jpg', wall: '2026:06:01 22:00:00' },
      { src: FORMATS.JPEG, name: 'notime.jpg', wall: null },
      { src: FORMATS.CR3, name: 'before.CR3', wall: '2026:05:30 12:00:00' },
    ])
    h.writing.rawTarget = 'sidecar'
    const shas = new Map<string, string>()
    for (const n of ['gps.jpg', 'gap.jpg', 'notime.jpg', 'before.CR3'])
      shas.set(n, await sha256(h.path(n)))
    const { report } = await h.previewAndWrite()
    expect(report.counts).toEqual({ written: 0, skipped: 2, unmatched: 2, failed: 0 })
    expect(report.writeId).toBeNull()
    for (const [n, s] of shas) expect(await sha256(h.path(n))).toBe(s)
    expect((await readdir(h.dir)).sort()).toEqual([
      'before.CR3',
      'gap.jpg',
      'gps.jpg',
      'notime.jpg',
    ])

    h.writing.overwriteGps = true
    const second = await h.previewAndWrite()
    const gps = row(second.report, h.idOf('gps.jpg'))
    expect(gps?.outcome).toBe('written')
    expectNear(
      gps?.written,
      expectedMatch(oracle, utcOfWall(wallAt(40))) as Position & { ele: number },
    )
  })

  it('writes the altitude of the matched point and clears a stale one, in one batch', async () => {
    const h = await make([
      {
        src: FORMATS.JPEG,
        name: 'noalt.jpg',
        wall: '2026:06:01 07:30:00',
        tags: ['-GPSAltitude*=999'],
      },
      { src: FORMATS.CR3, name: 'noalt.CR3', wall: '2026:06:01 07:40:00' },
      { src: STUB, name: 'noalt.xmp', wall: null, tags: ['-XMP-exif:GPSAltitude=999'] },
      {
        src: FORMATS.JPEG,
        name: 'alt.jpg',
        wall: '2026:06:01 09:45:00',
        tags: ['-GPSAltitude*=999'],
      },
      { src: FORMATS.JPEG, name: 'manual.jpg', wall: null, tags: ['-GPSAltitude*=999'] },
    ])
    // Points before 09:00Z lose their altitude (ExifTool borrows altitude from fixes up to
    // GeoMaxIntSecs away, so the photos without one sit well before that).
    h.track = {
      ...h.track,
      points: h.track.points.map((p) =>
        p.t < Date.parse('2026-06-01T09:00:00Z') / 1000 ? { t: p.t, lat: p.lat, lon: p.lon } : p,
      ),
    }
    h.writing.rawTarget = 'sidecar'
    h.writing.overwriteGps = true
    h.manual = { [h.idOf('manual.jpg')]: { lat: 46.6, lon: 7.95, ele: null } }
    const { snap, report } = await h.previewAndWrite()
    expect(report.counts.failed).toBe(0)
    for (const n of ['noalt.jpg', 'noalt.CR3', 'manual.jpg']) {
      const r = row(report, h.idOf(n))
      expect(r?.outcome).toBe('written')
      expect(r?.written?.ele).toBeNull()
    }
    expect(await tag(h.path('noalt.xmp'), 'XMP-exif:GPSAltitude')).toBeUndefined()
    expect(await tag(h.path('noalt.jpg'), 'GPS:GPSAltitude')).toBeUndefined()
    const alt = row(report, h.idOf('alt.jpg'))
    const want = expectedMatch(oracle, utcOfWall('2026:06:01 09:45:00'))
    expect(want?.ele).toBeDefined()
    expectNear(alt?.written, want as Position & { ele: number })
    expect(alt?.written?.ele).toBeCloseTo(
      snap.results.find((r) => r.id === alt?.id)?.position?.ele as number,
      2,
    )
  })
})

describe('sidecar mode', () => {
  it('leaves RAWs byte-identical and writes GPS and the offset into the sidecar', async () => {
    const h = await make([
      { src: FORMATS.CR3, name: 'fresh.CR3', wall: wallAt(30) },
      { src: FORMATS.NEF, name: 'keeps.NEF', wall: wallAt(40) },
      {
        src: STUB,
        name: 'keeps.xmp',
        wall: null,
        tags: ['-XMP-dc:Title=Keep me', '-XMP-exif:DateTimeOriginal=2026:06:01 06:40:00.47'],
      },
      { src: FORMATS.ARW, name: 'zoned.ARW', wall: wallAt(50 + 9 * 60) },
      {
        src: STUB,
        name: 'zoned.xmp',
        wall: null,
        tags: [`-XMP-exif:DateTimeOriginal=${wallAt(50 + 9 * 60)}+09:00`],
      },
      { src: FORMATS.RAF, name: 'differs.RAF', wall: wallAt(60) },
      {
        src: STUB,
        name: 'differs.xmp',
        wall: null,
        tags: ['-XMP-exif:DateTimeOriginal=2020:01:01 00:00:00'],
      },
      { src: FORMATS.DNG, name: 'hand.DNG', wall: null },
      { src: FORMATS.CR3, name: 'gpsside.CR3', wall: wallAt(70) },
      {
        src: STUB,
        name: 'gpsside.xmp',
        wall: null,
        tags: ['-XMP-exif:GPSLatitude=1', '-XMP-exif:GPSLongitude=2'],
      },
      { src: FORMATS.CR3, name: 'twin.CR3', wall: wallAt(80) },
      { src: FORMATS.DNG, name: 'twin.DNG', wall: wallAt(80) },
    ])
    h.writing.rawTarget = 'sidecar'
    h.manual = { [h.idOf('hand.DNG')]: { lat: 46.55, lon: 7.91, ele: 1200 } }
    const raws = [
      'fresh.CR3',
      'keeps.NEF',
      'zoned.ARW',
      'differs.RAF',
      'hand.DNG',
      'gpsside.CR3',
      'twin.CR3',
      'twin.DNG',
    ]
    const shas = new Map<string, string>()
    for (const n of raws) shas.set(n, await sha256(h.path(n)))
    const sidecarSha = await sha256(h.path('gpsside.xmp'))

    const { snap, report } = await h.previewAndWrite()
    for (const [n, s] of shas) expect(await sha256(h.path(n)), n).toBe(s)

    const fresh = row(report, h.idOf('fresh.CR3'))
    expect(fresh).toMatchObject({ outcome: 'written', target: 'sidecar' })
    expectNear(
      fresh?.written,
      expectedMatch(oracle, utcOfWall(wallAt(30))) as Position & { ele: number },
    )
    expect(await tag(h.path('fresh.xmp'), 'XMP-exif:DateTimeOriginal')).toBe(`${wallAt(30)}+00:00`)

    expect(await tag(h.path('keeps.xmp'), 'XMP-dc:Title')).toBe('Keep me')
    expect(await tag(h.path('keeps.xmp'), 'XMP-exif:DateTimeOriginal')).toBe(
      '2026:06:01 06:40:00.47+00:00',
    )

    // The +09:00 suffix is the recorded offset: the time model and the file both keep it.
    const zoned = h.idOf('zoned.ARW')
    expect(snap.results.find((r) => r.id === zoned)?.utc).toBe(utcOfWall(wallAt(50 + 9 * 60), 9))
    expect(await tag(h.path('zoned.xmp'), 'XMP-exif:DateTimeOriginal')).toBe(
      `${wallAt(50 + 9 * 60)}+09:00`,
    )
    expect(row(report, zoned)?.outcome).toBe('written')

    const differs = row(report, h.idOf('differs.RAF'))
    expect(differs?.outcome).toBe('written')
    expect(differs?.warnings).toContain(
      `sidecar capture time differs from RAW (2020:01:01 00:00:00 vs ${wallAt(60)})`,
    )
    expect(await tag(h.path('differs.xmp'), 'XMP-exif:DateTimeOriginal')).toBe(
      '2020:01:01 00:00:00',
    )

    const hand = row(report, h.idOf('hand.DNG'))
    expect(hand).toMatchObject({
      outcome: 'written',
      target: 'sidecar',
      written: { lat: 46.55, lon: 7.91, ele: 1200 },
    })

    expect(row(report, h.idOf('gpsside.CR3'))).toMatchObject({
      outcome: 'skipped',
      status: 'has-gps',
    })
    expect(await sha256(h.path('gpsside.xmp'))).toBe(sidecarSha)
    for (const n of ['twin.CR3', 'twin.DNG'])
      expect(row(report, h.idOf(n))).toMatchObject({ outcome: 'skipped', status: 'excluded' })
    expect(await readdir(h.dir)).not.toContain('twin.xmp')
  })

  it('a manually placed RAW gets GPS and the suffixed date in a new sidecar', async () => {
    const h = await make([{ src: FORMATS.CR3, name: 'm.CR3', wall: wallAt(10) }])
    h.writing.rawTarget = 'sidecar'
    h.manual = { [h.idOf('m.CR3')]: { lat: 46.5, lon: 7.9, ele: null } }
    const { report } = await h.previewAndWrite()
    expect(row(report, h.idOf('m.CR3'))).toMatchObject({ outcome: 'written', target: 'sidecar' })
    expect(await tag(h.path('m.xmp'), 'XMP-exif:DateTimeOriginal')).toBe(`${wallAt(10)}+00:00`)
    expect(await tag(h.path('m.xmp'), 'XMP-exif:GPSLatitude')).toBe(46.5)
  })
})

describe('safety', () => {
  it('a file changed between confirm and write fails as changed since preview, untouched', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wallAt(30) },
      { src: FORMATS.JPEG, name: 'b.jpg', wall: wallAt(40) },
    ])
    await h.preview()
    await writeFile(
      h.path('b.jpg'),
      Buffer.concat([await readFile(h.path('b.jpg')), Buffer.from([0])]),
    )
    const edited = await sha256(h.path('b.jpg'))
    const result = await h.write()
    if (result.kind !== 'done') throw new Error(result.reason)
    expect(row(result.report, h.idOf('b.jpg'))).toMatchObject({
      outcome: 'failed',
      reason: 'changed since preview',
    })
    expect(await sha256(h.path('b.jpg'))).toBe(edited)
    expect(row(result.report, h.idOf('a.jpg'))?.outcome).toBe('written')
  })

  it('a setting changed after confirming aborts with nothing modified', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: '2026:06:01 11:30:00' },
      { src: FORMATS.JPEG, name: 'b.jpg', wall: wallAt(40) },
    ])
    const shas = [await sha256(h.path('a.jpg')), await sha256(h.path('b.jpg'))]
    await h.preview()
    h.limits = { geoMaxIntSecs: 60 * 60 * 4, geoMaxExtSecs: 1800 }
    expect(await h.write()).toMatchObject({ kind: 'stale' })
    h.limits = { geoMaxIntSecs: 1800, geoMaxExtSecs: 1800 }
    await h.preview()
    expect(await h.write({ ...h.writing, backups: true })).toMatchObject({ kind: 'stale' })
    expect([await sha256(h.path('a.jpg')), await sha256(h.path('b.jpg'))]).toEqual(shas)
    expect(await readdir(h.journalDir).catch(() => [])).toEqual([])
  })

  it('a read-only target fails with the ExifTool error; the others are written', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'ok.jpg', wall: wallAt(30) },
      { src: FORMATS.JPEG, name: 'locked/ro.jpg', wall: wallAt(40) },
    ])
    await h.preview()
    const locked = join(h.dir, 'locked')
    await chmod(h.path('locked/ro.jpg'), 0o444)
    if (process.platform !== 'win32') await chmod(locked, 0o555)
    try {
      const result = await h.write()
      if (result.kind !== 'done') throw new Error(result.reason)
      const ro = row(result.report, h.idOf('locked/ro.jpg'))
      expect(ro?.outcome).toBe('failed')
      expect(ro?.reason).toBeTruthy()
      expect(ro?.reason).not.toBe('verification mismatch')
      expect(row(result.report, h.idOf('ok.jpg'))?.outcome).toBe('written')
    } finally {
      await chmod(locked, 0o755)
      await chmod(h.path('locked/ro.jpg'), 0o644)
    }
  })

  it('a forced verification mismatch is reported as such', async () => {
    const h = await make([{ src: FORMATS.JPEG, name: 'a.jpg', wall: wallAt(30) }])
    h.hooks.expected = (_id, p) => ({ ...p, lat: p.lat + 0.001 })
    const { report } = await h.previewAndWrite()
    expect(row(report, h.idOf('a.jpg'))).toMatchObject({
      outcome: 'failed',
      reason: 'verification mismatch',
    })
    expect(report.writeId).not.toBeNull()
  })

  it('a journal that cannot be saved aborts with every target untouched and no sidecar', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wallAt(30) },
      { src: FORMATS.CR3, name: 'r.CR3', wall: wallAt(40) },
    ])
    h.writing.rawTarget = 'sidecar'
    // A file where the journal folder should be: works the same on every OS.
    await writeFile(h.journalDir, 'not a folder')
    const shas = [await sha256(h.path('a.jpg')), await sha256(h.path('r.CR3'))]
    await h.preview()
    await expect(h.write()).rejects.toThrow(/Nothing was written/)
    expect([await sha256(h.path('a.jpg')), await sha256(h.path('r.CR3'))]).toEqual(shas)
    expect((await readdir(h.dir)).sort()).toEqual(['a.jpg', 'r.CR3'])
  })

  it('a file edited while the write prepares is not overwritten', async () => {
    const h = await make([
      { src: FORMATS.JPEG, name: 'a.jpg', wall: wallAt(30) },
      { src: FORMATS.JPEG, name: 'b.jpg', wall: wallAt(40) },
    ])
    let edited = ''
    h.hooks.beforeBatch = () => {
      // Synchronous: lands after the journal is saved and before the chunk's last check.
      const b = h.path('b.jpg')
      appendFileSync(b, Buffer.from([0]))
      edited = createHash('sha256').update(readFileSync(b)).digest('hex')
    }
    const { report } = await h.previewAndWrite()
    expect(row(report, h.idOf('b.jpg'))).toMatchObject({
      outcome: 'failed',
      reason: 'changed since preview',
    })
    expect(await sha256(h.path('b.jpg'))).toBe(edited)
    expect(row(report, h.idOf('a.jpg'))?.outcome).toBe('written')
  })

  it('a preview for another track requested mid-write waits until the write is done', async () => {
    const h = await make([{ src: FORMATS.JPEG, name: 'a.jpg', wall: wallAt(30) }])
    let later: Promise<unknown> | null = null
    h.hooks.beforeBatch = async () => {
      // A new track would replace (and delete) the GPX the write is geotagging with.
      h.track = { ...h.track, points: [...h.track.points] }
      later = h.preview()
      await new Promise((r) => setTimeout(r, 500))
    }
    const { report } = await h.previewAndWrite()
    expect(row(report, h.idOf('a.jpg'))?.outcome).toBe('written')
    await expect(later).resolves.toBeTruthy()
  })

  it('a symbolic link is not written through', async () => {
    const h = await make([{ src: FORMATS.JPEG, name: 'real/a.jpg', wall: wallAt(30) }])
    if (process.platform === 'win32') return // creating links needs privileges there
    await symlink(h.path('real/a.jpg'), h.path('link.jpg'))
    await h.load()
    const before = await sha256(h.path('real/a.jpg'))
    const { report } = await h.previewAndWrite()
    expect(row(report, h.idOf('link.jpg'))).toMatchObject({
      outcome: 'failed',
      reason: expect.stringMatching(/links are not written through/),
    })
    // The real file is written once, as itself.
    expect(row(report, h.idOf('real/a.jpg'))?.outcome).toBe('written')
    expect(before).not.toBe(await sha256(h.path('real/a.jpg')))
  })

  it("a sidecar the write couldn't create is never deleted by a restore", async () => {
    const h = await make([{ src: FORMATS.CR3, name: 'r.CR3', wall: wallAt(30) }])
    h.writing.rawTarget = 'sidecar'
    await h.preview()
    // Something else appears at the sidecar path (not a regular file, so the stamp check
    // can't tell): ExifTool refuses to create over it.
    await mkdir(h.path('r.xmp'))
    const result = await h.write()
    if (result.kind !== 'done') throw new Error(result.reason)
    expect(row(result.report, h.idOf('r.CR3'))?.outcome).toBe('failed')
    const id = result.report.writeId as string
    await h.recovery.restoreValues(id, false)
    expect((await stat(h.path('r.xmp'))).isDirectory()).toBe(true)
  })

  it('killing ExifTool mid-batch leaves every file untouched or fully written, no temp files', async () => {
    const files: FixtureFile[] = Array.from({ length: 500 }, (_, i) => ({
      src: FORMATS.JPEG,
      name: `k${String(i).padStart(3, '0')}.jpg`,
      wall: wallAt(10 + (i % 200)),
    }))
    const h = await make(files)
    const before = new Map<string, string>()
    for (const f of files) before.set(f.name, await sha256(h.path(f.name)))
    h.hooks.beforeBatch = () => {
      setTimeout(() => {
        for (const pid of et.pids) process.kill(pid, 'SIGKILL')
      }, 150)
    }
    const { snap, report } = await h.previewAndWrite()
    h.hooks.beforeBatch = undefined
    let written = 0
    let same = 0
    for (const f of files) {
      const p = h.path(f.name)
      if ((await sha256(p)) === before.get(f.name)) {
        same += 1
        continue
      }
      written += 1
      const { stdout } = await runRaw(et, ['-validate', '-warning', '-a', '-s3', p])
      expect(stdout.trim()).toMatch(/^OK$|^\d+ Warnings?/i)
      const id = h.idOf(f.name)
      const got = (await readPositions(et, [{ path: p, kind: 'photo' }])).get(normPath(p))
      const want = snap.results.find((r) => r.id === id)?.position as Position
      expect(Math.abs((got as Position).lat - want.lat)).toBeLessThanOrEqual(1e-6)
    }
    expect(same).toBeGreaterThan(0) // the kill landed before the batch finished
    expect(written + same).toBe(500)
    expect(report.counts.written + report.counts.failed).toBe(500)
    expect((await readdir(h.dir)).filter((n) => n.includes('_exiftool_tmp'))).toEqual([])
  }, 120_000)
})
