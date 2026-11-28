import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/app'

test('window opens with the security baseline', async () => {
  // A normal launch: no test-only debug surface.
  const app = await launchApp({ STECKNADEL_E2E: '' })
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('Stecknadel')
    await expect(page.getByRole('heading', { name: 'Stecknadel' })).toBeVisible()

    const renderer = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      api: Object.keys(window.stecknadel),
      debug: 'stecknadelDebug' in window,
    }))
    expect(renderer.require).toBe('undefined')
    expect(renderer.process).toBe('undefined')
    expect(renderer.debug).toBe(false)
    expect(renderer.api.sort()).toEqual([
      'choosePmtiles',
      'cleanupBackups',
      'dismissWrite',
      'exportReport',
      'fetchDawarich',
      'getAppInfo',
      'getMetadata',
      'getSettings',
      'getThumbnail',
      'getTrackGeometry',
      'getTrackState',
      'getTrackZones',
      'inspectWrite',
      'listWrites',
      'loadGpx',
      'on',
      'openFolder',
      'reloadFolder',
      'renameCamera',
      'restoreOriginals',
      'restoreValues',
      'runPreview',
      'saveDawarichSettings',
      'saveSettings',
      'testDawarich',
      'writePhotos',
    ])

    const rendererSandboxed = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
      return electronApp.getAppMetrics().find((m) => m.pid === pid)?.sandboxed
    })
    expect(rendererSandboxed).toBe(true)

    // CSP: an inline <script> injected into the page must be refused (script-src falls back to 'self').
    const csp = await page.evaluate(
      () =>
        new Promise<{ violated: string | null; ran: boolean }>((resolve) => {
          const w = window as unknown as { __inlineRan?: boolean }
          let violated: string | null = null
          document.addEventListener('securitypolicyviolation', (e) => {
            violated = e.effectiveDirective
          })
          const script = document.createElement('script')
          script.textContent = 'window.__inlineRan = true'
          document.head.append(script)
          setTimeout(() => resolve({ violated, ran: w.__inlineRan === true }), 200)
        }),
    )
    expect(csp).toEqual({ violated: 'script-src-elem', ran: false })

    const info = await page.evaluate(() => window.stecknadel.getAppInfo())
    expect(info.exiftoolVersion).toMatch(/^\d+\.\d+/)
    await expect(
      page.evaluate(() =>
        (window.stecknadel.getAppInfo as (x: unknown) => Promise<unknown>)({ path: '/etc' }),
      ),
    ).rejects.toThrow(/invalid input/)
  } finally {
    await app.close()
  }
})
