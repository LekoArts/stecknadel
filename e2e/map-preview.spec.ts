import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import {
  distanceMeters,
  expectedMatch,
  expectedStay,
  type OraclePosition,
  readGpxPoints,
} from '../test/oracle/expected'
import { launchWithProfile, openFolder, pickZone } from './helpers/library'

// Own instance: the module singleton cannot be reused once another spec in this worker ends it.
const exiftool = new ExifTool()

const fixtures = join(__dirname, '../test/fixtures')
const gpx = join(fixtures, 'synthetic-trip.gpx')
/** The plan asks for the oracle's coordinates within 1e-6°. */
const PLAN_TOLERANCE = 1e-6
const utc = (iso: string): number => Date.parse(iso) / 1000

/**
 * Camera A: 09:30 Zurich summer time → 07:30Z (on the morning segment).
 * Camera B (true offset +01:00): b-day2 10:00 → 09:00Z (day 2), b-stay 13:00 → 12:00Z (inside the
 * bridged 10:00–13:00Z stay on day 1).
 * Camera C (true +02:00, set to +00:00): c-find 09:00 → really 07:00Z.
 */
const PHOTOS = {
  'a.jpg': { model: 'Camera A', dto: '2026:06:01 09:30:00' },
  'b-day2.jpg': { model: 'Camera B', dto: '2026:06:02 10:00:00' },
  'b-stay.jpg': { model: 'Camera B', dto: '2026:06:01 13:00:00' },
  'c-find.jpg': { model: 'Camera C', dto: '2026:06:01 09:00:00' },
}

async function previewLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'steck-map-'))
  for (const [name, p] of Object.entries(PHOTOS)) {
    const file = join(dir, name)
    await copyFile(join(fixtures, 'base.jpg'), file)
    await exiftool.write(
      file,
      { Make: 'E2E', Model: p.model, SerialNumber: p.model.slice(-1), DateTimeOriginal: p.dto },
      { writeArgs: ['-overwrite_original'] },
    )
  }
  return dir
}

test.afterAll(() => exiftool.end())

interface SnapshotResult {
  id: string
  status: { kind: string }
  position: { lat: number; lon: number; ele: number | null } | null
}

async function photoIds(page: Page): Promise<Map<string, string>> {
  const tiles = page.getByTestId('photo-tile')
  await expect(tiles).toHaveCount(Object.keys(PHOTOS).length)
  const out = new Map<string, string>()
  for (const tile of await tiles.all()) {
    const name = (await tile.locator('span.truncate.font-medium').textContent()) ?? ''
    out.set(name, (await tile.getAttribute('data-photo-id')) ?? '')
  }
  return out
}

/** Main's newest preview snapshot, by file name. */
async function snapshot(
  page: Page,
  ids: Map<string, string>,
): Promise<Map<string, SnapshotResult>> {
  const snap = (await page.evaluate(() =>
    (
      window as unknown as { stecknadelDebug: { previewSnapshot: () => Promise<unknown> } }
    ).stecknadelDebug.previewSnapshot(),
  )) as { results: SnapshotResult[] } | null
  const byId = new Map(snap?.results.map((r) => [r.id, r]) ?? [])
  const out = new Map<string, SnapshotResult>()
  for (const [name, id] of ids) {
    const r = byId.get(id)
    if (r) out.set(name, r)
  }
  return out
}

const near = (a: SnapshotResult['position'] | undefined, b: OraclePosition | null): boolean =>
  !!a &&
  !!b &&
  Math.abs(a.lat - b.lat) <= PLAN_TOLERANCE &&
  Math.abs(a.lon - b.lon) <= PLAN_TOLERANCE

/** Waits until the UI has settled on a preview, then returns main's snapshot. */
async function settled(page: Page, ids: Map<string, string>): Promise<Map<string, SnapshotResult>> {
  await expect(page.getByTestId('preview-state')).toBeHidden()
  return snapshot(page, ids)
}

const selectCamera = (page: Page, name: string) =>
  page
    .getByTestId('camera')
    .filter({ hasText: name })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()

async function setOffset(page: Page, value: string): Promise<void> {
  const panel = page.getByTestId('camera-time')
  await pickZone(panel, 'Time zone from the first photo', 'fixed')
  const offset = panel.getByLabel('UTC', { exact: true })
  await offset.fill(value)
  await offset.press('Enter')
}

