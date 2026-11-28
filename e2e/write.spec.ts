import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import { launchWithProfile, openFolder } from './helpers/library'

// Own instance: the module singleton cannot be reused once another spec in this worker ends it.
const exiftool = new ExifTool()
test.afterAll(() => exiftool.end())

const fixtures = join(__dirname, '../test/fixtures')
const gpx = join(fixtures, 'synthetic-trip.gpx')

interface Snapshot {
  results: {
    id: string
    status: { kind: string }
    position: { lat: number; lon: number; ele: number | null } | null
  }[]
}
const previewSnapshot = (page: Page): Promise<Snapshot | null> =>
  page.evaluate(() =>
    (
      window as unknown as { stecknadelDebug: { previewSnapshot: () => Promise<Snapshot | null> } }
    ).stecknadelDebug.previewSnapshot(),
  )

async function photo(dir: string, name: string, tags: Record<string, unknown>): Promise<string> {
  const file = join(dir, name)
  await copyFile(join(fixtures, 'base.jpg'), file)
  await exiftool.write(
    file,
    // The offset goes after DateTimeOriginal: written before it, it doesn't stick.
    { Make: 'E2E', Model: 'Camera W', SerialNumber: 'W', ...tags, OffsetTimeOriginal: '+00:00' },
    { writeArgs: ['-overwrite_original'] },
  )
  return file
}

