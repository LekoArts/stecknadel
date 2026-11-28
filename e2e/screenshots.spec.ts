// README screenshots from the made-up demo trip (`pnpm make-demo`), never from real data:
//   pnpm make-demo && STECKNADEL_SCREENSHOTS=1 pnpm exec playwright test --project=packaged-dir e2e/screenshots.spec.ts
// Writes docs/screenshots/{map,cameras,report}.png. The map needs the network for its tiles.
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchWithProfile, openFolder } from './helpers/library'

const demo = join(__dirname, '../test/fixtures/demo')
const out = join(__dirname, '../docs/screenshots')

test.skip(
  !process.env.STECKNADEL_SCREENSHOTS,
  'set STECKNADEL_SCREENSHOTS=1 to update the README images',
)

test('README screenshots', async () => {
  test.setTimeout(180_000)
  // A copy: the report screenshot writes to the photos.
  const dir = await mkdtemp(join(tmpdir(), 'steck-shots-'))
  await cp(join(demo, 'photos'), join(dir, 'photos'), { recursive: true })
  const { app, page, close } = await launchWithProfile()
  try {
    const win = await app.browserWindow(page)
    await win.evaluate((w) => w.setSize(1440, 900))
    await openFolder(app, page, join(dir, 'photos'))
    await expect(page.getByTestId('photo-tile').first()).toBeVisible({ timeout: 30_000 })
    await app.evaluate(
      ({ dialog }, chosen) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [chosen],
        })) as unknown as typeof dialog.showOpenDialog
      },
      join(demo, 'track/san-francisco-to-seoul.gpx'),
    )
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    await expect(page.getByTestId('track-summary')).toBeVisible()
    await expect(page.getByTestId('preview-state')).toBeHidden({ timeout: 60_000 })
    // Tiles and the fit-to-pins animation.
    await page.waitForTimeout(4000)
    await page.screenshot({ path: join(out, 'map.png') })

    await page.getByTestId('camera').filter({ hasText: /ricoh/i }).first().click()
    await page
      .getByRole('heading', { name: 'Camera time' })
      .evaluate((h) => h.scrollIntoView({ block: 'start' }))
    await page.mouse.move(1300, 400) // off the camera list: no hover highlight
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, 'cameras.png') })

    await page.getByRole('button', { name: 'All cameras' }).click()
    await page.getByTestId('write-button').click()
    const confirm = page.getByRole('dialog', { name: /^Write \d+ positions$/ })
    await confirm.getByRole('button', { name: 'Write', exact: true }).click()
    const report = page.getByRole('dialog', { name: /^Wrote \d+ positions$/ })
    await expect(report).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(out, 'report.png') })
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
  }
})
