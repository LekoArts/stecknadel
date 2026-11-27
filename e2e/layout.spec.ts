import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import { launchApp } from './helpers/app'
import { copyFixtures, launchWithProfile, openFolder } from './helpers/library'

const fixtures = join(__dirname, '../test/fixtures')
/** The View menu's panel commands (Cmd/Ctrl+1/2/3/0): accelerators are native, so click the item. */
async function panelCommand(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(`panel-${itemId}`)
    if (!item) throw new Error(`no menu item ${itemId}`)
    item.click()
  }, id)
}

async function width(page: Page, label: string): Promise<number> {
  const box = await page.getByRole('complementary', { name: label }).boundingBox()
  return box?.width ?? 0
}

test('panels resize, hide, snap shut and come back at their size after a relaunch', async () => {
  const folder = await copyFixtures()
  const first = await launchWithProfile()
  const { page } = first
  let second: ElectronApplication | null = null
  try {
    await openFolder(first.app, page, folder)
    await expect(page.getByTestId('photo-tile').first()).toBeVisible()
    const cameras = page.getByRole('complementary', { name: 'Cameras' })
    const photos = page.getByRole('region', { name: 'Photos' })
    const metadata = page.getByRole('complementary', { name: 'Metadata' })
    const toggles = page.getByRole('group', { name: 'Panels' })

    // Keyboard resize on the cameras separator: arrows grow it.
    const before = await width(page, 'Cameras')
    const separators = page.getByRole('separator')
    await separators.first().focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(() => width(page, 'Cameras')).toBeGreaterThan(before + 10)
    const grown = await width(page, 'Cameras')

    // Toggle buttons and shortcuts.
    await toggles.getByRole('button', { name: 'Cameras' }).click()
    await expect(cameras).toBeHidden()
    await expect(toggles.getByRole('button', { name: 'Cameras' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await panelCommand(first.app, 'photos')
    await expect(photos).toHaveCount(0)
    await panelCommand(first.app, 'metadata')
    await expect(metadata).toHaveCount(0)
    const canvas = page.locator('canvas.maplibregl-canvas')
    const windowWidth = await page.evaluate(() => innerWidth)
    // MapLibre follows its container a frame later.
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0)
      .toBeGreaterThan(windowWidth - 4)
    const fullWidth = (await canvas.boundingBox())?.width ?? 0

    // Map only remembers what was open: here nothing, so it opens everything.
    await panelCommand(first.app, 'map-only')
    await expect(cameras).toBeVisible()
    await expect(photos).toBeVisible()
    await expect(metadata).toBeVisible()
    expect(Math.abs((await width(page, 'Cameras')) - grown)).toBeLessThan(3)
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeLessThan(fullWidth)

    // Map only, then back: only the panels that were open return.
    await panelCommand(first.app, 'metadata')
    await toggles.getByRole('button', { name: 'Map only' }).click()
    await expect(cameras).toBeHidden()
    await expect(photos).toHaveCount(0)
    await toggles.getByRole('button', { name: 'Map only' }).click()
    await expect(cameras).toBeVisible()
    await expect(photos).toBeVisible()
    await expect(metadata).toHaveCount(0)

    // Dragging the photos separator far down snaps the panel shut.
    const photoSeparator = separators.nth(1)
    const box = await photoSeparator.boundingBox()
    if (!box) throw new Error('no separator')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 250, { steps: 10 })
    await page.mouse.up()
    await expect(photos).toHaveCount(0)
    await panelCommand(first.app, 'photos')
    await expect(photos).toBeVisible()
    expect((await photos.boundingBox())?.height ?? 0).toBeGreaterThan(200)

    // Metadata hidden survives a relaunch, and the cameras width too.
    await first.app.close()
    second = await launchApp({ STECKNADEL_USER_DATA: first.userData })
    const again = await second.firstWindow()
    await expect(again.getByRole('complementary', { name: 'Cameras' })).toBeVisible()
    await expect(again.getByRole('complementary', { name: 'Metadata' })).toHaveCount(0)
    expect(Math.abs((await width(again, 'Cameras')) - grown)).toBeLessThan(3)
    await panelCommand(second, 'metadata')
    await expect(again.getByRole('complementary', { name: 'Metadata' })).toBeVisible()
    expect(await width(again, 'Metadata')).toBeGreaterThanOrEqual(240)
  } finally {
    await second?.close()
    await first.close().catch(() => {})
    await rm(first.userData, { recursive: true, force: true })
    await rm(folder, { recursive: true, force: true })
  }
})

test('photo list sorts, and the toolbar filters by camera and status', async () => {
  const exiftool = new ExifTool()
  const dir = await mkdtemp(join(tmpdir(), 'steck-list-'))
  const photos: Record<string, { model: string; dto: string; gps?: boolean }> = {
    'a.jpg': { model: 'Camera A', dto: '2026:06:01 09:30:00' },
    'b-day2.jpg': { model: 'Camera B', dto: '2026:06:02 10:00:00' },
    'b-late.jpg': { model: 'Camera B', dto: '2026:06:05 12:00:00' },
    'c-gps.jpg': { model: 'Camera C', dto: '2026:06:01 09:00:00', gps: true },
  }
  for (const [name, p] of Object.entries(photos)) {
    const file = join(dir, name)
    await copyFile(join(fixtures, 'base.jpg'), file)
    await exiftool.write(
      file,
      {
        Make: 'E2E',
        Model: p.model,
        SerialNumber: p.model.slice(-1),
        DateTimeOriginal: p.dto,
        ...(p.gps
          ? { GPSLatitude: 46.5, GPSLatitudeRef: 'N', GPSLongitude: 8, GPSLongitudeRef: 'E' }
          : {}),
      },
      { writeArgs: ['-overwrite_original'] },
    )
  }
  await exiftool.end()
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, dir)
    await app.evaluate(
      ({ dialog }, chosen) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [chosen],
        })) as unknown as typeof dialog.showOpenDialog
      },
      join(fixtures, 'synthetic-trip.gpx'),
    )
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    await expect(page.getByTestId('photo-status')).toHaveCount(4)
    await expect(page.getByTestId('preview-state')).toBeHidden()

    const toolbar = page.getByRole('group', { name: 'Photo view' })
    await toolbar.getByRole('button', { name: 'List' }).click()
    const rows = page.getByTestId('photo-row')
    await expect(rows).toHaveCount(4)
    const names = rows.getByRole('button')

    const nameHeader = page.getByRole('columnheader', { name: 'Name' })
    await nameHeader.getByRole('button').click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(names).toHaveText(['a.jpg', 'b-day2.jpg', 'b-late.jpg', 'c-gps.jpg'])
    await nameHeader.getByRole('button').click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    await expect(names).toHaveText(['c-gps.jpg', 'b-late.jpg', 'b-day2.jpg', 'a.jpg'])

    const status = toolbar.getByRole('group', { name: 'Status' })
    await status.getByRole('button', { name: /Needs attention/ }).click()
    await expect(names).toHaveText(['b-late.jpg'])
    await status.getByRole('button', { name: /has GPS/ }).click()
    await expect(names).toHaveText(['c-gps.jpg'])
    await status.getByRole('button', { name: /Placed/ }).click()
    await expect(names).toHaveText(['b-day2.jpg', 'a.jpg'])

    // With the camera list hidden the toolbar picks the camera; the filter is the sidebar's.
    await expect(toolbar.getByRole('combobox', { name: 'Camera' })).toHaveCount(0)
    await panelCommand(app, 'cameras')
    await toolbar.getByRole('combobox', { name: 'Camera' }).click()
    await page.getByRole('option', { name: /Camera C/ }).click()
    await panelCommand(app, 'cameras')
    await expect(
      page
        .getByTestId('camera')
        .filter({ hasText: 'Camera C' })
        .getByRole('button', { pressed: true }),
    ).toHaveCount(1)
    await expect(page.getByText('No photos match')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(rows).toHaveCount(4)
    if (process.env.STECKNADEL_SHOTS) await page.screenshot({ path: '/tmp/steck-list.png' })
    await expect(page.getByRole('button', { name: /^All photos/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // A click beside the rows clears the selection.
    await rows.first().click()
    await expect(
      page.getByRole('complementary', { name: 'Metadata' }).locator('input'),
    ).toBeVisible()
    // Below the last row (the bottom edge can be a horizontal scrollbar).
    const last = await rows.last().boundingBox()
    if (!last) throw new Error('no row')
    await page.mouse.click(last.x + 40, last.y + last.height + 20)
    await expect(
      page.getByRole('complementary', { name: 'Metadata' }).locator('input'),
    ).toHaveCount(0)
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
  }
})
