import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanFolder } from './scan'

let root: string

async function touch(...parts: string[]): Promise<void> {
  const file = join(root, ...parts)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, '')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'steck-scan-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const names = (photos: { relDir: string; name: string }[]): string[] =>
  photos.map((p) => (p.relDir ? `${p.relDir}/${p.name}` : p.name)).sort()

describe('scanFolder', () => {
  it('walks nested folders and filters by extension, case-insensitively', async () => {
    await touch('a.JPG')
    await touch('b.jpeg')
    await touch('day1', 'c.HEIC')
    await touch('day1', 'd.heif')
    await touch('day1', 'deep', 'e.cr3')
    await touch('day1', 'deep', 'f.NEF')
    await touch('g.ARW')
    await touch('h.raf')
    await touch('i.Dng')
    await touch('notes.txt')
    await touch('clip.mov')
    await touch('img.png')

    const photos = await scanFolder(root)
    expect(names(photos)).toEqual([
      'a.JPG',
      'b.jpeg',
      'day1/c.HEIC',
      'day1/d.heif',
      'day1/deep/e.cr3',
      'day1/deep/f.NEF',
      'g.ARW',
      'h.raf',
      'i.Dng',
    ])
    expect(photos.find((p) => p.name === 'e.cr3')?.format).toBe('CR3')
    expect(photos.find((p) => p.name === 'd.heif')?.format).toBe('HEIC')
  })

  it('skips ExifTool backups, temp leftovers and hidden entries', async () => {
    await touch('keep.jpg')
    await touch('keep.jpg_original')
    await touch('raw.dng_original')
    await touch('half.jpg_exiftool_tmp')
    await touch('._keep.jpg')
    await touch('.hidden', 'secret.jpg')
    await touch('.Trashes', 'x.jpg')

    expect(names(await scanFolder(root))).toEqual(['keep.jpg'])
  })

  it('associates <basename>.xmp sidecars with RAWs only', async () => {
    await touch('IMG_1.CR3')
    await touch('IMG_1.xmp')
    await touch('IMG_2.NEF')
    await touch('IMG_2.XMP')
    await touch('IMG_3.jpg')
    await touch('IMG_3.xmp')
    await touch('IMG_4.ARW')

    const byName = Object.fromEntries((await scanFolder(root)).map((p) => [p.name, p]))
    expect(byName['IMG_1.CR3'].sidecarPath).toBe(join(root, 'IMG_1.xmp'))
    expect(byName['IMG_2.NEF'].sidecarPath).toBe(join(root, 'IMG_2.XMP'))
    expect(byName['IMG_3.jpg'].sidecarPath).toBeNull()
    expect(byName['IMG_4.ARW'].sidecarPath).toBeNull()
    expect(Object.values(byName).every((p) => !p.sidecarCollision)).toBe(true)
  })

  it('flags two RAWs sharing a basename as a sidecar collision', async () => {
    await touch('IMG.CR3')
    await touch('IMG.DNG')
    await touch('IMG.xmp')
    await touch('IMG.JPG')
    await touch('other', 'IMG.NEF')

    const photos = await scanFolder(root)
    const flagged = photos.filter((p) => p.sidecarCollision).map((p) => p.name)
    expect(flagged.sort()).toEqual(['IMG.CR3', 'IMG.DNG'])
    expect(photos.filter((p) => p.sidecarCollision).every((p) => p.sidecarPath === null)).toBe(true)
    expect(photos.find((p) => p.relDir === 'other')?.sidecarCollision).toBe(false)
  })

  it('flags a RAW whose name matches two sidecars that differ only in case', async () => {
    await touch('IMG.CR3')
    await touch('IMG.xmp')
    await touch('img.XMP')
    const caseSensitive = (await readdir(root)).length === 3
    const photos = await scanFolder(root)
    expect(photos[0].sidecarCollision).toBe(caseSensitive)
    if (caseSensitive) expect(photos[0].sidecarPath).toBeNull()
  })

  it('follows symlinked folders without hanging on loops', async () => {
    await touch('a', 'one.jpg')
    await touch('b', 'two.jpg')
    await symlink(root, join(root, 'a', 'loop-to-root'), 'dir')
    await symlink(join(root, 'a'), join(root, 'b', 'link-to-a'), 'dir')
    await symlink(join(root, 'missing'), join(root, 'dangling'), 'dir')

    const photos = await scanFolder(root)
    // a/one.jpg is reached once: the link into an already-visited folder is not walked again.
    expect(names(photos)).toEqual(['a/one.jpg', 'b/two.jpg'])
  })
})
