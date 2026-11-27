// Generates a made-up trip to try the app's flows by hand: a GPX track and a photo folder
// with several cameras, each set up to exercise a different case. Everything is fabricated.
//
//   pnpm make-demo [out-dir]      (default: test/fixtures/demo, gitignored)
//
// Trip (UTC):
//   Zurich     Jun 10 06:00–18:00   walk, hotel stay 11:00–14:00 (no fixes, ends 30 m apart), walk
//   flight     Jun 10 18:00 – Jun 11 02:00   no fixes
//   New York   Jun 11 13:00–23:00   (UTC−04:00)
//   flight     Jun 12 00:00–14:00   no fixes
//   Vancouver  Jun 12 16:00 – Jun 13 03:00   (UTC−07:00)
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExifTool } from 'exiftool-vendored'

const root = fileURLToPath(new URL('..', import.meta.url))
const base = join(root, 'test/fixtures/base.jpg')
const cache = join(root, 'test/fixtures/cache')
const out = resolve(process.argv[2] ?? join(root, 'test/fixtures/demo'))
const photosDir = join(out, 'photos')

// Deterministic so every run makes the same trip.
let seed = 42
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32
  return seed / 2 ** 32
}
const at = (iso) => Date.parse(iso) / 1000

/** A wandering walk: one fix every 30 s, moving ~1.2 m/s with a slowly turning heading. */
function walk(from, to, start, heading = random() * 360) {
  const points = []
  let { lat, lon } = start
  let h = heading
  for (let t = at(from); t <= at(to); t += 30) {
    points.push({ t, lat, lon, ele: 400 + 20 * Math.sin(t / 900) })
    h += (random() - 0.5) * 40
    const d = 36 / 111_320
    lat += d * Math.cos((h * Math.PI) / 180)
    lon += (d * Math.sin((h * Math.PI) / 180)) / Math.cos((lat * Math.PI) / 180)
  }
  return points
}

const zurichMorning = walk('2026-06-10T06:00:00Z', '2026-06-10T11:00:00Z', {
  lat: 47.3769,
  lon: 8.5417,
})
const hotel = zurichMorning.at(-1)
const zurichAfternoon = walk('2026-06-10T14:00:00Z', '2026-06-10T18:00:00Z', {
  lat: hotel.lat + 0.00027, // ~30 m north: close enough to bridge the stay
  lon: hotel.lon,
})
const newYork = walk('2026-06-11T13:00:00Z', '2026-06-11T23:00:00Z', { lat: 40.758, lon: -73.9855 })
const vancouver = walk('2026-06-12T16:00:00Z', '2026-06-13T03:00:00Z', {
  lat: 49.2827,
  lon: -123.1207,
})
const track = [...zurichMorning, ...zurichAfternoon, ...newYork, ...vancouver]

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="stecknadel demo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Stecknadel demo trip</name></metadata>
  <trk><name>Demo trip</name><trkseg>
${track
  .map(
    (p) =>
      `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele><time>${new Date(p.t * 1000).toISOString().replace('.000', '')}</time></trkpt>`,
  )
  .join('\n')}
  </trkseg></trk>
