import { describe, expect, it } from 'vitest'
import { restored } from './tags'

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
