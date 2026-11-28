import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEG_TOLERANCE,
  ELE_TOLERANCE,
  expectedMatch,
  expectedStay,
  readGpxPoints,
} from '@oracle/expected'
import type { PhotoSummary } from '@shared/library'
import { DEFAULT_BRIDGE, DEFAULT_LIMITS } from '@shared/match/status'
import type { CameraTimeSettings } from '@shared/time/cameraSettings'
import type { Track } from '@shared/track/types'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runRaw } from './exiftool-raw'
import {
  geotagArgs,
  geotagStubs,
  geotimeCsv,
  PreviewEngine,
  readStubPositions,
  STUB_XMP,
} from './preview'
import { parseGpx } from './track/gpx'

const FIXTURES = join(__dirname, '../../test/fixtures')
const utcOf = (iso: string): number => Date.parse(iso) / 1000
const geotime = (iso: string): string =>
  `${iso.slice(0, 19).replaceAll('-', ':').replace('T', ' ')}Z`

let et: ExifTool
let dir: string
let gpxPath: string
let track: Track
let oracle: ReturnType<typeof readGpxPoints>

beforeAll(async () => {
  et = new ExifTool({ maxProcs: 1 })
  dir = await mkdtemp(join(tmpdir(), 'steck-preview-'))
  gpxPath = join(FIXTURES, 'synthetic-trip.gpx')
  const xml = await readFile(gpxPath, 'utf8')
  track = parseGpx(xml, 'synthetic-trip.gpx')
  oracle = readGpxPoints(xml)
})
afterAll(async () => {
  await et.end()
  await rm(dir, { recursive: true, force: true })
})

const id = (n: number): string => `p${n.toString(16).padStart(24, '0')}`

