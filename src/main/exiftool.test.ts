import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exiftool } from './exiftool'
import { runSmoke } from './smoke'

const smokeFixture = join(__dirname, '../../test/fixtures/generated/smoke.jpg')

describe('bundled ExifTool (native)', () => {
  let dir: string
  let file: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steck-exiftool-'))
    file = join(dir, 'smoke.jpg')
    await copyFile(smokeFixture, file)
  })
  afterAll(async () => {
    await exiftool.end()
    await rm(dir, { recursive: true, force: true })
  })

  it('writes OffsetTimeOriginal and GPS and reads them back', async () => {
    const result = await runSmoke(exiftool, file)
    expect(result.ok).toBe(true)
    const tags = await exiftool.read(file, { readArgs: ['-n'] })
    expect(tags.OffsetTimeOriginal).toBe('+02:00')
    expect(tags.GPSLatitude).toBe(47.5)
    expect(tags.Model).toBe('Smoke Test Camera')
    expect(result.line).toMatch(/^STECKNADEL_SMOKE ok \d+\.\d+ \+02:00 47\.5$/)
  })
})
