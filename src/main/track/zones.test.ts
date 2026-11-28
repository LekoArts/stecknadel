import { ExifTool } from 'exiftool-vendored'
import { afterAll, describe, expect, it } from 'vitest'
import { trackZones } from './zones'

const et = new ExifTool()
afterAll(() => et.end())

describe('trackZones', () => {
  it('looks up the IANA zone at each point, one lookup per cell', async () => {
    const points = [
      { t: 0, lat: 37.3382, lon: -121.8863 },
      { t: 1, lat: 37.3383, lon: -121.8862 },
      { t: 2, lat: 50.1163, lon: -122.9574 },
      { t: 3, lat: 52.52, lon: 13.405 },
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
