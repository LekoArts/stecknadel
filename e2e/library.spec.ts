import { rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { copyFixtures, launchWithProfile, openFolder } from './helpers/library'

test('opens a folder, lists cameras, shows thumbnails and read-only metadata', async () => {
  const folder = await copyFixtures()
  const { app, page, close } = await launchWithProfile()
  try {
    await openFolder(app, page, folder)

    const tiles = page.getByTestId('photo-tile')
    await expect(tiles).toHaveCount(11)

    const cameras = page.getByTestId('camera')
    // Canon EOS R, two Fujifilm bodies, Nikon Z6, Ricoh GR III, Sony a7 III, the generated
    // camera, plus the ExifTool samples' own cameras.
    await expect(cameras.first()).toBeVisible()
    const names = await page.getByTestId('camera-name').allInnerTexts()
    console.log(`cameras: ${names.join(' | ')}`)
    for (const model of ['EOS R', 'X-T4', 'NIKON Z 6', 'GR III', 'ILCE-7M3']) {
      expect(
        names.some((n) => n.includes(model)),
        model,
      ).toBe(true)
    }

    // Thumbnails: every RAW with an embedded preview renders a decoded image from the thumb scheme.
    await expect
      .poll(
        () =>
          page.$$eval(
            '[data-testid="photo-tile"] img',
            (imgs) =>
              (imgs as HTMLImageElement[]).filter(
                (img) =>
                  img.complete &&
                  img.naturalWidth >= 64 &&
                  img.src.startsWith('stecknadel-thumb://'),
              ).length,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(6)

    await tiles.filter({ hasText: 'Sony-a7III.ARW' }).click()
    const metadata = page.getByTestId('metadata')
    await expect(metadata.getByText('Make', { exact: true }).first()).toBeVisible()
    await expect(metadata.getByText('SONY', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByRole('complementary', { name: 'Metadata' }).locator('input'),
    ).toHaveCount(1)

    // Filtering the grid by camera, and renaming it, persists across the session.
    const sony = cameras.filter({ hasText: 'ILCE-7M3' })
    await sony
      .getByRole('button', { name: /ILCE-7M3/ })
      .first()
      .click()
    await expect(tiles).toHaveCount(1)
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