/** Clicks the map canvas at a coordinate, optionally zooming there first (a pixel is meters wide). */
async function clickMapAt(
  page: Page,
  at: { lat: number; lon: number },
  zoom?: number,
): Promise<void> {
  const point = await page.evaluate(
    ({ lat, lon, zoom }) => {
      const map = (
        window as unknown as {
          __stecknadelMap: {
            project: (c: [number, number]) => { x: number; y: number }
            jumpTo: (o: { center: [number, number]; zoom: number }) => void
          }
        }
      ).__stecknadelMap
      if (zoom !== undefined) map.jumpTo({ center: [lon, lat], zoom })
      const p = map.project([lon, lat])
      return { x: p.x, y: p.y }
    },
    { lat: at.lat, lon: at.lon, zoom },
  )
  const box = await page.getByTestId('map').boundingBox()
  if (!box) throw new Error('map not visible')
  await page.mouse.click(box.x + point.x, box.y + point.y)
}

async function loadGpx(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as unknown as typeof dialog.showOpenDialog
  }, gpx)
  await page.getByRole('button', { name: 'Load GPX…' }).click()
  await expect(page.getByTestId('track-summary')).toContainText('663 points')
}

test('map preview: pins follow the camera time, offset finder and manual placement', async () => {
  const folder = await previewLibrary()
  const track = readGpxPoints(await readFile(gpx, 'utf8'))
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, folder)
    const ids = await photoIds(page)
    await loadGpx(app, page)

    await selectCamera(page, 'Camera A')
    await pickZone(
      page.getByTestId('camera-time'),
      'Time zone from the first photo',
      'Europe/Zurich',
    )
    await selectCamera(page, 'Camera C')
    await setOffset(page, '+00:00')

    // Camera B in the wrong zone: day 2 lands after the track, the stay photo in the overnight gap.
    await selectCamera(page, 'Camera B')
    await pickZone(
      page.getByTestId('camera-time'),
      'Time zone from the first photo',
      'America/Vancouver',
    )
    await expect
      .poll(async () => {
        const s = await settled(page, ids)
        return [s.get('b-day2.jpg')?.status.kind, s.get('b-stay.jpg')?.status.kind]
      })
      .toEqual(['after-track', 'in-gap'])
    let snap = await settled(page, ids)
    expect(snap.get('b-day2.jpg')?.position).toBeNull()
    expect(
      near(snap.get('a.jpg')?.position, expectedMatch(track, utc('2026-06-01T07:30:00Z'))),
    ).toBe(true)
    await expect(page.getByTestId('not-placed')).toContainText('b-day2.jpg')
    await expect(page.getByTestId('legend')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('map-before.png') })

    // The right offset: both B photos equal the oracle.
    await setOffset(page, '+01:00')
    await expect
      .poll(async () => {
        const s = await settled(page, ids)
        return [s.get('b-day2.jpg')?.status.kind, s.get('b-stay.jpg')?.status.kind]
      })
      .toEqual(['matched', 'matched-stay'])
    snap = await settled(page, ids)
    expect(
      near(snap.get('b-day2.jpg')?.position, expectedMatch(track, utc('2026-06-02T09:00:00Z'))),
    ).toBe(true)
    expect(
      near(snap.get('b-stay.jpg')?.position, expectedStay(track, utc('2026-06-01T12:00:00Z'))),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath('map-after.png') })

    // Offset finder: c-find is placed at 09:00Z (wrong); clicking where it was really taken
    // (the track at 07:00Z) suggests +02:00, and applying it puts the pin there (to within the
    // click's precision: the suggestion carries the residual drift of where the click hit).
    const truth = expectedMatch(track, utc('2026-06-01T07:00:00Z'))
    if (!truth) throw new Error('oracle has no 07:00Z position')
    snap = await settled(page, ids)
    expect(near(snap.get('c-find.jpg')?.position, truth)).toBe(false)
    await page.getByRole('button', { name: 'All photos' }).click()
    await page.locator(`[data-photo-id="${ids.get('c-find.jpg')}"]`).click()
    const actions = page.getByTestId('photo-actions')
    await actions.getByRole('button', { name: 'Find offset' }).click()
    await clickMapAt(page, truth, 18)
    const candidate = actions.getByTestId('finder-candidate').filter({ hasText: 'UTC+02:00' })
    await expect(candidate).toHaveCount(1)
    await candidate.getByRole('button', { name: 'Apply' }).click()
    await expect(
      page.getByTestId('camera-time-label').filter({ hasText: 'UTC+02:00' }),
    ).toHaveCount(1)
    await expect
      .poll(async () => {
        const at = (await settled(page, ids)).get('c-find.jpg')?.position
        return at ? distanceMeters({ lat: at.lat, lon: at.lon }, truth) : Number.POSITIVE_INFINITY
      })
      .toBeLessThan(5)

    // Manual placement: put b-day2 somewhere by hand.
    await page.locator(`[data-photo-id="${ids.get('b-day2.jpg')}"]`).click()
    const spot = { lat: track[0].lat + 0.01, lon: track[0].lon + 0.01 }
    await actions.getByRole('button', { name: 'Place on map' }).click()
    await clickMapAt(page, spot, 14)
    await expect(page.getByTestId('selected-status')).toContainText('Placed by hand')
    snap = await settled(page, ids)
    expect(snap.get('b-day2.jpg')?.status.kind).toBe('manual')
    const placed = snap.get('b-day2.jpg')?.position
    expect(Math.abs((placed?.lat ?? 0) - spot.lat)).toBeLessThan(1e-3)
    expect(Math.abs((placed?.lon ?? 0) - spot.lon)).toBeLessThan(1e-3)
    await expect(
      page.locator(`[data-photo-id="${ids.get('b-day2.jpg')}"]`).getByTestId('photo-status'),
    ).toHaveAttribute('data-status', 'manual')
  } finally {
    await close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('camera zones come from the track, and one camera’s changes copy onto another', async () => {
  const folder = await previewLibrary()
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, folder)
    const label = (camera: string) =>
      page.getByTestId('camera').filter({ hasText: camera }).getByTestId('camera-time-label')
    await expect(label('Camera A')).toContainText('unconfirmed')

    // The synthetic trip is in Switzerland: with the track loaded, every camera reads Zurich time.
    await loadGpx(app, page)
    await expect(label('Camera A')).toHaveText('Europe/Zurich')
    await expect(label('Camera C')).toHaveText('Europe/Zurich')
    await selectCamera(page, 'Camera A')
    const panel = page.getByTestId('camera-time')
    await expect(panel.getByTestId('detected')).toBeVisible()
    await expect(panel.getByTestId('unconfirmed')).toBeHidden()

    // Zones on the trip are offered first.
    await panel.getByRole('combobox', { name: 'Time zone from the first photo' }).click()
    await expect(page.getByRole('group', { name: 'On this trip' }).getByRole('option')).toHaveText([
      /^Europe\/Zurich/,
    ])
    await page.keyboard.press('Escape')

    // Camera A: a change to +01:00 on day 2, then Camera C copies it.
    await panel.getByRole('button', { name: 'Clock changed…' }).click()
    await panel
      .getByLabel('Camera time of the first photo after the change')
      .fill('2026-06-02 00:00')
    await panel.getByRole('button', { name: 'Add', exact: true }).click()
    await pickZone(panel, 'Time zone from 2026-06-02 00:00:00', 'fixed')
    const offset = panel.getByLabel('UTC', { exact: true })
    await offset.fill('+01:00')
    await offset.press('Enter')
    await expect(label('Camera A')).toHaveText('Europe/Zurich + 1 change')

    await selectCamera(page, 'Camera C')
    await panel.getByRole('button', { name: 'Copy from…' }).click()
    await page
      .getByRole('dialog', { name: 'Copy time zones from' })
      .getByRole('button', { name: /^Camera A/ })
      .click()
    await expect(panel.getByTestId('segment')).toHaveCount(2)
    await expect(panel.getByTestId('detected')).toBeHidden()
    await expect(label('Camera C')).toHaveText('Europe/Zurich + 1 change')
    await page.screenshot({ path: test.info().outputPath('copied-zones.png') })
  } finally {
    await close()
    await rm(folder, { recursive: true, force: true })
  }
})
