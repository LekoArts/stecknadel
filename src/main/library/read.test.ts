import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readAll, readPhotoTags } from './read'

const fixtures = join(__dirname, '../../../test/fixtures')
let et: ExifTool
let dir: string

beforeAll(async () => {
  et = new ExifTool({ maxProcs: 2 })
  dir = await mkdtemp(join(tmpdir(), 'steck-read-'))
})
afterAll(async () => {
  await et.end()
  await rm(dir, { recursive: true, force: true })
})

describe('readPhotoTags', () => {
  it('reads camera identity and capture time from the generated smoke JPEG', async () => {
    const tags = await readPhotoTags(et, join(fixtures, 'generated/smoke.jpg'))
    expect(tags.error).toBeNull()
    expect(tags.captureTime).toBe('2026:06:01 08:30:00')
    expect(tags.camera.Make).toBeTruthy()
    expect(tags.gps).toBeNull()
  })

  it('returns signed GPS with altitude below sea level', async () => {
    const file = join(dir, 'gps.jpg')
    await copyFile(join(fixtures, 'generated/smoke.jpg'), file)
    await et.write(
      file,
      { GPSLatitude: -33.5, GPSLongitude: 151.2, GPSAltitude: -10 },
      { writeArgs: ['-overwrite_original'] },
    )
    const tags = await readPhotoTags(et, file)
    expect(tags.gps).toEqual({ latitude: -33.5, longitude: 151.2, altitude: -10 })
  })

  it('reads SubSecTimeOriginal from the CR3 fixture', async () => {
    const tags = await readPhotoTags(et, join(fixtures, 'cache/Canon-EOS-R.CR3'))
    expect(tags.captureTime).toBe('2021:05:10 16:58:14')
    expect(tags.subSec).toBe('40')
  })

  it('reports an error for an unreadable file without throwing', async () => {
    const file = join(dir, 'broken.jpg')
    await writeFile(file, 'not a jpeg')
    const tags = await readPhotoTags(et, file)
    expect(tags.error).toBe('Not a photo (contents look like TXT)')
    expect(tags.captureTime).toBeNull()
  })

  it('reads every fixture format without errors', async () => {
    for (const name of [
      'Canon-EOS-R.CR3',
      'Nikon-Z6.NEF',
      'Sony-a7III.ARW',
      'Fujifilm-X-T4.RAF',
      'Ricoh-GR-III.DNG',
    ]) {
      const tags = await readPhotoTags(et, join(fixtures, 'cache', name))
      expect(tags.error, name).toBeNull()
      expect(tags.camera.Model, name).toBeTruthy()
    }
  })

  it('reads the HEIC fixture (which carries no camera tags) without errors', async () => {
    const tags = await readPhotoTags(et, join(fixtures, 'cache/exiftool-QuickTime.heic'))
    expect(tags.error).toBeNull()
  })

  it('readAll preserves order and reports progress', async () => {
    const files = [join(fixtures, 'generated/smoke.jpg'), join(fixtures, 'cache/Canon-EOS-R.CR3')]
    const seen: number[] = []
    const all = await readAll(et, files, (done) => seen.push(done))
    expect(all.map((t) => t.captureTime)).toEqual(['2026:06:01 08:30:00', '2021:05:10 16:58:14'])
    expect(seen).toEqual([1, 2])
  })
})
