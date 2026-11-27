import { rm } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { copyFixtures, launchWithProfile, openFolder } from './helpers/library'

/** Names of tiles showing a decoded thumbnail, collected across the whole (virtualized) grid. */
async function decodedThumbnails(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="photo-grid"]') as HTMLElement
    const names = new Set<string>()
    for (let top = 0; ; top += grid.clientHeight / 2) {
      grid.scrollTop = top
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      for (const tile of document.querySelectorAll('[data-testid="photo-tile"]')) {
        const img = tile.querySelector('img')
        if (img?.complete && img.naturalWidth >= 64 && img.src.startsWith('stecknadel-thumb://')) {
          names.add(tile.querySelector('span')?.textContent ?? '')
        }
      }
      if (top >= grid.scrollHeight - grid.clientHeight) break
    }
    grid.scrollTop = 0
    return [...names].sort()
  })
}

test('opens a folder, lists cameras, shows thumbnails and read-only metadata', async () => {
  const folder = await copyFixtures()
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, folder)
    await expect(page.getByRole('button', { name: 'All cameras' })).toContainText('11')

    const cameras = page.getByTestId('camera')
    await expect(cameras).toHaveCount(11)
    const names = await page.getByTestId('camera-name').allInnerTexts()
    console.log(`cameras: ${names.join(' | ')}`)
    for (const model of ['EOS R', 'X-T4', 'NIKON Z 6', 'GR III', 'ILCE-7M3']) {
      expect(
        names.some((n) => n.includes(model)),
        model,
      ).toBe(true)
    }

    // Every RAW with an embedded preview renders a decoded image from the thumbnail scheme.
    const withPreview = [
      'Canon-EOS-R.CR3',
      'Fujifilm-X-T4.RAF',
      'Nikon-Z6.NEF',
      'Ricoh-GR-III.DNG',
      'Sony-a7III.ARW',
      'exiftool-FujiFilm.raf',
    ]
    await expect
      .poll(() => decodedThumbnails(page), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(withPreview))

    // Filtering by camera narrows the grid; the metadata panel is read-only apart from its filter.
    const sony = cameras.filter({ hasText: 'ILCE-7M3' })
    await sony
      .getByRole('button', { name: /ILCE-7M3/ })
      .first()
      .click()
    const tiles = page.getByTestId('photo-tile')
    await expect(tiles).toHaveCount(1)
    await tiles.first().click()
    const metadata = page.getByTestId('metadata')
    await expect(metadata.getByText('Make', { exact: true }).first()).toBeVisible()
    await expect(metadata.getByText('SONY', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByRole('complementary', { name: 'Metadata' }).locator('input'),
    ).toHaveCount(1)

    // Clicking the grid's empty area, or Escape, clears the selection.
    const grid = page.getByTestId('photo-grid')
    const box = await grid.boundingBox()
    if (!box) throw new Error('grid not laid out')
    await page.mouse.click(box.x + box.width - 40, box.y + box.height - 40)
    await expect(tiles.first()).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('Select a photo to see its metadata')).toBeVisible()
    await tiles.first().click()
    await expect(tiles.first()).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(tiles.first()).toHaveAttribute('aria-pressed', 'false')

    await sony.hover()
    await sony.getByRole('button', { name: /^Rename/ }).click()
    await page.getByRole('textbox', { name: /^Name for/ }).fill('Travel Sony')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('camera-name').filter({ hasText: 'Travel Sony' })).toBeVisible()
  } finally {
    await close()
    await rm(folder, { recursive: true, force: true })
  }
})
