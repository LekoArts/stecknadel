import { describe, expect, it } from 'vitest'
import { nothingToWrite, writeScopes } from './writeScopes'

const placed = new Set(['a', 'b', 'c', 'x'])
const canWrite = (id: string): boolean => placed.has(id)
const all = ['a', 'b', 'c', 'd', 'x', 'y']

describe('writeScopes', () => {
  it('without a selection or filter, Write means all photos', () => {
    const scopes = writeScopes({ selected: [], view: null, camera: null, all, canWrite })
    expect(scopes.map((s) => s.key)).toEqual(['all'])
    expect(scopes[0].writable).toEqual(['a', 'b', 'c', 'x'])
  })

  it('offers the selection first, then the view, the camera and all', () => {
    const scopes = writeScopes({
      selected: ['a'],
      view: ['a', 'b', 'd'],
      camera: { name: 'GR IV', ids: ['a', 'b', 'c', 'd'] },
      all,
      canWrite,
    })
    expect(scopes.map((s) => [s.key, s.label, s.writable.length])).toEqual([
      ['selection', 'Selected photo', 1],
      ['view', 'Photos in view', 2],
      ['camera', 'All from GR IV', 3],
      ['all', 'All photos', 4],
    ])
  })

  it('leaves out a scope that would write the same photos as an earlier one', () => {
    const scopes = writeScopes({
      selected: ['a', 'b', 'd'],
      view: ['a', 'b'],
      camera: { name: 'GR IV', ids: ['a', 'b', 'c'] },
      all: ['a', 'b', 'c', 'y'],
      canWrite,
    })
    expect(scopes.map((s) => s.key)).toEqual(['selection', 'camera'])
  })

  it('a selection with nothing to write is still offered, and says why', () => {
    const [first] = writeScopes({ selected: ['y'], view: null, camera: null, all, canWrite })
    expect(first.writable).toEqual([])
    expect(nothingToWrite(first)).toBe('The selected photo has no position to write')
  })
})