describe('ExifTool preview against stubs', () => {
  it('equals a real write: sidecar byte-identical, JPEG within EXIF rational precision', async () => {
    const when = '2026-06-01T07:13:17Z'
    const [stub] = (
      await geotagStubs(et, [{ id: id(1), geotime: geotime(when) }], gpxPath, DEFAULT_LIMITS)
    ).values()

    // Real write on a sidecar and on a JPEG copy, with the same CSV/GPX/args.
    const xmp = join(dir, 'real.xmp')
    const jpg = join(dir, 'real.jpg')
    await writeFile(xmp, STUB_XMP)
    await copyFile(join(FIXTURES, 'generated/smoke.jpg'), jpg)
    const csv = join(dir, 'real.csv')
    await writeFile(csv, geotimeCsv([xmp, jpg].map((file) => ({ file, geotime: geotime(when) }))))
    await runRaw(et, ['-overwrite_original', ...geotagArgs(csv, gpxPath, DEFAULT_LIMITS), xmp, jpg])

    const [sidecar] = (await readStubPositions(et, [xmp])).values()
    expect(sidecar).toEqual(stub)

    const { stdout } = await runRaw(et, [
      '-n',
      '-p',
      '$GPS:GPSLatitude\t$GPS:GPSLongitude\t$GPS:GPSAltitude',
      jpg,
    ])
    const [lat, lon, alt] = stdout.trim().split('\t').map(Number)
    // EXIF stores GPS as rationals, so the last digits can differ from the XMP decimal string.
    expect(Math.abs(lat - Number(stub?.lat))).toBeLessThan(1e-9)
    expect(Math.abs(lon - Number(stub?.lon))).toBeLessThan(1e-9)
    expect(Math.abs(alt - Number(stub?.alt))).toBeLessThan(1e-5)

    const want = expectedMatch(oracle, utcOf(when))
    expect(Math.abs(Number(stub?.lat) - (want?.lat as number))).toBeLessThan(DEG_TOLERANCE)
    expect(Math.abs(Number(stub?.lon) - (want?.lon as number))).toBeLessThan(DEG_TOLERANCE)
    expect(Math.abs(Number(stub?.alt) - (want?.ele as number))).toBeLessThan(ELE_TOLERANCE)
  })

  it('split over several processes, every photo gets the position one batch gives it', async () => {
    const start = utcOf('2026-06-01T05:30:00Z')
    const rows = Array.from({ length: 160 }, (_, n) => ({
      id: id(1000 + n),
      geotime: geotime(new Date((start + n * 240) * 1000).toISOString()),
    }))
    const pool = new ExifTool({ maxProcs: 3, minDelayBetweenSpawnMillis: 0 })
    try {
      const single = await geotagStubs(et, rows, gpxPath, DEFAULT_LIMITS)
      const split = await geotagStubs(pool, rows, gpxPath, DEFAULT_LIMITS)
      expect(split.size).toBe(160)
      expect([...single.values()].filter(Boolean).length).toBeGreaterThan(100)
      expect(Object.fromEntries(split)).toEqual(Object.fromEntries(single))
    } finally {
      await pool.end()
    }
  })

  it('a failing chunk waits for the others before the stubs are removed', async () => {
    const rows = Array.from({ length: 120 }, (_, n) => ({ id: id(2000 + n), geotime: 'x' }))
    let calls = 0
    let survivorSawItsFiles = false
    let survivorDone = false
    const fake = {
      options: { maxProcs: 2 },
      enqueueTask: async (task: () => { args: string[] }) => {
        const { args } = task()
        if (!args.includes('-geotag')) return { stdout: '', messages: [] }
        if (++calls === 1) throw new Error('chunk failed')
        await new Promise((r) => setTimeout(r, 100))
        survivorSawItsFiles = args.filter((a) => a.endsWith('.xmp')).every((f) => existsSync(f))
        survivorDone = true
        return { stdout: '', messages: [] }
      },
    } as unknown as ExifTool
    await expect(geotagStubs(fake, rows, gpxPath, DEFAULT_LIMITS)).rejects.toThrow('chunk failed')
    expect(survivorDone).toBe(true)
    expect(survivorSawItsFiles).toBe(true)
  })

  it('leaves unmatched stubs without GPS', async () => {
    const result = await geotagStubs(
      et,
      [
        { id: id(2), geotime: geotime('2026-05-31T12:00:00Z') },
        { id: id(3), geotime: geotime('2026-06-01T23:00:00Z') },
      ],
      gpxPath,
      DEFAULT_LIMITS,
    )
    expect([...result.values()]).toEqual([null, null])
  })

  it('the guard: files absent from the CSV or with an empty Geotime stay empty despite their DTO', async () => {
    // JPEGs whose DTO (read as local time) lies inside the track: without the guard ExifTool falls
    // back to it for an empty Geotime cell and geotags the file.
    const absent = join(dir, 'absent.jpg')
    const empty = join(dir, 'empty.jpg')
    for (const f of [absent, empty]) {
      await copyFile(join(FIXTURES, 'generated/smoke.jpg'), f)
      await runRaw(et, ['-overwrite_original', '-DateTimeOriginal=2026:06:01 08:00:00', f])
    }
    const other = join(dir, 'other.xmp')
    await writeFile(other, STUB_XMP)
    const csv = join(dir, 'guard.csv')
    await writeFile(
      csv,
      geotimeCsv([
        { file: other, geotime: geotime('2026-06-01T07:00:00Z') },
        { file: empty, geotime: '' },
      ]),
    )
    const lat = async (f: string) =>
      (await runRaw(et, ['-f', '-n', '-p', '$GPS:GPSLatitude', f])).stdout.trim()

    await runRaw(et, [
      '-overwrite_original',
      ...geotagArgs(csv, gpxPath, DEFAULT_LIMITS),
      other,
      absent,
      empty,
    ])
    expect(await lat(absent)).toBe('-')
    expect(await lat(empty)).toBe('-')
    expect((await readStubPositions(et, [other])).get('other.xmp')).not.toBeNull()

    // Control: without the guard the empty cell falls back to the DTO and gets coordinates.
    const unguarded = geotagArgs(csv, gpxPath, DEFAULT_LIMITS).slice(1)
    await runRaw(et, ['-overwrite_original', ...unguarded, empty])
    expect(await lat(empty)).not.toBe('-')
  })
})