test('write: confirm, report, CSV export, read-back and restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'steck-write-'))
  const moving = await photo(dir, 'a-moving.jpg', { DateTimeOriginal: '2026:06:01 08:00:00' })
  const stay = await photo(dir, 'b-stay.jpg', { DateTimeOriginal: '2026:06:01 12:00:00' })
  const before = await photo(dir, 'c-before.jpg', { DateTimeOriginal: '2026:05:30 12:00:00' })
  const tagged = await photo(dir, 'd-tagged.jpg', {
    DateTimeOriginal: '2026:06:01 08:30:00',
    GPSLatitude: 10,
    GPSLatitudeRef: 'N',
    GPSLongitude: 20,
    GPSLongitudeRef: 'E',
  })
  const beforeBytes = await readFile(before)
  const taggedBytes = await readFile(tagged)

  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, dir)
    await expect(page.getByTestId('photo-tile')).toHaveCount(4)
    await expect(page.getByRole('button', { name: 'Recent writes' })).toHaveCount(0)
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [chosen],
      })) as unknown as typeof dialog.showOpenDialog
    }, gpx)
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    await expect(page.getByTestId('track-summary')).toContainText('663 points')
    await expect(page.getByTestId('preview-state')).toBeHidden()
    await expect.poll(async () => (await previewSnapshot(page))?.results.length).toBe(4)
    const preview = (await previewSnapshot(page)) as Snapshot

    // Nothing selected, nothing filtered: Write means every photo with a position.
    await expect(page.getByTestId('write-button')).toHaveText('Write (2)')
    await page.getByTestId('write-button').click()
    const confirm = page.getByRole('dialog', { name: 'Write 2 positions' })
    await expect(confirm.getByTestId('write-scopes')).toHaveCount(0)
    await expect(confirm).toBeVisible()
    await expect(confirm.getByTestId('write-counts')).toContainText('Matched1')
    await expect(confirm.getByTestId('write-counts')).toContainText('Placed at stay location1')
    await expect(confirm.getByTestId('write-counts')).toContainText('Before the track1')
    await expect(confirm.getByTestId('write-counts')).toContainText('Already has GPS1')
    await expect(confirm).toContainText('No copies of the original files')
    await page.screenshot({ path: test.info().outputPath('confirm.png') })
    await confirm.getByRole('button', { name: 'Write', exact: true }).click()

    const report = page.getByRole('dialog', { name: 'Wrote 2 positions' })
    await expect(report).toBeVisible({ timeout: 30_000 })
    const filters = report.getByTestId('report-filters')
    await expect(filters).toContainText('All 4')
    await expect(filters.locator('[data-outcome="written"]')).toHaveText('Written 2')
    await expect(filters.locator('[data-outcome="unmatched"]')).toHaveText('Not placed 1')
    await expect(filters.locator('[data-outcome="skipped"]')).toHaveText('Skipped 1')
    await expect(filters.locator('[data-outcome="failed"]')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('report.png') })
    await filters.locator('[data-outcome="skipped"]').click()
    await expect(report.getByTestId('write-report').locator('tr')).toHaveCount(1)
    await expect(report.getByTestId('write-report')).toContainText('d-tagged.jpg')

    const csv = join(dir, 'report.csv')
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: chosen,
      })) as unknown as typeof dialog.showSaveDialog
    }, csv)
    await report.getByRole('button', { name: 'Export report as CSV' }).click()
    await expect.poll(() => readFile(csv, 'utf8').catch(() => '')).toContain('a-moving.jpg')
    const lines = (await readFile(csv, 'utf8')).trim().split(/\r?\n/)
    expect(lines).toHaveLength(5)
    expect(lines[0]).toMatch(/^File,Result,Status/)
    await report.getByRole('button', { name: 'Done' }).click()

    // What ExifTool reads from the files equals what the map showed.
    const ids = await page
      .getByTestId('photo-tile')
      .evaluateAll((tiles) => tiles.map((t) => t.getAttribute('data-photo-id')))
    expect(ids).toHaveLength(4)
    for (const [file, kind] of [
      [moving, 'matched'],
      [stay, 'matched-stay'],
    ] as const) {
      const expected = preview.results.find((r) => r.status.kind === kind)?.position
      if (!expected) throw new Error(`no ${kind} in the preview`)
      const tags = await exiftool.read(file, { readArgs: ['-n'] })
      expect(tags.GPSLatitude).toBeCloseTo(expected.lat, 6)
      expect(tags.GPSLongitude).toBeCloseTo(expected.lon, 6)
    }
    expect(await readFile(before)).toEqual(beforeBytes)
    expect(await readFile(tagged)).toEqual(taggedBytes)
    // The folder was read again: the written photos now have GPS of their own.
    await expect
      .poll(async () => {
        const snap = await previewSnapshot(page)
        return snap?.results.filter((r) => r.status.kind === 'has-gps').length
      })
      .toBe(3)

    await page.getByRole('button', { name: 'Recent writes' }).click()
    const recent = page.getByTestId('recent-write')
    await expect(recent).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('recent.png') })
    await expect(recent).toContainText('2 files')
    await recent.getByRole('button', { name: 'Restore values' }).click()
    const restore = page.getByRole('dialog', { name: 'Restore previous values' })
    await restore.getByRole('button', { name: 'Restore values' }).click()
    await expect(restore.getByRole('status')).toContainText('Restored 2 files')
    await restore.getByRole('button', { name: 'Done' }).click()
    for (const file of [moving, stay]) {
      const tags = await exiftool.read(file, { readArgs: ['-n'] })
      expect(tags.GPSLatitude).toBeUndefined()
    }
    await expect
      .poll(async () => {
        const snap = await previewSnapshot(page)
        return snap?.results.filter((r) => r.status.kind === 'has-gps').length
      })
      .toBe(1)
  } finally {
    await close()
  }
})

