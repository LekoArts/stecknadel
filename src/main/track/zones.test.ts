import { ExifTool } from 'exiftool-vendored'
import { afterAll, describe, expect, it } from 'vitest'
import { trackZones } from './zones'

const et = new ExifTool()
afterAll(() => et.end())

describe('trackZones', () => {
  it('looks up the IANA zone at each point, one lookup per cell', async () => {
    const points = [
      { t: 0, lat: 37.8065, lon: -122.4222 },
      { t: 1, lat: 37.8066, lon: -122.4221 },
      { t: 2, lat: 49.2488, lon: -122.9805 },
      { t: 3, lat: 52.21, lon: 7.02 },
      { t: 4, lat: -33.87, lon: 151.21 },
    ]
    expect(await trackZones(et, points)).toEqual([
      'America/Los_Angeles',
      'America/Los_Angeles',
      'America/Vancouver',
      'Europe/Berlin',
      'Australia/Sydney',
    ])
  })

  it('returns nothing for an empty track', async () => {
    expect(await trackZones(et, [])).toEqual([])
  })
})
