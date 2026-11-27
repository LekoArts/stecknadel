import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import { launchWithProfile, openFolder, pickZone } from './helpers/library'

const COUNT = 5000
const CAMERAS = 5
const TRACK_POINTS = 2708
const START = Date.UTC(2026, 5, 1, 6, 0, 0)
const base = join(__dirname, '../test/fixtures/generated/smoke.jpg')

/** A 2,708-point track, one fix every 2 minutes (≈ 90 h), wandering through the Alps. */
function trackGpx(): string {
  const points: string[] = []
  for (let i = 0; i < TRACK_POINTS; i++) {
    const lat = 46.5 + 0.2 * Math.sin(i / 150)
    const lon = 7.5 + i * 0.0004
    const time = new Date(START + i * 120_000).toISOString().replace('.000', '')
    points.push(
      `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${time}</time></trkpt>`,
    )
  }
  return `<?xml version="1.0"?><gpx version="1.1" creator="steck-perf"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`
}

/** 5,000 JPEGs from 5 cameras, one a minute (camera clocks in UTC), inside the track's span. */
async function generate(dir: string): Promise<void> {
  const et = new ExifTool({ maxProcs: 8 })
  try {
    const jobs: Promise<unknown>[] = []
    for (let c = 0; c < CAMERAS; c++) await mkdir(join(dir, `cam${c}`))
    for (let i = 0; i < COUNT; i++) {
      const c = i % CAMERAS
      const file = join(dir, `cam${c}`, `IMG_${String(i).padStart(5, '0')}.jpg`)
      const dto = new Date(START + 600_000 + i * 60_000).toISOString().slice(0, 19)
      jobs.push(
        copyFile(base, file).then(() =>
          et.write(
            file,
            {
              Make: 'Perf',
              Model: `Perf ${c}`,
              SerialNumber: `P${c}`,
              DateTimeOriginal: dto.replace('T', ' ').replaceAll('-', ':'),
            },
            { writeArgs: ['-overwrite_original'] },
          ),
        ),
      )
    }
    await Promise.all(jobs)
  } finally {
    await et.end()
  }
}

interface Snapshot {
  generation: number
  results: { status: { kind: string } }[]
  recomputed: string[]
  durationMs: number
}

const snapshot = (page: Page): Promise<Snapshot | null> =>
  page.evaluate(() =>
    (
      window as unknown as { stecknadelDebug: { previewSnapshot: () => Promise<Snapshot | null> } }
    ).stecknadelDebug.previewSnapshot(),
  )

const setZone = async (page: Page, camera: string, zone: string): Promise<void> => {
  await page
    .getByTestId('camera')
    .filter({ hasText: camera })
    .getByRole('button', { name: new RegExp(`^${camera}`) })
    .click()
  await pickZone(page.getByTestId('camera-time'), 'Time zone from the first photo', zone)
}

test('preview: 5,000 stubs against a 2,708-point track; full run and one-camera recompute', async () => {
  test.setTimeout(600_000)
  const folder = await mkdtemp(join(tmpdir(), 'steck-preview-perf-'))
  const gpx = join(folder, 'track.gpx')
  await writeFile(gpx, trackGpx())
  const photos = join(folder, 'photos')
  await mkdir(photos)
  await generate(photos)
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, photos)
    await expect(page.getByRole('button', { name: 'All photos' })).toContainText(String(COUNT), {
      timeout: 120_000,
    })
    // Every camera in UTC before the track arrives, so the first run is the full one.
    for (let c = 0; c < CAMERAS; c++) await setZone(page, `Perf ${c}`, 'UTC')

    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [chosen],
      })) as unknown as typeof dialog.showOpenDialog
    }, gpx)
    await page.getByRole('button', { name: 'Load GPX…' }).click()
    await expect(page.getByTestId('track-summary')).toContainText('2,708 points')

    await expect
      .poll(async () => (await snapshot(page))?.recomputed.length ?? 0, { timeout: 180_000 })
      .toBe(CAMERAS)
    const full = (await snapshot(page)) as Snapshot
    expect(full.results).toHaveLength(COUNT)
    const matched = full.results.filter((r) => r.status.kind === 'matched').length
    console.log(
      `STECKNADEL_PERF preview full run (${COUNT} stubs, ${CAMERAS} cameras): ${(full.durationMs / 1000).toFixed(2)} s, ${matched} matched`,
    )
    expect(matched).toBe(COUNT)
    await expect(page.getByTestId('preview-state')).toBeHidden({ timeout: 60_000 })

    // One camera changes: only its 1,000 stubs go through ExifTool again.
    await setZone(page, 'Perf 2', 'Europe/Zurich')
    await expect
      .poll(
        async () => {
          const s = await snapshot(page)
          return s && s.generation > full.generation ? s.recomputed.length : 0
        },
        { timeout: 60_000 },
      )
      .toBe(1)
    const single = (await snapshot(page)) as Snapshot
    console.log(
      `STECKNADEL_PERF preview one-camera recompute (${COUNT / CAMERAS} stubs): ${(single.durationMs / 1000).toFixed(2)} s`,
    )
    // Plan target ≤ 3 s; above it the "Updating positions" state carries the wait (recorded, not failed).
    await expect(page.getByTestId('preview-state')).toBeHidden({ timeout: 60_000 })
  } finally {
    await close()
    await rm(folder, { recursive: true, force: true })
  }
})
