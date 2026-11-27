// One-off: renders build/icon.svg to build/icon.png (1024×1024) with Playwright Chromium.
// electron-builder derives .ico/.icns from the PNG. Run: node scripts/render-icon.mjs
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const svgPath = fileURLToPath(new URL('../build/icon.svg', import.meta.url))
const pngPath = fileURLToPath(new URL('../build/icon.png', import.meta.url))

const svg = await readFile(svgPath, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
await page.locator('svg').screenshot({ path: pngPath, omitBackground: true })
await browser.close()
console.log(`wrote ${pngPath}`)
