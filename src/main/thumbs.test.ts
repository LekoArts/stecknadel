import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ImageOps, jpegSize, rotationFor, ThumbnailCache } from './thumbs'

const fixtures = join(__dirname, '../../test/fixtures')
let et: ExifTool
let dir: string
let osCalls: string[]

/** Node has no nativeImage: "resizing" passes the embedded JPEG through, the OS thumbnailer is absent. */
const ops: ImageOps = {
  resizeJpeg: (jpeg) => jpeg,
  osThumbnail: async (file) => {
    osCalls.push(file)
    return null
  },
}

beforeAll(async () => {
  et = new ExifTool({ maxProcs: 2 })
  dir = await mkdtemp(join(tmpdir(), 'steck-thumbs-'))
})
afterAll(async () => {
  await et.end()
  await rm(dir, { recursive: true, force: true })
})

const withEmbedded = [
  'Canon-EOS-R.CR3',
  'Fujifilm-X-T4.RAF',
  'Nikon-Z6.NEF',
  'Ricoh-GR-III.DNG',
  'Sony-a7III.ARW',
  'exiftool-FujiFilm.raf',
]
const withoutEmbedded = [
  'exiftool-CanonRaw.cr3',
  'exiftool-DNG.dng',
  'exiftool-Nikon.nef',
  'exiftool-QuickTime.heic',
]

describe('ThumbnailCache', () => {
  it('yields a JPEG ≥ 64 px wide for every fixture with an embedded preview', async () => {
    const cache = new ThumbnailCache(dir, et, ops)
    for (const name of withEmbedded) {
      const result = await cache.get(join(fixtures, 'cache', name), 1)
      expect(result.url, name).toMatch(/^stecknadel-thumb:\/\/thumb\/[0-9a-f]{40}\.jpg$/)
      const file = cache.resolve(new URL(result.url as string).pathname) as string
      const size = jpegSize(await readFile(file))
      expect(size?.width, name).toBeGreaterThanOrEqual(64)
    }
  })

  it('prefers a ≥ 256 px preview over a 160 px embedded thumbnail', async () => {
    const cache = new ThumbnailCache(dir, et, ops)
    const result = await cache.get(join(fixtures, 'cache/Fujifilm-X-T4.RAF'), 1)
    const file = cache.resolve(new URL(result.url as string).pathname) as string
    expect(jpegSize(await readFile(file))?.width).toBe(4416)
  })

  it('falls back to the OS thumbnailer, then the placeholder, without an embedded preview', async () => {
    osCalls = []
    const cache = new ThumbnailCache(dir, et, ops)
    for (const name of [...withoutEmbedded, '../generated/smoke.jpg']) {
      const file = join(fixtures, 'cache', name)
      expect(await cache.get(file, 1), name).toEqual({ url: null, rotate: 0 })
      expect(osCalls, name).toContain(file)
    }
  })

  it('serves cached results without re-extracting', async () => {
    const file = join(fixtures, 'cache/Ricoh-GR-III.DNG')
    const own = await mkdtemp(join(tmpdir(), 'steck-thumbs-'))
    const first = await new ThumbnailCache(own, et, ops).get(file, 6)
    expect(first.rotate).toBe(90)
    const failing: ImageOps = {
      resizeJpeg: () => {
        throw new Error('should not resize again')
      },
      osThumbnail: async () => null,
    }
    expect(await new ThumbnailCache(own, et, failing).get(file, 6)).toEqual(first)
    await rm(own, { recursive: true, force: true })
  })

  it('only resolves cache IDs to files inside the cache dir', () => {
    const cache = new ThumbnailCache(dir, et, ops)
    const id = 'a'.repeat(40)
    expect(cache.resolve(`/${id}.jpg`)).toBe(join(dir, `${id}.jpg`))
    for (const bad of [
      '/../../etc/passwd',
      `/${id}.json`,
      `/${id}.jpg/../x`,
      `/sub/${id}.jpg`,
      '/%2e%2e%2fetc.jpg',
      `/${'A'.repeat(40)}.jpg`,
      '',
    ]) {
      expect(cache.resolve(bad), bad).toBeNull()
    }
  })

  it('writes only JPEGs and metadata into the cache dir', async () => {
    const files = await readdir(dir)
    expect(files.every((f) => /^[0-9a-f]{40}\.(jpg|json)$/.test(f))).toBe(true)
  })
})

describe('rotationFor', () => {
  it('maps EXIF orientation to clockwise degrees', () => {
    expect([1, 3, 6, 8, 0].map(rotationFor)).toEqual([0, 180, 90, 270, 0])
  })
})