describe('PreviewEngine', () => {
  const zone = (id: string): CameraTimeSettings => ({
    segments: [{ tz: { kind: 'zone', id }, driftSeconds: 0 }],
    useRecordedOffsets: true,
    confirmed: true,
  })
  const photo = (n: number, wall: string, over: Partial<PhotoSummary> = {}): PhotoSummary => ({
    id: id(n),
    name: `IMG_${n}.jpg`,
    relDir: '',
    format: 'JPEG',
    cameraKey: 'cam',
    captureTime: wall,
    subSec: null,
    offsetTimeOriginal: null,
    gps: null,
    orientation: 1,
    sidecar: null,
    sidecarCollision: false,
    readError: null,
    ...over,
  })
  // Camera on UTC (zone "UTC") so wall time = UTC.
  const photos = [
    photo(10, '2026:06:01 07:30:00'), // segment A
    photo(11, '2026:06:01 11:30:00'), // bridged stationary gap 10:00–13:00Z
    photo(12, '2026:06:01 22:00:00'), // 16 h travel gap
    photo(13, '2026:05:31 20:00:00'), // before
    photo(14, '2026:06:02 18:00:00'), // after
    photo(15, '2026:06:01 08:00:00', { gps: { latitude: 1, longitude: 2, altitude: null } }),
    photo(16, null as unknown as string, { captureTime: null }),
    photo(17, '2026:06:01 09:00:00', { cameraKey: 'other' }),
  ]
  const ctx = {
    loadId: 1,
    photos,
    get track() {
      return track
    },
    options: {
      limits: DEFAULT_LIMITS,
      bridge: DEFAULT_BRIDGE,
      overwriteGps: false,
      rawTarget: 'in-file' as const,
    },
  }

  it('classifies and positions every photo from ExifTool', async () => {
    const engine = new PreviewEngine(et)
    const snap = await engine.run(
      { generation: 1, cameras: { cam: zone('UTC'), other: zone('UTC') }, manual: {} },
      ctx,
    )
    await engine.dispose()
    expect(snap).not.toBeNull()
    const byId = new Map(snap?.results.map((r) => [r.id, r]))
    const status = (n: number) => byId.get(id(n))?.status

    expect(status(10)).toEqual({ kind: 'matched' })
    expect(status(11)).toEqual({ kind: 'matched-stay' })
    expect(status(12)?.kind).toBe('in-gap')
    expect(status(12)).toMatchObject({ gapMinutes: 960 })
    expect(status(13)?.kind).toBe('before-track')
    expect(status(14)?.kind).toBe('after-track')
    expect(status(15)).toEqual({ kind: 'has-gps' })
    expect(status(16)).toEqual({ kind: 'no-capture-time' })
    expect(status(17)).toEqual({ kind: 'matched' })

    const a = byId.get(id(10))?.position
    const wantA = expectedMatch(oracle, utcOf('2026-06-01T07:30:00Z'))
    expect(Math.abs((a?.lat as number) - (wantA?.lat as number))).toBeLessThan(DEG_TOLERANCE)
    expect(Math.abs((a?.lon as number) - (wantA?.lon as number))).toBeLessThan(DEG_TOLERANCE)
    const stay = byId.get(id(11))?.position
    const wantStay = expectedStay(oracle, utcOf('2026-06-01T11:30:00Z'))
    expect(Math.abs((stay?.lat as number) - (wantStay?.lat as number))).toBeLessThan(DEG_TOLERANCE)
    expect(Math.abs((stay?.lon as number) - (wantStay?.lon as number))).toBeLessThan(DEG_TOLERANCE)
    for (const n of [12, 13, 14, 15, 16]) expect(byId.get(id(n))?.position).toBeNull()
  })

  it('reruns only the camera whose settings changed; manual placement needs no rerun', async () => {
    const engine = new PreviewEngine(et)
    const cameras = { cam: zone('UTC'), other: zone('UTC') }
    const first = await engine.run({ generation: 1, cameras, manual: {} }, ctx)
    expect(first?.recomputed.sort()).toEqual(['cam', 'other'])
    const second = await engine.run(
      { generation: 2, cameras: { ...cameras, other: zone('Europe/Zurich') }, manual: {} },
      ctx,
    )
    expect(second?.recomputed).toEqual(['other'])
    const manual = { [id(12)]: { lat: 46.6, lon: 8.1, ele: null } }
    const third = await engine.run(
      { generation: 3, cameras: { ...cameras, other: zone('Europe/Zurich') }, manual },
      ctx,
    )
    expect(third?.recomputed).toEqual([])
    const placed = third?.results.find((r) => r.id === id(12))
    expect(placed).toMatchObject({ status: { kind: 'manual' }, position: manual[id(12)] })
    await engine.dispose()
  })

  it('drops the runs a newer request superseded', async () => {
    const engine = new PreviewEngine(et)
    const cameras = { cam: zone('UTC'), other: zone('UTC') }
    const older = engine.run({ generation: 5, cameras, manual: {} }, ctx)
    const newer = engine.run(
      { generation: 6, cameras: { ...cameras, cam: zone('Asia/Tokyo') }, manual: {} },
      ctx,
    )
    expect(await older).toBeNull()
    const snap = await newer
    expect(snap?.generation).toBe(6)
    expect(engine.snapshot?.generation).toBe(6)
    await engine.dispose()
  })

  // The engine outlives the window: closing and reopening it restarts the renderer's counter.
  it('serves a renderer whose generation counter started over', async () => {
    const engine = new PreviewEngine(et)
    const cameras = { cam: zone('UTC'), other: zone('UTC') }
    for (let generation = 1; generation <= 3; generation++) {
      expect(await engine.run({ generation, cameras, manual: {} }, ctx)).not.toBeNull()
    }
    const reopened = await engine.run({ generation: 1, cameras, manual: {} }, ctx)
    expect(reopened?.generation).toBe(1)
    await engine.dispose()
  })
})
