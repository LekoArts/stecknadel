import type { ExifTool } from 'exiftool-vendored'

const OFFSET = '+02:00'
const LATITUDE = 47.5

/**
 * Packaged-app self test: writes `OffsetTimeOriginal` and a GPS latitude to `file`, reads them
 * back and returns the `STECKNADEL_SMOKE …` line. Proves the bundled ExifTool can be spawned.
 */
export async function runSmoke(et: ExifTool, file: string): Promise<{ ok: boolean; line: string }> {
  await et.write(
    file,
    { OffsetTimeOriginal: OFFSET, GPSLatitude: LATITUDE, GPSLatitudeRef: 'N' },
    { writeArgs: ['-overwrite_original'] },
  )
  const tags = await et.read(file, { readArgs: ['-n'] })
  const version = await et.version()
  const ok = tags.OffsetTimeOriginal === OFFSET && tags.GPSLatitude === LATITUDE
  const status = ok ? 'ok' : 'mismatch'
  return {
    ok,
    line: `STECKNADEL_SMOKE ${status} ${version} ${tags.OffsetTimeOriginal} ${tags.GPSLatitude}`,
  }
}
