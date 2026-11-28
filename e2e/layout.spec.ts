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

    // Dragging a panel shut leaves focus on its toggle, not lost on the page.
    await cameras.getByRole('button', { name: /^All cameras/ }).focus()
    const cameraSeparator = await separators.first().boundingBox()
    if (!cameraSeparator) throw new Error('no separator')
    await page.mouse.move(cameraSeparator.x + 2, cameraSeparator.y + 100)
    await page.mouse.down()
    await page.mouse.move(cameraSeparator.x - 400, cameraSeparator.y + 100, { steps: 10 })
    await page.mouse.up()
    await expect(cameras).toBeHidden()
    await expect(toggles.getByRole('button', { name: 'Cameras' })).toBeFocused()
    await panelCommand(first.app, 'cameras')
    await expect(cameras).toBeVisible()
    expect(Math.abs((await width(page, 'Cameras')) - grown)).toBeLessThan(3)

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

test('Cmd/Ctrl+1/3/0 key presses toggle the panels; nothing else in the menu claims them', async () => {
  const { app, page, close } = await launchWithProfile()
  try {
    // Native input events: they take the same route through main as a real key press.
    const press = (key: string) =>
      app.evaluate(({ BrowserWindow }, keyCode) => {
        const modifiers: ('meta' | 'control')[] = [
          process.platform === 'darwin' ? 'meta' : 'control',
        ]
        const { webContents } = BrowserWindow.getAllWindows()[0]
        webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      }, key)
    const cameras = page.getByRole('complementary', { name: 'Cameras' })
    const metadata = page.getByRole('complementary', { name: 'Metadata' })
    await expect(metadata).toBeVisible()
    await press('3')
    await expect(metadata).toHaveCount(0)
    await press('3')
    await expect(metadata).toBeVisible()
    await press('1')
    await expect(cameras).toBeHidden()
    await press('1')
    await expect(cameras).toBeVisible()
    await press('0')
    await expect(cameras).toBeHidden()
    await expect(metadata).toHaveCount(0)
    await press('0')
    await expect(cameras).toBeVisible()
    await expect(metadata).toBeVisible()
    // Two quick presses, no waiting between: back where it started.
    await press('1')
    await press('1')
    await expect(cameras).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cameras', pressed: true })).toBeVisible()

    const claimed = await app.evaluate(({ Menu }) => {
      const out: { id: string; accelerator: string }[] = []
      const walk = (menu: Electron.Menu): void => {
        for (const item of menu.items) {
          if (item.accelerator) out.push({ id: item.id, accelerator: item.accelerator })
          if (item.submenu) walk(item.submenu)
        }
      }
      const menu = Menu.getApplicationMenu()
      if (menu) walk(menu)
      return out
    })
    for (const key of ['1', '2', '3', '0']) {
      const owners = claimed.filter((a) => a.accelerator === `CmdOrCtrl+${key}`)
      expect(owners.map((a) => a.id)).toEqual([expect.stringMatching(/^panel-/)])
    }
  } finally {
    await close()
  }
})

