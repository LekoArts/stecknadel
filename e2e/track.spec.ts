import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchWithProfile } from './helpers/library'

const KEY = 'e2e-secret-key-7f3a'
const gpx = join(__dirname, '../test/fixtures/synthetic-trip.gpx')

/** A Dawarich stand-in: 3 pages of 2 points, one flagged as an anomaly. */
async function mockDawarich(): Promise<{ url: string; auth: string[]; server: Server }> {
  const auth: string[] = []
  const server = createServer((req, res) => {
    auth.push(req.headers.authorization ?? '')
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401)
      res.end()
      return
    }
    const page = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('page'))
    const points = [0, 1].map((i) => ({
      latitude: String(46.5 + page / 100),
      longitude: String(7.5 + i / 100),
      altitude: 1000,
      timestamp: Date.UTC(2026, 5, 1, 6, page, i) / 1000,
      anomaly: page === 3 && i === 1,
    }))
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-total-pages': '3',
      'x-dawarich-version': '1.23.0',
    })
    res.end(JSON.stringify(points))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, auth, server }
}

test('loads a GPX track and shows its points and time span', async () => {
  const { app, page, close } = await launchWithProfile()
  try {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [chosen],
      })) as unknown as typeof dialog.showOpenDialog
    }, gpx)
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    const summary = page.getByTestId('track-summary')
    await expect(summary).toContainText('synthetic-trip.gpx')
    await expect(summary).toContainText('663 points')
    await expect(summary).toContainText('2026-06-01 06:00 – 2026-06-02 12:00 UTC')
  } finally {
    await close()
  }
})

test('fetches a track from Dawarich; the API key never reaches the renderer', async () => {
  const dawarich = await mockDawarich()
  const { page, close } = await launchWithProfile()
  try {
    await page.getByRole('button', { name: 'Fetch from Dawarich' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Server address').fill(dawarich.url)
    await dialog.getByLabel('API key').fill('wrong-key')
    await dialog.getByRole('button', { name: 'Test connection' }).click()
    await expect(dialog.getByTestId('dawarich-status')).toContainText('API key was rejected')

    await dialog.getByLabel('API key').fill(KEY)
    await dialog.getByRole('button', { name: 'Test connection' }).click()
    await expect(dialog.getByTestId('dawarich-status')).toHaveText('Connected · Dawarich 1.23.0')

    await dialog.getByLabel('From (UTC)').fill('2026-06-01T00:00')
    await dialog.getByLabel('To (UTC)').fill('2026-06-02T00:00')
    await dialog.getByRole('button', { name: 'Fetch track' }).click()
    await expect(dialog).toBeHidden()
    const summary = page.getByTestId('track-summary')
    await expect(summary).toContainText('Dawarich')
    await expect(summary).toContainText('5 points · 1 skipped')
    await expect(page.getByRole('button', { name: 'Fetch from Dawarich' })).toBeFocused()

    // Only the bearer header ever carried the key; the renderer only learns that one is saved.
    expect(new Set(dawarich.auth)).toEqual(new Set(['Bearer wrong-key', `Bearer ${KEY}`]))
    const visible = await page.evaluate(async () => {
      const api = window.stecknadel as unknown as Record<string, unknown>
      return {
        names: Object.keys(api).sort(),
        state: JSON.stringify(await window.stecknadel.getTrackState()),
        dom: document.documentElement.outerHTML,
      }
    })
    expect(visible.names.some((n) => /key|secret/i.test(n))).toBe(false)
    expect(visible.state).not.toContain(KEY)
    expect(visible.state).toContain('"hasKey":true')
    expect(visible.dom).not.toContain(KEY)

    // Reopening keeps the address; the key field is empty and says a key is saved.
    await page.getByRole('button', { name: 'Fetch from Dawarich' }).click()
    await expect(dialog.getByLabel('Server address')).toHaveValue(`${dawarich.url}/`)
    await expect(dialog.getByLabel('API key')).toHaveValue('')
    await expect(dialog.getByLabel('API key')).toHaveAttribute('placeholder', /Saved/)
  } finally {
    await close()
    dawarich.server.close()
  }
})