test('write: the selection decides what Write writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'steck-write-sel-'))
  const moving = await photo(dir, 'a-moving.jpg', { DateTimeOriginal: '2026:06:01 08:00:00' })
  const stay = await photo(dir, 'b-stay.jpg', { DateTimeOriginal: '2026:06:01 12:00:00' })
  await photo(dir, 'c-before.jpg', { DateTimeOriginal: '2026:05:30 12:00:00' })
  await photo(dir, 'd-later.jpg', { DateTimeOriginal: '2026:06:01 08:10:00' })
  const movingBytes = await readFile(moving)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

  const { app, page, close } = await launchWithProfile()
  try {
    // A CI-sized window: tiles off screen aren't rendered and can't be clicked, so make room for
    // all four with the smallest thumbnails and the tallest photos panel.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700))
    await openFolder(app, page, dir)
    await page.getByRole('slider', { name: 'Thumbnail size' }).press('Home')
    await page.getByRole('separator').nth(1).focus()
    await page.keyboard.press('Home')
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [chosen],
      })) as unknown as typeof dialog.showOpenDialog
    }, gpx)
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    await expect.poll(async () => (await previewSnapshot(page))?.results.length).toBe(4)
    const button = page.getByTestId('write-button')
    const tile = (name: string) => page.getByTestId('photo-tile').filter({ hasText: name })
    // Off-screen tiles aren't rendered, so the grid reports how many are selected.
    const grid = page.getByTestId('photo-grid')
    const selected = (n: number) => expect(grid).toHaveAttribute('data-selected-count', String(n))
    await expect(button).toHaveText('Write (3)')

    // One photo: the button says just Write. Cmd/Ctrl-click adds a second.
    await tile('a-moving').click()
    await expect(button).toHaveText('Write')
    await tile('b-stay').click({ modifiers: [mod] })
    await expect(button).toHaveText('Write (2)')
    await selected(2)
    await expect(tile('b-stay')).toHaveAttribute('aria-pressed', 'true')
    await expect(tile('c-before')).toHaveAttribute('aria-pressed', 'false')
    // A photo without a position: the button is off and says why.
    await tile('c-before').click()
    await expect(button).toBeDisabled()
    await expect(
      page.locator('span[title="The selected photo has no position to write"]'),
    ).toHaveCount(1)
    // Shift-click selects the range; Escape clears; Cmd/Ctrl+A selects every shown photo.
    await tile('a-moving').click()
    await tile('d-later').click({ modifiers: ['Shift'] })
    await selected(4)
    await page.keyboard.press('Escape')
    await selected(0)
    await tile('a-moving').click()
    await page.keyboard.press(`${mod}+a`)
    await selected(4)

    // Right-click inside the selection keeps it…
    await tile('b-stay').click({ button: 'right' })
    await selected(4)
    await expect(page.getByTestId('menu-write')).toHaveText('Write selected photos (3)')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('menu-write')).toHaveCount(0)
    // …outside it, that photo becomes the selection, and Write writes just it.
    await tile('a-moving').click()
    await tile('b-stay').click({ button: 'right' })
    await selected(1)
    await expect(page.getByTestId('menu-write')).toHaveText('Write this photo')
    await page.getByTestId('menu-write').click()
    const confirm = page.getByRole('dialog', { name: 'Write 1 position' })
    await expect(confirm).toBeVisible()
    // The title follows the chosen scope, so find the parts through the dialog itself.
    const scopes = page.getByRole('dialog').getByTestId('write-scopes')
    await expect(scopes.getByRole('radio')).toHaveCount(2)
    await scopes.getByText('All photos').click()
    await expect(page.getByRole('dialog', { name: 'Write 3 positions' })).toBeVisible()
    await scopes.getByText('Selected photo').click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Write', exact: true }).click()

    const report = page.getByRole('dialog', { name: 'Wrote 1 position' })
    await expect(report).toBeVisible({ timeout: 30_000 })
    await expect(report.getByTestId('write-report').locator('tr')).toHaveCount(1)
    await expect(report.getByTestId('write-report')).toContainText('b-stay.jpg')
    await report.getByRole('button', { name: 'Done' }).click()
    expect((await exiftool.read(stay, { readArgs: ['-n'] })).GPSLatitude).toBeDefined()
    expect(await readFile(moving)).toEqual(movingBytes)

    // In the list, clicking a cell that isn't the name still gives the keys to the list.
    await page
      .getByRole('group', { name: 'Photo view' })
      .getByRole('button', { name: 'List' })
      .click()
    const rowsPressed = () =>
      page.getByTestId('photo-row').getByRole('button', { pressed: true }).count()
    await page.getByTestId('photo-row').filter({ hasText: 'c-before' }).locator('td').nth(2).click()
    expect(await rowsPressed()).toBe(1)
    await page.keyboard.press(`${mod}+a`)
    expect(await rowsPressed()).toBe(4)
    await page.keyboard.press('Escape')
    expect(await rowsPressed()).toBe(0)
  } finally {
    await close()
  }
})
