// Generates test photos into test/fixtures/generated/ (gitignored) by copying the committed
// metadata-free test/fixtures/base.jpg and writing per-scenario camera metadata with ExifTool.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exiftool } from 'exiftool-vendored'

const root = fileURLToPath(new URL('..', import.meta.url))
const base = join(root, 'test/fixtures/base.jpg')
const outDir = join(root, 'test/fixtures/generated')

/** name → tags written onto a copy of base.jpg */
const scenarios = {
  'smoke.jpg': {
    Make: 'Stecknadel',
    Model: 'Smoke Test Camera',
    SerialNumber: 'SMOKE0001',
    DateTimeOriginal: '2026:06:01 08:30:00',
  },
}

try {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  for (const [name, tags] of Object.entries(scenarios)) {
    const target = join(outDir, name)
    await copyFile(base, target)
    await exiftool.write(target, tags, { writeArgs: ['-overwrite_original'] })
    console.log(`generated ${name}`)
  }
} finally {
  await exiftool.end()
}
