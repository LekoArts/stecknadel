import { describe, expect, it } from 'vitest'
import { errorsByFile, restored } from './tags'

describe('restored', () => {
  const values = { 'GPS:GPSLatitude': 46.5, 'ExifIFD:OffsetTimeOriginal': '+02:00' }

  it('accepts the recorded values, plus bookkeeping ExifTool adds', () => {
    expect(restored(values, { ...values, 'GPS:GPSVersionID': '2 3 0 0' })).toBe(true)
    expect(restored({}, {})).toBe(true)
  })

  it('rejects a changed value, unrecorded coordinates or an unreadable file', () => {
    expect(restored(values, { ...values, 'GPS:GPSLatitude': 47 })).toBe(false)
    expect(restored({}, { 'XMP-exif:GPSLongitude': 7 })).toBe(false)
    expect(restored(values, undefined)).toBe(false)
  })
})

describe('errorsByFile', () => {
  it('attributes suffixed and inline errors, preferring the longest path', () => {
    const paths = ['C:\\p\\a.jpg', 'C:\\p\\a.jpg.xmp', 'C:\\p\\b.jpg']
    const errors = errorsByFile(
      [
        'Error: Not a valid JPG - C:/p/a.jpg.xmp',
        'Error renaming C:/p/b.jpg_exiftool_tmp to C:/p/b.jpg',
        'Warning: ignored - C:/p/a.jpg',
      ],
      paths,
    )
    expect(errors.get(paths[1])).toBe('Not a valid JPG')
    expect(errors.get(paths[2])).toBe('Error renaming C:/p/b.jpg_exiftool_tmp to C:/p/b.jpg')
    expect(errors.has(paths[0])).toBe(false)
  })
})
