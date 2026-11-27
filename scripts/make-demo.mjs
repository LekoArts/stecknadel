// A made-up trip, San Francisco → Vancouver, for trying every flow by hand and for demo videos:
// a GPX track and a folder of photos (CC0/public-domain, downloaded and pinned in
// test/fixtures/demo.lock.json) from cameras that each show one thing. Coordinates, times and
// serial numbers are invented.
//
//   pnpm make-demo [out-dir]      (default: test/fixtures/demo, gitignored)
//
// Trip, Nov 2026. San Francisco is UTC−07:00 until 2 a.m. on Nov 1, then UTC−08:00;
// British Columbia stays on UTC−07:00 all year.
//
//   Oct 31 – Nov 1   San Francisco, Halloween night in the Castro; overnight at the hotel
//   Nov 1            San Francisco day: Ferry Building, Alcatraz ferry, Lombard St, Golden Gate
//   Nov 2            flight SFO → YVR (no track), Vancouver: Canada Place, Stanley Park, hotel
//   Nov 3 evening    dinner in Gastown; the track ends that night
//
// Cameras, and what each shows:
//   Ricoh GR III      clock changed to local time on landing. The app works out both zones from
//                     the track. Also: a photo at 1:30 a.m. on the night the clocks went back
//                     (ambiguous time warning), one from the plane (in a track gap: place it by
//                     hand), one at the hotel (placed where the track stopped), and breakfast
//                     after the track ended.
//   Nikon Z f         clock left on San Francisco time in Vancouver. The app guesses a zone
//                     change, so the Gastown photo lands at the hotel; the offset finder fixes it.
//   Fujifilm X100VI   saves the time zone in each photo: nothing to set.
//   Canon EOS R       RAW, clock 2 min 13 s fast (find it with the offset finder). The same shot
//                     as .CR3 and a converted .DNG: they'd share one .xmp, so writing to sidecars
//                     excludes both.
//   iPhone 15 Pro     already has GPS.
//   exports/          an edited export with its metadata stripped (no camera, no capture time)
//                     and a file that isn't a photo.
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExifTool } from 'exiftool-vendored'
import { cacheDir, fetchLocked, lockPath } from './fetch-fixtures.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const demoCache = join(cacheDir, 'demo')
const out = resolve(process.argv[2] ?? join(root, 'test/fixtures/demo'))

const places = {
  sfHotel: [37.788, -122.4075], // Union Square
  castro: [37.7609, -122.435],
  chinatown: [37.7948, -122.4054],
  ferryBuilding: [37.7955, -122.3937],
  pier33: [37.8087, -122.4057],
  lombard: [37.8021, -122.4187],
  fortMason: [37.806, -122.43],
  goldenGate: [37.8076, -122.475],
  sfo: [37.6213, -122.379],
  yvr: [49.1951, -123.1779],
  waterfront: [49.2856, -123.1115],
  canadaPlace: [49.2888, -123.1111],
  brocktonPoint: [49.3009, -123.117],
  vanHotel: [49.2905, -123.125], // Coal Harbour
  gastown: [49.2843, -123.1089],
}

// Deterministic jitter so every run writes the same track.
let seed = 7
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32
  return seed / 2 ** 32 - 0.5
}
const at = (iso) => Date.parse(iso) / 1000
const jitter = ([lat, lon], meters) => [
  lat + (random() * meters) / 111_320,
  lon + (random() * meters) / (111_320 * Math.cos((lat * Math.PI) / 180)),
]

/** One fix every 30 s along `[time, place]` stops: moving between them, lingering where a place repeats. */
function route(...stops) {
  const points = []
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, a] = [at(stops[i][0]), places[stops[i][1]]]
    const [t1, b] = [at(stops[i + 1][0]), places[stops[i + 1][1]]]
    for (let t = t0; t < t1 || (i === stops.length - 2 && t === t1); t += 30) {
      const f = (t - t0) / (t1 - t0)
      const [lat, lon] = jitter(
        [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        a === b ? 8 : 4,
      )
      points.push({ t, lat, lon })
    }
  }
  return points
}

