import type { PhotoSummary } from '@shared/library'
import type { MatchStatus } from '@shared/match/status'
import type { PhotoUtc } from '@shared/time/toUtc'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { inGroup, type SortContext, sortPhotos } from './photoFilter'

function photo(id: string, extra: Partial<PhotoSummary> = {}): PhotoSummary {
  return {
    id,
    name: `${id}.jpg`,
    relDir: '',
    format: 'JPEG',
    cameraKey: 'a',
    captureTime: null,
    subSec: null,
    offsetTimeOriginal: null,
    gps: null,
    orientation: 1,
    hasSidecar: false,
    sidecarCollision: false,
    readError: null,
    ...extra,
  }
}

const time = (iso: string, warnings: PhotoUtc['warnings'] = []): PhotoUtc => ({
  utc: Temporal.Instant.from(iso),
  source: 'segment',
  wall: Temporal.PlainDateTime.from(iso.slice(0, 19)),
  warnings,
})

describe('inGroup', () => {
  const matched: MatchStatus = { kind: 'matched' }
  const gap: MatchStatus = { kind: 'in-gap', gapMinutes: 60, distanceMeters: 5000 }

  it('puts photos without a status in no group', () => {
    for (const g of ['attention', 'placed', 'has-gps'] as const) {
      expect(inGroup(g, undefined, undefined)).toBe(false)
    }
  })

  it('groups by status', () => {
    expect(inGroup('placed', matched, undefined)).toBe(true)
    expect(inGroup('placed', { kind: 'manual' }, undefined)).toBe(true)
    expect(inGroup('attention', gap, undefined)).toBe(true)
    expect(inGroup('placed', gap, undefined)).toBe(false)
    expect(inGroup('has-gps', { kind: 'has-gps' }, undefined)).toBe(true)
    expect(inGroup('attention', { kind: 'has-gps' }, undefined)).toBe(false)
  })

  it('flags placed photos with a time warning for attention too', () => {
    const warned = time('2026-11-01T01:30:00Z', ['ambiguous-local-time'])
    expect(inGroup('attention', matched, warned)).toBe(true)
    expect(inGroup('placed', matched, warned)).toBe(true)
  })
})

describe('sortPhotos', () => {
  const photos = [
    photo('p10', { captureTime: '2026:11:02 10:00:00', cameraKey: 'b' }),
    photo('p2', { captureTime: null }),
    photo('p1', { captureTime: '2026:11:01 10:00:00' }),
  ]
  const ctx: SortContext = {
    cameraNames: new Map([
      ['a', 'Ricoh'],
      ['b', 'Fuji'],
    ]),
    utcs: new Map([
      ['p10', time('2026-11-02T09:00:00Z')],
      ['p1', time('2026-11-01T20:00:00Z')],
    ]),
    statuses: new Map(),
    statusLabel: () => '',
  }
  const ids = (list: PhotoSummary[]): string[] => list.map((p) => p.id)

  it('keeps library order without a sort', () => {
    expect(sortPhotos(photos, null, ctx)).toBe(photos)
  })

  it('sorts names numerically', () => {
    expect(ids(sortPhotos(photos, { key: 'name', dir: 'asc' }, ctx))).toEqual(['p1', 'p2', 'p10'])
    expect(ids(sortPhotos(photos, { key: 'name', dir: 'desc' }, ctx))).toEqual(['p10', 'p2', 'p1'])
  })

  it('sorts by the shown file name, not the folder', () => {
    const nested = [
      photo('x', { name: 'z.jpg', relDir: 'a' }),
      photo('y', { name: 'a.jpg', relDir: 'b' }),
    ]
    expect(ids(sortPhotos(nested, { key: 'name', dir: 'asc' }, ctx))).toEqual(['y', 'x'])
  })

  it('puts missing values last in both directions', () => {
    expect(ids(sortPhotos(photos, { key: 'captured', dir: 'asc' }, ctx))).toEqual([
      'p1',
      'p10',
      'p2',
    ])
    expect(ids(sortPhotos(photos, { key: 'utc', dir: 'desc' }, ctx))).toEqual(['p10', 'p1', 'p2'])
  })

  it('sorts by camera name and breaks ties by library order', () => {
    expect(ids(sortPhotos(photos, { key: 'camera', dir: 'asc' }, ctx))).toEqual(['p10', 'p2', 'p1'])
  })
})
