import { describe, expect, it } from 'vitest'
import {
  clickModifiers,
  clickSelection,
  contextSelection,
  EMPTY_SELECTION,
  only,
  type Selection,
  selectAll,
} from './selection'

const order = ['a', 'b', 'c', 'd', 'e']
const plain = { toggle: false, range: false }
const toggle = { toggle: true, range: false }
const range = { toggle: false, range: true }
const ids = (s: Selection): string[] => [...s.ids].sort()

describe('clickSelection', () => {
  it('a plain click selects just that photo', () => {
    const s = clickSelection(selectAll(EMPTY_SELECTION, order), 'c', plain, order)
    expect(s).toEqual(only('c'))
  })

  it('Cmd/Ctrl-click adds and removes one photo; removing the primary falls back to another', () => {
    let s = clickSelection(only('a'), 'c', toggle, order)
    expect(ids(s)).toEqual(['a', 'c'])
    expect(s.primary).toBe('c')
    s = clickSelection(s, 'c', toggle, order)
    expect(ids(s)).toEqual(['a'])
    expect(s.primary).toBe('a')
    s = clickSelection(s, 'a', toggle, order)
    expect(ids(s)).toEqual([])
    expect(s.primary).toBeNull()
  })

  it('Shift-click selects from the anchor, either direction, and re-anchors nothing', () => {
    let s = clickSelection(only('b'), 'd', range, order)
    expect(ids(s)).toEqual(['b', 'c', 'd'])
    expect(s.primary).toBe('d')
    s = clickSelection(s, 'a', range, order)
    expect(ids(s)).toEqual(['a', 'b'])
  })

  it('Cmd/Ctrl+Shift-click adds the range to the selection', () => {
    const s = clickSelection(
      clickSelection(only('a'), 'e', toggle, order),
      'c',
      { toggle: true, range: true },
      order,
    )
    expect(ids(s)).toEqual(['a', 'c', 'd', 'e'])
  })

  it('Shift-click without an anchor, or with the anchor filtered out, selects just that photo', () => {
    expect(clickSelection(EMPTY_SELECTION, 'c', range, order)).toEqual(only('c'))
    expect(clickSelection(only('z'), 'c', range, order)).toEqual(only('c'))
  })
})

describe('selectAll and contextSelection', () => {
  it('selects every shown photo and keeps a shown primary', () => {
    expect(ids(selectAll(only('c'), order))).toEqual(order)
    expect(selectAll(only('c'), order).primary).toBe('c')
    expect(selectAll(only('z'), order).primary).toBe('a')
    expect(selectAll(only('c'), [])).toEqual(only('c'))
  })

  it('right-clicking inside the selection keeps it; outside replaces it', () => {
    const s = selectAll(EMPTY_SELECTION, order)
    expect(contextSelection(s, 'b')).toBe(s)
    expect(contextSelection(only('a'), 'b')).toEqual(only('b'))
  })
})

describe('clickModifiers', () => {
  it('uses Cmd on macOS and Ctrl elsewhere', () => {
    const e = { metaKey: true, ctrlKey: false, shiftKey: true }
    expect(clickModifiers(e, true)).toEqual({ toggle: true, range: true })
    expect(clickModifiers(e, false)).toEqual({ toggle: false, range: true })
  })
})