// Gaps between these segments: overnight at each hotel (bridged as a stay) and the flight.
const track = [
  ...route(
    ['2026-10-31T23:30:00Z', 'sfHotel'],
    ['2026-11-01T00:00:00Z', 'castro'],
    ['2026-11-01T09:00:00Z', 'castro'],
    ['2026-11-01T09:20:00Z', 'sfHotel'],
  ),
  ...route(
    ['2026-11-01T17:00:00Z', 'sfHotel'],
    ['2026-11-01T17:20:00Z', 'chinatown'],
    ['2026-11-01T17:50:00Z', 'ferryBuilding'],
    ['2026-11-01T18:30:00Z', 'pier33'],
    ['2026-11-01T19:00:00Z', 'pier33'],
    ['2026-11-01T19:40:00Z', 'lombard'],
    ['2026-11-01T20:00:00Z', 'lombard'],
    ['2026-11-01T20:30:00Z', 'fortMason'],
    ['2026-11-01T20:50:00Z', 'fortMason'],
    ['2026-11-01T22:00:00Z', 'goldenGate'],
    ['2026-11-01T22:40:00Z', 'goldenGate'],
    ['2026-11-02T00:00:00Z', 'sfHotel'],
  ),
  ...route(['2026-11-02T15:00:00Z', 'sfHotel'], ['2026-11-02T15:50:00Z', 'sfo']),
  ...route(
    ['2026-11-02T19:00:00Z', 'yvr'],
    ['2026-11-02T19:40:00Z', 'waterfront'],
    ['2026-11-02T19:50:00Z', 'canadaPlace'],
    ['2026-11-02T20:20:00Z', 'canadaPlace'],
    ['2026-11-02T21:00:00Z', 'brocktonPoint'],
    ['2026-11-02T21:30:00Z', 'brocktonPoint'],
    ['2026-11-02T22:30:00Z', 'vanHotel'],
  ),
  ...route(
    ['2026-11-03T02:00:00Z', 'vanHotel'],
    ['2026-11-03T02:20:00Z', 'gastown'],
    ['2026-11-03T04:30:00Z', 'gastown'],
    ['2026-11-03T04:50:00Z', 'vanHotel'],
  ),
]

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="stecknadel demo" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>San Francisco to Vancouver</name><trkseg>
${track
  .map(
    (p) =>
      `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(p.t * 1000).toISOString().replace('.000', '')}</time></trkpt>`,
  )
  .join('\n')}
  </trkseg></trk>
