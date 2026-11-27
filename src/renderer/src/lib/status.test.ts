import type { MatchStatus } from '@shared/match/status'
import { describe, expect, it } from 'vitest'
import { notPlacedIds, statusCounts } from './status'

const statuses = new Map<string, MatchStatus>([
  ['a1', { kind: 'matched' } as MatchStatus],
  ['a2', { kind: 'in-gap' } as MatchStatus],
  ['b1', { kind: 'matched' } as MatchStatus],
  ['b2', { kind: 'has-gps' } as MatchStatus],
  ['b3', { kind: 'excluded', reason: 'x' }],
])

describe('legend counts', () => {
  it('counts every photo when no camera is selected', () => {
    expect(Object.fromEntries(statusCounts(statuses, null))).toEqual({
      matched: 2,
      'in-gap': 1,
      'has-gps': 1,
      excluded: 1,
    })
    expect(notPlacedIds(statuses, null)).toEqual(['a2', 'b3'])
  })

  it('counts only the selected camera', () => {
    const cameraB = new Set(['b1', 'b2', 'b3'])
    expect(Object.fromEntries(statusCounts(statuses, cameraB))).toEqual({
      matched: 1,
      'has-gps': 1,
      excluded: 1,
    })
    expect(notPlacedIds(statuses, cameraB)).toEqual(['b3'])
  })
})
