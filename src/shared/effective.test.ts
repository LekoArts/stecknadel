import { describe, expect, it } from 'vitest'
import { effectivePhoto, xmpOffset, xmpWallTime } from './effective'
import type { PhotoSummary } from './library'

const raw: PhotoSummary = {
  id: 'p000000000000000000000001',
  name: 'IMG.CR3',
  relDir: '',
  format: 'CR3',
  cameraKey: 'c',
  captureTime: '2024:05:10 12:05:39',
  subSec: '47',
  offsetTimeOriginal: null,
  gps: null,
  orientation: 1,
  sidecar: {
    gps: { latitude: 1, longitude: 2, altitude: null },
    dateTimeOriginal: '2024:05:10 12:05:39.47+09:00',
  },
  sidecarCollision: false,
  readError: null,
}

describe('effective metadata', () => {
  it('reads the zone suffix and wall time of an XMP DateTimeOriginal', () => {
    expect(xmpOffset('2024:05:10 12:05:39.47+09:00')).toBe('+09:00')
    expect(xmpOffset('2024:05:10 12:05:39Z')).toBe('+00:00')
    expect(xmpOffset('2024:05:10 12:05:39.47')).toBeNull()
    expect(xmpOffset(null)).toBeNull()
    expect(xmpWallTime('2024:05:10 12:05:39.47+09:00')).toBe('2024:05:10 12:05:39')
    expect(xmpWallTime('garbage')).toBeNull()
  })

  it('sidecar mode: a RAW takes GPS and the offset from its sidecar', () => {
    const e = effectivePhoto(raw, 'sidecar')
    expect(e.gps).toEqual({ latitude: 1, longitude: 2, altitude: null })
    expect(e.offsetTimeOriginal).toBe('+09:00')
  })

  it("the RAW's own values win; in-file mode and JPEGs ignore the sidecar", () => {
    const own = {
      ...raw,
      offsetTimeOriginal: '+02:00',
      gps: { latitude: 5, longitude: 6, altitude: 7 },
    }
    expect(effectivePhoto(own, 'sidecar').offsetTimeOriginal).toBe('+02:00')
    expect(effectivePhoto(own, 'sidecar').gps?.latitude).toBe(5)
    expect(effectivePhoto(raw, 'in-file')).toBe(raw)
    const jpeg = { ...raw, format: 'JPEG' as const }
    expect(effectivePhoto(jpeg, 'sidecar')).toBe(jpeg)
  })
})
