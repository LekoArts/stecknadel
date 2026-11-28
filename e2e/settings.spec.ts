import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import { launchWithProfile, openFolder, openSettings } from './helpers/library'

// Own instance: the module singleton cannot be reused once another spec in this worker ends it.
const exiftool = new ExifTool()
test.afterAll(() => exiftool.end())

const fixtures = join(__dirname, '../test/fixtures')
const pmtiles = join(fixtures, 'tiny.pmtiles')
const gpx = join(fixtures, 'synthetic-trip.gpx')

interface MapHandle {
  on: (event: 'error', fn: (e: { error?: { message?: string } }) => void) => void
  getStyle: () => { sources: Record<string, { type: string }> }
  isStyleLoaded: () => boolean
  isSourceLoaded: (id: string) => boolean
  areTilesLoaded: () => boolean
  jumpTo: (o: { center: [number, number]; zoom: number }) => void
  getZoom: () => number
}
type MapWindow = { __stecknadelMap: MapHandle; __mapErrors: string[] }

async function chooseFile(app: Parameters<typeof openFolder>[0], file: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as unknown as typeof dialog.showOpenDialog
  }, file)
}

test('a local PMTiles file renders the map with the network blocked', async () => {
  const { app, page, userData, close } = await launchWithProfile()
  try {
    // Nothing may leave the machine: every http(s) request is cancelled and recorded.
    await app.evaluate(({ session }) => {
      const blocked: string[] = []
      Object.assign(globalThis, { __blocked: blocked })
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (details, callback) => {
          blocked.push(details.url)
          callback({ cancel: true })
        },
      )
    })
    await page.waitForFunction(() => '__stecknadelMap' in window)
    await page.evaluate(() => {
      const w = window as unknown as MapWindow
      w.__mapErrors = []
      w.__stecknadelMap.on('error', (e) => w.__mapErrors.push(e.error?.message ?? 'error'))
    })

    const dialog = await openSettings(app, page)
    await dialog.getByRole('radio', { name: 'Offline map file (.pmtiles)' }).check()
    await expect(dialog.getByTestId('pmtiles-name')).toHaveText('No file chosen')
    // Save takes you to what's missing instead of saving.
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('button', { name: 'Choose file' })).toBeFocused()
    await chooseFile(app, pmtiles)
    await dialog.getByRole('button', { name: 'Choose file' }).click()
    await expect(dialog.getByTestId('pmtiles-name')).toHaveText('tiny.pmtiles')
    const blockedBefore = await app.evaluate(
      () => (globalThis as unknown as { __blocked: string[] }).__blocked.length,
    )
    await page.evaluate(() => {
      ;(window as unknown as MapWindow).__mapErrors = []
    })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    // The built-in style: one raster source from the file; every tile of zooms 0–2 loads.
    await page.waitForFunction(() => {
      const map = (window as unknown as MapWindow).__stecknadelMap
      return map.isStyleLoaded() && map.getStyle().sources.local?.type === 'raster'
    })
    for (const zoom of [0, 1, 2]) {
      await page.evaluate((z) => {
        ;(window as unknown as MapWindow).__stecknadelMap.jumpTo({ center: [8, 46.5], zoom: z })
      }, zoom)
      await page.waitForFunction(() => {
        const map = (window as unknown as MapWindow).__stecknadelMap
        return map.isSourceLoaded('local') && map.areTilesLoaded()
      })
    }
    expect(await page.evaluate(() => (window as unknown as MapWindow).__mapErrors)).toEqual([])
    const blocked = await app.evaluate(
      () => (globalThis as unknown as { __blocked: string[] }).__blocked,
    )
    expect(blocked.slice(blockedBefore)).toEqual([])
    await page.getByTestId('map').screenshot({ path: test.info().outputPath('pmtiles-map.png') })

    const saved = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))
    expect(saved.mapSource).toEqual({ kind: 'pmtiles', path: pmtiles })
  } finally {
    await close()
  }
})

test('changing GeoMaxIntSecs changes a photo’s status in the preview', async () => {
  // 12:00Z sits in the synthetic track's 10:00–13:00Z stay (fixes ~80 m apart, 3 h gap).
  const dir = await mkdtemp(join(tmpdir(), 'steck-settings-'))
  const file = join(dir, 'stay.jpg')
  await copyFile(join(fixtures, 'base.jpg'), file)
  await exiftool.write(
    file,
    {
      Make: 'E2E',
      Model: 'Camera S',
      SerialNumber: 'S',
      DateTimeOriginal: '2026:06:01 12:00:00',
      OffsetTimeOriginal: '+00:00',
    },
    { writeArgs: ['-overwrite_original'] },
  )
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, dir)
    await expect(page.getByTestId('photo-tile')).toHaveCount(1)
    const id = (await page.getByTestId('photo-tile').getAttribute('data-photo-id')) ?? ''
    await chooseFile(app, gpx)
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    await expect(page.getByTestId('track-summary')).toContainText('663 points')

    const status = async (): Promise<string | undefined> => {
      await expect(page.getByTestId('preview-state')).toBeHidden()
      const snap = (await page.evaluate(() =>
        (
          window as unknown as { stecknadelDebug: { previewSnapshot: () => Promise<unknown> } }
        ).stecknadelDebug.previewSnapshot(),
      )) as { results: { id: string; status: { kind: string } }[] } | null
      return snap?.results.find((r) => r.id === id)?.status.kind
    }
    // Default 30 min: the 3 h gap is beyond interpolation, so the bridge places it.
    await expect.poll(status).toBe('matched-stay')

    let dialog = await openSettings(app, page)
    const field = dialog.getByLabel('Interpolate between points up to')
    await expect(field).toHaveValue('30')
    await field.fill('0.5')
    await expect(dialog.getByText('1 minute to 7 days')).toBeVisible()
    await field.press('Tab')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(field).toBeFocused()
    await field.fill('240')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    // 4 h: ExifTool now interpolates across the gap itself.
    await expect.poll(status).toBe('matched')

    dialog = await openSettings(app, page)
    await expect(dialog.getByLabel('Interpolate between points up to')).toHaveValue('240')
    await dialog.getByLabel('Interpolate between points up to').fill('30')
    await dialog.getByRole('checkbox', { name: /Bridge gaps/ }).uncheck()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    // Without bridging the stay is a plain gap.
    await expect.poll(status).toBe('in-gap')
  } finally {
    await close()
  }
})
