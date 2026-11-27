import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import { launchWithProfile, openFolder } from './helpers/library'

// Own instance: the module singleton cannot be reused once another spec in this worker ends it.
const exiftool = new ExifTool()

const base = join(__dirname, '../test/fixtures/base.jpg')

/** Three photos from two cameras on the synthetic trip's days. */
async function timeLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'steck-time-'))
  const photos = {
    'day1.jpg': { serial: 'A1', dto: '2026:06:01 09:30:00' },
    'day2.jpg': { serial: 'A1', dto: '2026:06:02 10:00:00' },
    'recorded.jpg': { serial: 'B2', dto: '2026:06:01 09:30:00', offset: '+02:00' },
  }
  for (const [name, p] of Object.entries(photos)) {
    const file = join(dir, name)
    await copyFile(base, file)
    await exiftool.write(
      file,
      {
        Make: 'E2E',
        Model: p.serial === 'A1' ? 'Camera A' : 'Camera B',
        SerialNumber: p.serial,
        DateTimeOriginal: p.dto,
        ...('offset' in p ? { OffsetTimeOriginal: p.offset } : {}),
      },
      { writeArgs: ['-overwrite_original'] },
    )
  }
  return dir
}

test.afterAll(() => exiftool.end())

const selectCamera = (page: Page, name: string) =>
  page
    .getByTestId('camera')
    .filter({ hasText: name })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()

const utcOf = (page: Page, name: string) =>
  page.getByTestId('photo-tile').filter({ hasText: name }).getByTestId('photo-utc')

/** One page of Dawarich points covering only 2026-06-01. */
async function mockDawarich(): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-total-pages': '1' })
    res.end(
      JSON.stringify(
        [0, 1, 2].map((i) => ({
          latitude: '46.5',
          longitude: String(7.5 + i / 100),
          timestamp: Date.UTC(2026, 5, 1, 6 + i) / 1000,
        })),
      ),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
}

test('per-camera time: zone, time change, drift, recorded offsets and the UTC column', async () => {
  const folder = await timeLibrary()
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, folder)
    await expect(page.getByRole('button', { name: 'All photos' })).toContainText('3')
    await expect(page.getByTestId('camera-time-label').first()).toContainText('unconfirmed')

    // Camera A: confirm Zurich time → UTC follows the zone's summer offset.
    await selectCamera(page, 'Camera A')
    const panel = page.getByTestId('camera-time')
    await expect(panel.getByTestId('unconfirmed')).toBeVisible()
    await panel.getByLabel('Time zone from the start').selectOption('Europe/Zurich')
    await expect(panel.getByTestId('unconfirmed')).toBeHidden()
    await expect(utcOf(page, 'day1.jpg')).toHaveText('2026-06-01 07:30:00Z')
    await expect(utcOf(page, 'day2.jpg')).toHaveText('2026-06-02 08:00:00Z')

    // A time change on day 2 to a fixed +01:00 moves only day-2 photos.
    await panel.getByRole('button', { name: 'Add time change at…' }).click()
    await panel.getByLabel(/Camera time of the change/).fill('2026-06-02T00:00')
    await panel.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(panel.getByTestId('segment')).toHaveCount(2)
    await panel.getByLabel('Time zone from 2026-06-02 00:00:00').selectOption('__offset')
    const offset = panel.getByLabel('UTC', { exact: true })
    await offset.fill('+01:00')
    await offset.press('Enter')
    await expect(utcOf(page, 'day2.jpg')).toHaveText('2026-06-02 09:00:00Z')
    await expect(utcOf(page, 'day1.jpg')).toHaveText('2026-06-01 07:30:00Z')

    // Drift lives behind "Advanced": a clock 73 s fast shifts day 1 back by 73 s.
    await panel.getByTestId('segment').first().getByText('Advanced').click()
    const drift = panel.getByTestId('segment').first().getByLabel('Clock ahead by')
    await drift.fill('73')
    await drift.press('Enter')
    await expect(utcOf(page, 'day1.jpg')).toHaveText('2026-06-01 07:28:47Z')

    // Camera B records its offset: it wins, and a disagreeing confirmed zone is a warning.
    await selectCamera(page, 'Camera B')
    await expect(utcOf(page, 'recorded.jpg')).toHaveText('2026-06-01 07:30:00Z')
    const toggle = panel.getByLabel(/Use offsets recorded by the camera/)
    await expect(toggle).toBeChecked()
    await panel.getByLabel('Time zone from the start').selectOption('America/Vancouver')
    await expect(panel.getByTestId('time-warnings')).toContainText(
      'Recorded offset differs from this setting on 1 photo (the recorded one is used)',
    )
    await expect(utcOf(page, 'recorded.jpg')).toHaveText('2026-06-01 07:30:00Z')
    await toggle.uncheck()
    await expect(utcOf(page, 'recorded.jpg')).toHaveText('2026-06-01 16:30:00Z')

    await page.screenshot({ path: test.info().outputPath('camera-time.png') })
  } finally {
    await close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('photos outside the fetched Dawarich range get a banner that refetches a wider range', async () => {
  const folder = await timeLibrary()
  const dawarich = await mockDawarich()
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, folder)
    await selectCamera(page, 'Camera A')
    await page.getByLabel('Time zone from the start').selectOption('Europe/Zurich')

    await page.getByRole('button', { name: 'Dawarich…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Server address').fill(dawarich.url)
    await dialog.getByLabel('API key').fill('e2e-key')
    await dialog.getByLabel('From (UTC)').fill('2026-06-01T00:00')
    await dialog.getByLabel('To (UTC)').fill('2026-06-01T12:00')
    await dialog.getByRole('button', { name: 'Fetch track' }).click()
    await expect(dialog).toBeHidden()

    // day2.jpg (08:00Z on June 2) is outside; the other two are inside.
    const banner = page.getByTestId('outside-range')
    await expect(banner).toContainText('The track doesn’t cover 1 photo')
    await banner.getByRole('button', { name: 'Fetch again…' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('From (UTC)')).toHaveValue('2026-06-01T00:00')
    await expect(dialog.getByLabel('To (UTC)')).toHaveValue('2026-06-02T09:00')
    await dialog.getByRole('button', { name: 'Fetch track' }).click()
    await expect(dialog).toBeHidden()
    await expect(banner).toBeHidden()
  } finally {
    await close()
    dawarich.server.close()
    await rm(folder, { recursive: true, force: true })
  }
})