test('selecting an off-screen photo scrolls its list row into view below the header', async () => {
  const exiftool = new ExifTool()
  const dir = await mkdtemp(join(tmpdir(), 'steck-long-list-'))
  for (let i = 1; i <= 30; i++) {
    const file = join(dir, `p${String(i).padStart(2, '0')}.jpg`)
    await copyFile(join(fixtures, 'base.jpg'), file)
    // After the synthetic track ends, so every photo is in the map's "Not placed" list.
    await exiftool.write(
      file,
      {
        Make: 'E2E',
        Model: 'Camera A',
        SerialNumber: 'A',
        DateTimeOriginal: '2026:06:05 12:00:00',
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
    await expect(page.getByTestId('not-placed').getByRole('button').first()).toContainText('30')
    await page
      .getByRole('group', { name: 'Photo view' })
      .getByRole('button', { name: 'List' })
      .click()
    await page.getByRole('columnheader', { name: 'Name' }).getByRole('button').click()

    const list = page.getByTestId('photo-list')
    const header = page.getByRole('row').first()
    const notPlaced = page.getByTestId('not-placed')
    const fullyVisible = async (name: string): Promise<boolean> => {
      const row = page.getByTestId('photo-row').filter({ hasText: name })
      if ((await row.count()) === 0) return false
      const [r, h, l] = await Promise.all([
        row.boundingBox(),
        header.boundingBox(),
        list.boundingBox(),
      ])
      if (!r || !h || !l) return false
      return r.y >= h.y + h.height - 1 && r.y + r.height <= l.y + l.height + 1
    }

    // Below the viewport.
    expect(await fullyVisible('p30.jpg')).toBe(false)
    await notPlaced.getByRole('button', { name: /p30\.jpg/ }).click()
    await expect.poll(() => fullyVisible('p30.jpg')).toBe(true)
    // Above it: must land below the sticky header, not under it.
    expect(await fullyVisible('p02.jpg')).toBe(false)
    await notPlaced.getByRole('button', { name: /p02\.jpg/ }).click()
    await expect.poll(() => fullyVisible('p02.jpg')).toBe(true)
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
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
    // Panel commands wait out open popovers.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await panelCommand(app, 'cameras')
    await expect.poll(() => width(page, 'Cameras')).toBeGreaterThan(200)
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
    await expect(page.getByRole('button', { name: /^All cameras/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Columns resize by dragging their edge, by arrow keys, and reset on double-click.
    const captured = page.getByRole('columnheader', { name: 'Captured' })
    const capturedWidth = async (): Promise<number> => (await captured.boundingBox())?.width ?? 0
    const before = await capturedWidth()
    const edge = await captured.getByRole('separator').boundingBox()
    if (!edge) throw new Error('no resize handle')
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2)
    await page.mouse.down()
    await page.mouse.move(edge.x + edge.width / 2 + 60, edge.y + edge.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect.poll(capturedWidth).toBeCloseTo(before + 60, 0)
    // The rows follow the header (thumbnail, name, camera, captured).
    const cell = async () => (await rows.first().getByRole('cell').nth(3).boundingBox())?.width
    await expect.poll(cell).toBeCloseTo(before + 60, 0)
    await captured.getByRole('separator').press('ArrowLeft')
    await expect.poll(capturedWidth).toBeCloseTo(before + 52, 0)
    await captured.getByRole('separator').dblclick()
    await expect.poll(capturedWidth).toBeCloseTo(before, 0)
    // Name narrows too, even with room to spare: the last column takes the spare room.
    const name = page.getByRole('columnheader', { name: 'Name' })
    const nameWidth = async (): Promise<number> => (await name.boundingBox())?.width ?? 0
    const nameBefore = await nameWidth()
    await name.getByRole('separator').press('Shift+ArrowLeft')
    await expect.poll(nameWidth).toBeCloseTo(nameBefore - 32, 0)

    // The grid's thumbnail size slider.
    await toolbar.getByRole('button', { name: 'Grid' }).click()
    const tile = page.getByTestId('photo-tile').first()
    expect((await tile.boundingBox())?.width).toBeCloseTo(184, 0)
    await toolbar.getByRole('slider', { name: 'Thumbnail size' }).press('End')
    await expect.poll(async () => (await tile.boundingBox())?.width).toBeCloseTo(280, 0)
    await toolbar.getByRole('slider', { name: 'Thumbnail size' }).press('Home')
    await expect.poll(async () => (await tile.boundingBox())?.width).toBeCloseTo(120, 0)
    // Both survive a reload.
    await page.reload()
    await openFolder(app, page, dir)
    await expect.poll(async () => (await tile.boundingBox())?.width).toBeCloseTo(120, 0)
    await toolbar.getByRole('button', { name: 'List' }).click()
    await expect(toolbar.getByRole('slider')).toHaveCount(0)
    await expect.poll(nameWidth).toBeCloseTo(nameBefore - 32, 0)
    await name.getByRole('separator').press('Home')

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