</gpx>
`

/** EXIF wall time for a UTC instant on a clock set to `offsetHours`, running `driftSec` fast. */
function wall(iso, offsetHours, driftSec = 0) {
  const d = new Date(Date.parse(iso) + (offsetHours * 3600 + driftSec) * 1000)
  return d.toISOString().slice(0, 19).replace(/-/g, ':').replace('T', ' ')
}
const offsetTag = (h) => `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`

const ZRH = 2
const NYC = -4
const YVR = -7
const cam = (model, serial) => ({ Make: 'Demo', Model: model, SerialNumber: serial })

// [file, tags] — the comment says what the app should show for it.
const photos = [
  // Camera A: clock left on Zurich time all trip. Zone detection assumes the clock was changed
  // and guesses New York and Vancouver changes, so the US photos land wrong or unplaced:
  // remove the two changes (keep Zurich) and all eight match.
  ...[
    ['2026-06-10T07:10:00Z', 'zurich'],
    ['2026-06-10T09:40:00Z', 'zurich'],
    ['2026-06-10T12:30:00Z', 'zurich'], // in the hotel stay: "Matched (stay)"
    ['2026-06-10T16:20:00Z', 'zurich'],
    ['2026-06-11T15:00:00Z', 'new-york'],
    ['2026-06-11T20:45:00Z', 'new-york'],
    ['2026-06-12T18:30:00Z', 'vancouver'],
    ['2026-06-13T01:15:00Z', 'vancouver'],
  ].map(([utc, place], i) => [
    `${place}/A_${String(i + 1).padStart(4, '0')}.jpg`,
    { ...cam('Forgetful A', 'A0001'), DateTimeOriginal: wall(utc, ZRH) },
  ]),

  // Camera E: clock changed to local time on arrival, no offset saved (like most compacts).
  // Zone detection gets it right: Zurich + 2 changes, all matched.
  ...[
    ['2026-06-10T08:50:00Z', ZRH],
    ['2026-06-11T19:10:00Z', NYC],
    ['2026-06-13T00:40:00Z', YVR],
  ].map(([utc, off], i) => [
    `E_${String(i + 1).padStart(4, '0')}.jpg`,
    { ...cam('Local E', 'E0001'), DateTimeOriginal: wall(utc, off) },
  ]),

  // Camera B: records the offset in every photo (like recent Fujifilm/Sony bodies).
  ...[
    ['2026-06-10T08:05:00Z', ZRH],
    ['2026-06-11T17:30:00Z', NYC],
    ['2026-06-12T22:00:00Z', YVR],
  ].map(([utc, off], i) => [
    `B_${String(i + 1).padStart(4, '0')}.jpg`,
    {
      ...cam('Offset B', 'B0001'),
      DateTimeOriginal: wall(utc, off),
      OffsetTimeOriginal: offsetTag(off),
    },
  ]),

  // Camera C: zones set right, but the clock runs 2 min 13 s fast. Use the offset finder.
  ...[
    ['2026-06-10T10:00:00Z', ZRH],
    ['2026-06-11T14:20:00Z', NYC],
    ['2026-06-12T17:45:00Z', YVR],
  ].map(([utc, off], i) => [
    `C_${String(i + 1).padStart(4, '0')}.jpg`,
    { ...cam('Fast C', 'C0001'), DateTimeOriginal: wall(utc, off, 133) },
  ]),

  // Phone: already geotagged; shows "Already has GPS" unless overwrite is on.
  [
    'phone/IMG_0001.jpg',
    {
      Make: 'Demo',
      Model: 'Phone',
      DateTimeOriginal: wall('2026-06-11T16:00:00Z', NYC),
      OffsetTimeOriginal: offsetTag(NYC),
      GPSLatitude: 40.7484,
      GPSLatitudeRef: 'N',
      GPSLongitude: 73.9857,
      GPSLongitudeRef: 'W',
    },
  ],

  // Not placed, each for a different reason. With no photo on the track, Camera D gets no zone
  // suggestion: it shows the computer's zone, unconfirmed.
  [
    'edge/D_before.jpg',
    { ...cam('Edge D', 'D0001'), DateTimeOriginal: wall('2026-06-09T12:00:00Z', ZRH) },
  ],
  [
    'edge/D_flight.jpg',
    { ...cam('Edge D', 'D0001'), DateTimeOriginal: wall('2026-06-10T22:00:00Z', ZRH) },
  ],
  [
    'edge/D_after.jpg',
    { ...cam('Edge D', 'D0001'), DateTimeOriginal: wall('2026-06-14T12:00:00Z', YVR) },
  ],
  ['edge/D_no_time.jpg', { ...cam('Edge D', 'D0001') }],

  // No camera tags at all: grouped under "Unknown camera".
  ['edge/unknown.jpg', { DateTimeOriginal: wall('2026-06-10T15:00:00Z', ZRH) }],
]

// RAW formats from the CC0 fixtures, re-dated into the trip (in Zurich, local time).
const raws = [
  ['Canon-EOS-R.CR3', 'raw/canon.CR3', '2026-06-10T07:30:00Z'],
  ['Nikon-Z6.NEF', 'raw/nikon.NEF', '2026-06-10T08:30:00Z'],
  ['Sony-a7III.ARW', 'raw/sony.ARW', '2026-06-10T09:30:00Z'],
  ['Fujifilm-X-T4.RAF', 'raw/fuji.RAF', '2026-06-10T15:30:00Z'],
  ['Ricoh-GR-III.DNG', 'raw/ricoh.DNG', '2026-06-10T16:30:00Z'],
  // Same basename, same folder: they'd share one .xmp sidecar, so sidecar mode excludes both.
  ['Nikon-Z6.NEF', 'raw/collision/DSC_0001.NEF', '2026-06-10T17:00:00Z'],
  ['Sony-a7III.ARW', 'raw/collision/DSC_0001.ARW', '2026-06-10T17:05:00Z'],
]

const exiftool = new ExifTool()
try {
  await rm(out, { recursive: true, force: true })
  await mkdir(join(out, 'track'), { recursive: true })
  await writeFile(join(out, 'track/demo-trip.gpx'), gpx)

  for (const [name, tags] of photos) {
    const target = join(photosDir, name)
    await mkdir(join(target, '..'), { recursive: true })
    await copyFile(base, target)
    await exiftool.write(target, tags, { writeArgs: ['-overwrite_original'] })
  }

  let rawCount = 0
  for (const [source, name, utc] of raws) {
    const from = join(cache, source)
    const target = join(photosDir, name)
    await mkdir(join(target, '..'), { recursive: true })
    try {
      await copyFile(from, target)
    } catch {
      console.warn(`skipped ${name}: run \`pnpm fixtures\` first to download ${source}`)
      continue
    }
    await exiftool.write(
      target,
      { AllDates: wall(utc, ZRH) },
      { writeArgs: ['-overwrite_original', '-OffsetTime*='] },
    )
    rawCount++
  }

  // Not a photo: the app should skip it without failing the scan.
  await writeFile(join(photosDir, 'edge/broken.jpg'), 'not a jpeg')

  console.log(`Demo trip in ${out}`)
  console.log(`  track/demo-trip.gpx  ${track.length} points`)
  console.log(`  photos/              ${photos.length} JPEGs, ${rawCount} RAWs, 1 broken file`)
} finally {
  await exiftool.end()
}
