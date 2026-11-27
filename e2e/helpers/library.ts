import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { launchApp } from './app'

const fixtures = join(__dirname, '../../test/fixtures')

export interface LibraryApp {
  app: ElectronApplication
  page: Page
  userData: string
  close: () => Promise<void>
}

/** Launches the packaged app with a throwaway profile. */
export async function launchWithProfile(): Promise<LibraryApp> {
  const userData = await mkdtemp(join(tmpdir(), 'steck-profile-'))
  const app = await launchApp({ STECKNADEL_USER_DATA: userData })
  const page = await app.firstWindow()
  return {
    app,
    page,
    userData,
    close: async () => {
      await app.close()
      await rm(userData, { recursive: true, force: true })
    },
  }
}

/** Makes main's folder dialog return `folder` without showing anything, then clicks "Open folder". */
export async function openFolder(
  app: ElectronApplication,
  page: Page,
  folder: string,
): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as unknown as typeof dialog.showOpenDialog
  }, folder)
  await page.getByRole('button', { name: 'Open folder', exact: true }).click()
}

/** A temp copy of the CC0 fixture RAWs, the ExifTool samples and the generated JPEG. */
export async function copyFixtures(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'steck-library-'))
  await cp(join(fixtures, 'cache'), join(dir, 'samples'), {
    recursive: true,
    // `cache/demo` holds `pnpm make-demo`'s downloads, not test fixtures.
    filter: (src) => !src.endsWith('.txt') && basename(src) !== 'demo',
  })
  await cp(join(fixtures, 'generated/smoke.jpg'), join(dir, 'smoke.jpg'))
  return dir
}

/** Picks a zone (or "Fixed UTC offset") in the camera-time zone picker labelled `label`. */
export async function pickZone(scope: Locator, label: string, zone: string): Promise<void> {
  await scope.getByRole('combobox', { name: label }).click()
  const page = scope.page()
  const search = page.getByPlaceholder('City, zone or offset')
  if (zone === 'fixed') {
    await search.fill('fixed')
    await page.getByRole('option', { name: 'Fixed UTC offset' }).click()
  } else {
    await search.fill(zone)
    await page
      .getByRole('option', { name: new RegExp(`^${zone.replaceAll('_', ' ')}\\b`) })
      .first()
      .click()
  }
}
