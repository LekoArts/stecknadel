import { rm } from 'node:fs/promises'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchApp } from './helpers/app'
import { copyFixtures, launchWithProfile, openFolder } from './helpers/library'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

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
    const toggles = page.getByRole('toolbar', { name: 'Panels' })

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
    await page.keyboard.press(`${mod}+2`)
    await expect(photos).toHaveCount(0)
    await page.keyboard.press(`${mod}+3`)
    await expect(metadata).toHaveCount(0)
    const canvas = page.locator('canvas.maplibregl-canvas')
    const fullWidth = (await canvas.boundingBox())?.width ?? 0
    const window = page.viewportSize()?.width ?? (await page.evaluate(() => innerWidth))
    expect(fullWidth).toBeGreaterThan(window - 4)

    // Map only remembers what was open: here nothing, so it opens everything.
    await page.keyboard.press(`${mod}+0`)
    await expect(cameras).toBeVisible()
    await expect(photos).toBeVisible()
    await expect(metadata).toBeVisible()
    expect(Math.abs((await width(page, 'Cameras')) - grown)).toBeLessThan(3)
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeLessThan(fullWidth)

    // Map only, then back: only the panels that were open return.
    await page.keyboard.press(`${mod}+3`)
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
    await page.keyboard.press(`${mod}+2`)
    await expect(photos).toBeVisible()
    expect((await photos.boundingBox())?.height ?? 0).toBeGreaterThan(200)

    // Metadata hidden survives a relaunch, and the cameras width too.
    await first.app.close()
    second = await launchApp({ STECKNADEL_USER_DATA: first.userData })
    const again = await second.firstWindow()
    await expect(again.getByRole('complementary', { name: 'Cameras' })).toBeVisible()
    await expect(again.getByRole('complementary', { name: 'Metadata' })).toHaveCount(0)
    expect(Math.abs((await width(again, 'Cameras')) - grown)).toBeLessThan(3)
    await again.keyboard.press(`${mod}+3`)
    await expect(again.getByRole('complementary', { name: 'Metadata' })).toBeVisible()
    expect(await width(again, 'Metadata')).toBeGreaterThanOrEqual(240)
  } finally {
    await second?.close()
    await first.close().catch(() => {})
    await rm(first.userData, { recursive: true, force: true })
    await rm(folder, { recursive: true, force: true })
  }
})
