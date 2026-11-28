// The release artifacts' end-to-end check (`--project=installed`, STECKNADEL_APP_PATH = the
// installed NSIS exe or the app copied out of the dmg): load → preview → write, then ExifTool
// reads every file back and it must equal the oracle. Synthetic data only.
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { ExifTool } from 'exiftool-vendored'
import {
  DEG_TOLERANCE,
  distanceMeters,
  ELE_TOLERANCE,
  expectedMatch,
  expectedSkipped,
  expectedStay,
  type OraclePosition,
  readGpxPoints,
} from '../test/oracle/expected'
import { launchWithProfile, openFolder } from './helpers/library'

const exiftool = new ExifTool()
test.afterAll(() => exiftool.end())

const fixtures = join(__dirname, '../test/fixtures')
const gpx = join(fixtures, 'synthetic-trip.gpx')

type Case = {
  name: string
  src: string
  /** Wall time = UTC: every photo records +00:00. */
  utc: string
  expect: 'matched' | 'matched-stay' | 'before-track' | 'has-gps'
  gps?: boolean
}

const CASES: Case[] = [
  { name: 'moving.jpg', src: 'base.jpg', utc: '2026-06-01T08:00:00Z', expect: 'matched' },
  {
    name: 'moving.dng',
    src: 'cache/Ricoh-GR-III.DNG',
    utc: '2026-06-01T14:10:00Z',
    expect: 'matched',
  },
  { name: 'stay.jpg', src: 'base.jpg', utc: '2026-06-01T11:30:00Z', expect: 'matched-stay' },
  { name: 'before.jpg', src: 'base.jpg', utc: '2026-05-30T12:00:00Z', expect: 'before-track' },
  {
    name: 'tagged.jpg',
    src: 'base.jpg',
    utc: '2026-06-02T09:00:00Z',
    expect: 'has-gps',
    gps: true,
  },
]

const exifTime = (iso: string): string => iso.slice(0, 19).replace('T', ' ').replaceAll('-', ':')

test('installed app: geotags synthetic photos exactly as the oracle says', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(join(tmpdir(), 'steck-packaged-'))
  const track = readGpxPoints(await readFile(gpx, 'utf8'))
  const before = new Map<string, string>()
  for (const c of CASES) {
    const file = join(dir, c.name)
    await copyFile(join(fixtures, c.src), file)
    await exiftool.write(
      file,
      {
        Make: 'E2E',
        Model: 'Packaged',
        SerialNumber: 'P1',
        DateTimeOriginal: exifTime(c.utc),
        ...(c.gps
          ? { GPSLatitude: 10, GPSLatitudeRef: 'N', GPSLongitude: 20, GPSLongitudeRef: 'E' }
          : {}),
        // After DateTimeOriginal, or it doesn't stick.
        OffsetTimeOriginal: '+00:00',
      },
      { writeArgs: ['-overwrite_original'] },
    )
    before.set(c.name, await expectedSkipped(file))
  }

  const { app, page, close } = await launchWithProfile()
  const rows: string[] = []
  try {
    await openFolder(app, page, dir)
    await expect(page.getByTestId('photo-tile')).toHaveCount(CASES.length, { timeout: 30_000 })
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [chosen],
      })) as unknown as typeof dialog.showOpenDialog
    }, gpx)
    await page.getByRole('button', { name: 'Open GPX file' }).click()
    await expect(page.getByTestId('track-summary')).toContainText('663 points')
    await expect(page.getByTestId('preview-state')).toBeHidden({ timeout: 60_000 })

    await page.getByRole('button', { name: 'Write', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Write 3 positions' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Write', exact: true }).click()
    const report = page.getByRole('dialog', { name: 'Wrote 3 positions' })
    await expect(report).toBeVisible({ timeout: 60_000 })
    await expect(
      report.getByTestId('report-filters').locator('[data-outcome="failed"]'),
    ).toHaveCount(0)
    await report.getByRole('button', { name: 'Done' }).click()
  } finally {
    await close()
  }

  let failures = 0
  for (const c of CASES) {
    const file = join(dir, c.name)
    const utc = Date.parse(c.utc) / 1000
    if (c.expect === 'before-track' || c.expect === 'has-gps') {
      const same = (await expectedSkipped(file)) === before.get(c.name)
      if (!same) failures++
      rows.push([c.name, c.expect, '-', 'unchanged', '-', same ? 'OK' : 'CHANGED'].join(' | '))
      continue
    }
    const want = (c.expect === 'matched' ? expectedMatch : expectedStay)(
      track,
      utc,
    ) as OraclePosition
    const tags = await exiftool.read(file, { readArgs: ['-n'] })
    const got = {
      lat: Number(tags.GPSLatitude),
      lon: Number(tags.GPSLongitude),
      ele: tags.GPSAltitude === undefined ? undefined : Number(tags.GPSAltitude),
    }
    const ok =
      Math.abs(got.lat - want.lat) <= DEG_TOLERANCE &&
      Math.abs(got.lon - want.lon) <= DEG_TOLERANCE &&
      (want.ele === undefined || Math.abs((got.ele ?? Number.NaN) - want.ele) <= ELE_TOLERANCE)
    if (!ok) failures++
    const fmt = (p: { lat: number; lon: number; ele?: number }) =>
      `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}, ${p.ele?.toFixed(2) ?? '-'}`
    rows.push(
      [
        c.name,
        c.expect,
        fmt(got),
        fmt(want),
        distanceMeters(got, want).toFixed(2),
        ok ? 'OK' : 'MISMATCH',
      ].join(' | '),
    )
  }
  console.log(
    ['READBACK', 'file | status | written lat, lon, alt | expected | Δ m | verdict', ...rows].join(
      '\n',
    ),
  )
  expect(failures).toBe(0)
  await rm(dir, { recursive: true, force: true })
})
