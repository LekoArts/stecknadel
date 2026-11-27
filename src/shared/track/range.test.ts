import { describe, expect, it } from 'vitest'
import { isOutsideFetchedRange, rangeCovering } from './range'

const range = { start: '2026-11-02T00:00:00Z', end: '2026-11-17T00:00:00Z' }
const t = (iso: string): number => Date.parse(iso) / 1000

describe('isOutsideFetchedRange', () => {
  it('needs GeoMaxExtSecs of fetched track on both sides', () => {
    expect(isOutsideFetchedRange(t('2026-11-02T00:30:00Z'), range)).toBe(false)
    expect(isOutsideFetchedRange(t('2026-11-02T00:29:59Z'), range)).toBe(true)
    expect(isOutsideFetchedRange(t('2026-11-16T23:30:00Z'), range)).toBe(false)
    expect(isOutsideFetchedRange(t('2026-11-16T23:30:01Z'), range)).toBe(true)
  })
})

describe('rangeCovering', () => {
  it('keeps the current range and widens it to whole hours around outside photos', () => {
    const out = rangeCovering([t('2026-11-01T22:10:00Z'), t('2026-11-17T03:50:00Z')], range)
    expect(out).toEqual({ start: '2026-11-01T21:00:00Z', end: '2026-11-17T05:00:00Z' })
    for (const u of [t('2026-11-01T22:10:00Z'), t('2026-11-17T03:50:00Z')]) {
      expect(isOutsideFetchedRange(u, out)).toBe(false)
    }
    expect(rangeCovering([t('2026-11-05T12:00:00Z')], range)).toEqual(range)
  })
})
