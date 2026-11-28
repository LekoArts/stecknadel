import { describe, expect, it } from 'vitest'
import { shortestBounds } from './bounds'

describe('shortestBounds', () => {
  it('a trip on one side of the world: the plain box', () => {
    expect(
      shortestBounds([
        [7.9, 46.5],
        [8.5, 47.4],
        [7.4, 46.9],
      ]),
    ).toEqual([7.4, 46.5, 8.5, 47.4])
  })

  it('San Jose to Seoul: across the Pacific, not the Atlantic', () => {
    const [west, south, east, north] = shortestBounds([
      [-121.9, 37.3],
      [126.98, 37.57],
      [126.44, 37.46],
    ])
    expect([west, south, north]).toEqual([126.44, 37.3, 37.57])
    expect(east).toBeCloseTo(-121.9 + 360)
  })

  it('points straddling 180°', () => {
    const [west, , east] = shortestBounds([
      [179.5, -17],
      [-179.5, -16],
    ])
    expect(west).toBe(179.5)
    expect(east).toBeCloseTo(180.5)
  })

  it('one point', () => {
    expect(shortestBounds([[10, 20]])).toEqual([10, 20, 10, 20])
  })
})
