import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import { launchWithProfile, openFolder } from './helpers/library'

const COUNT = 5000
const base = join(__dirname, '../test/fixtures/generated/smoke.jpg')

/** 5,000 copies of the generated JPEG in 10 subfolders, one minute apart. */
async function generate(dir: string): Promise<void> {
  const et = new ExifTool({ maxProcs: 8 })
  try {
    const start = Date.UTC(2026, 5, 1, 6, 0, 0)
    const jobs: Promise<unknown>[] = []
    for (let i = 0; i < COUNT; i++) {
      const sub = join(dir, `day${String(i % 10).padStart(2, '0')}`)
      if (i < 10) await mkdir(sub)
      const file = join(sub, `IMG_${String(i).padStart(5, '0')}.jpg`)
      const dto = new Date(start + i * 60_000).toISOString().slice(0, 19).replace('T', ' ')
      jobs.push(
        copyFile(base, file).then(() =>
          et.write(
            file,
            { DateTimeOriginal: dto.replaceAll('-', ':') },
            {
              writeArgs: ['-overwrite_original'],
            },
          ),
        ),
      )
    }
    await Promise.all(jobs)
  } finally {
    await et.end()
  }
}

test('5,000 JPEGs load in under 60 s and the grid scrolls at p95 < 33 ms per frame', {
  tag: '@perf',
}, async () => {
  test.setTimeout(300_000)
  const folder = await mkdtemp(join(tmpdir(), 'steck-perf-'))
  await generate(folder)
  const { app, page, close } = await launchWithProfile()
  try {
    const t0 = Date.now()
    await openFolder(app, page, folder)
    await expect(page.getByRole('button', { name: 'All photos' })).toContainText(String(COUNT), {
      timeout: 60_000,
    })
    await expect(page.getByTestId('photo-tile').first()).toBeVisible()
    const loadMs = Date.now() - t0
    console.log(`STECKNADEL_PERF load ${COUNT} photos: ${(loadMs / 1000).toFixed(1)} s`)
    expect(loadMs).toBeLessThan(60_000)

    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const grid = document.querySelector('[data-testid="photo-grid"]') as HTMLElement
          const deltas: number[] = []
          let last = performance.now()
          const step = (now: number): void => {
            deltas.push(now - last)
            last = now
            const max = grid.scrollHeight - grid.clientHeight
            if (grid.scrollTop >= max - 1) {
              resolve(deltas.slice(1))
              return
            }
            grid.scrollTop = Math.min(max, grid.scrollTop + 300)
            requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
    )
    const sorted = [...frames].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    console.log(
      `STECKNADEL_PERF scroll ${frames.length} frames: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted.at(-1)?.toFixed(1)} ms`,
    )
    expect(p95).toBeLessThan(33)
    await expect(page.getByTestId('photo-tile').last()).toContainText('IMG_04999.jpg')
  } finally {
    await close()
    await rm(folder, { recursive: true, force: true })
  }
})