</gpx>
`

const SF = -8 // after the clocks went back
const SF_SUMMER = -7
const VAN = -7

/** EXIF wall time of a clock set to `offset` hours and running `fastSec` fast. */
const wall = (iso, offset, fastSec = 0) =>
  new Date(Date.parse(iso) + (offset * 3600 + fastSec) * 1000)
    .toISOString()
    .slice(0, 19)
    .replace(/-/g, ':')
    .replace('T', ' ')
const offsetTag = (h) => `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`

const ricoh = {
  Make: 'RICOH IMAGING COMPANY, LTD.',
  Model: 'RICOH GR III',
  SerialNumber: '0042017',
}
const nikon = { Make: 'NIKON CORPORATION', Model: 'NIKON Z f', SerialNumber: '7300421' }
const fuji = { Make: 'FUJIFILM', Model: 'X100VI', SerialNumber: '5DA00318' }
const iphone = { Make: 'Apple', Model: 'iPhone 15 Pro' }

/** [file in the photo folder, downloaded photo, tags] */
const photos = [
  [
    'ricoh-gr-iii/halloween-pumpkin.jpg',
    'halloween-pumpkin.jpg',
    { ...ricoh, DateTimeOriginal: wall('2026-11-01T08:30:00Z', SF_SUMMER) },
  ],
  [
    'ricoh-gr-iii/golden-gate-bridge.jpg',
    'golden-gate-bridge.jpg',
    { ...ricoh, DateTimeOriginal: wall('2026-11-01T22:10:00Z', SF) },
  ],
  [
    'ricoh-gr-iii/plane-window.jpg',
    'plane-window.jpg',
    { ...ricoh, DateTimeOriginal: wall('2026-11-02T17:30:00Z', SF) },
  ],
  [
    'ricoh-gr-iii/canada-place.jpg',
    'canada-place.jpg',
    { ...ricoh, DateTimeOriginal: wall('2026-11-02T20:05:00Z', VAN) },
  ],
  [
    'ricoh-gr-iii/hotel-window-view.jpg',
    'hotel-window-view.jpg',
    { ...ricoh, DateTimeOriginal: wall('2026-11-03T00:30:00Z', VAN) },
  ],
  [
    'ricoh-gr-iii/breakfast.jpg',
    'breakfast.jpg',
    { ...ricoh, DateTimeOriginal: wall('2026-11-03T16:30:00Z', VAN) },
  ],
  [
    'nikon-z-f/golden-gate-in-fog.jpg',
    'golden-gate-in-fog.jpg',
    { ...nikon, DateTimeOriginal: wall('2026-11-01T22:20:00Z', SF) },
  ],
  // Still on San Francisco time: read as Vancouver time it's an hour early, at the hotel.
  [
    'nikon-z-f/gastown-at-night.jpg',
    'gastown-at-night.jpg',
    { ...nikon, DateTimeOriginal: wall('2026-11-03T02:30:00Z', SF) },
  ],
  [
    'fujifilm-x100vi/lombard-street.jpg',
    'lombard-street.jpg',
    {
      ...fuji,
      DateTimeOriginal: wall('2026-11-01T19:50:00Z', SF),
      OffsetTimeOriginal: offsetTag(SF),
    },
  ],
  [
    'fujifilm-x100vi/stanley-park-seawall.jpg',
    'stanley-park-seawall.jpg',
    {
      ...fuji,
      DateTimeOriginal: wall('2026-11-02T21:15:00Z', VAN),
      OffsetTimeOriginal: offsetTag(VAN),
    },
  ],
  [
    'iphone/alcatraz-ferry.jpg',
    'alcatraz-ferry.jpg',
    {
      ...iphone,
      DateTimeOriginal: wall('2026-11-01T18:45:00Z', SF),
      OffsetTimeOriginal: offsetTag(SF),
      GPSLatitude: places.pier33[0],
      GPSLatitudeRef: 'N',
      GPSLongitude: places.pier33[1],
      GPSLongitudeRef: 'W',
    },
  ],
  ['exports/sunset-edit.jpg', 'sunset-edit.jpg', {}],
]

const exiftool = new ExifTool()
try {
  if (!(await fetchLocked(lockPath, cacheDir))) throw new Error('RAW fixture download failed')
  if (!(await fetchLocked(join(root, 'test/fixtures/demo.lock.json'), demoCache))) {
    throw new Error('demo photo download failed')
  }
  await rm(out, { recursive: true, force: true })
  await mkdir(join(out, 'track'), { recursive: true })
  await writeFile(join(out, 'track/san-francisco-to-vancouver.gpx'), gpx)

  const photosDir = join(out, 'photos')
  for (const [name, source, tags] of photos) {
    const target = join(photosDir, name)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(demoCache, source), target)
    // Start from nothing but the rotation: the originals carry their own cameras, dates, places.
    await exiftool.write(
      target,
      {},
      {
        writeArgs: ['-overwrite_original', '-all=', '-tagsFromFile', '@', '-Orientation'],
      },
    )
    if (Object.keys(tags).length) {
      await exiftool.write(target, tags, { writeArgs: ['-overwrite_original'] })
    }
  }

  // Canon: the CR3 and a DNG converted from it, same name.
  const canonDir = join(photosDir, 'canon-eos-r')
  await mkdir(canonDir, { recursive: true })
  const cr3 = join(canonDir, 'community-garden.CR3')
  const dng = join(canonDir, 'community-garden.DNG')
  const canonTime = wall('2026-11-01T20:40:00Z', SF, 133)
  await copyFile(join(cacheDir, 'Canon-EOS-R.CR3'), cr3)
  await exiftool.write(
    cr3,
    { AllDates: canonTime },
    { writeArgs: ['-overwrite_original', '-OffsetTime*='] },
  )
  const { SerialNumber } = await exiftool.read(cr3)
  const preview = join(out, 'preview.jpg')
  await exiftool.extractPreview(cr3, preview)
  await copyFile(join(cacheDir, 'Ricoh-GR-III.DNG'), dng)
  await exiftool.write(
    dng,
    {
      Make: 'Canon',
      Model: 'Canon EOS R',
      SerialNumber: String(SerialNumber),
      AllDates: canonTime,
    },
    {
      writeArgs: [
        '-overwrite_original',
        '-MakerNotes:all=',
        '-OffsetTime*=',
        `-PreviewImage<=${preview}`,
      ],
    },
  )
  await rm(preview)

  await writeFile(
    join(photosDir, 'exports/not-a-photo.jpg'),
    'This is a text file with a .jpg name.\n',
  )

  console.log(`Demo trip in ${out}`)
  console.log(`  track/san-francisco-to-vancouver.gpx  ${track.length} points`)
  console.log(`  photos/  ${photos.length + 3} files from 5 cameras plus exports`)
} finally {
  await exiftool.end()
}
