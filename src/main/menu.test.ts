import { describe, expect, it } from 'vitest'
import { panelShortcut } from './menu'

const key = (k: string, mods: Partial<Electron.Input> = {}): Electron.Input =>
  ({
    type: 'keyDown',
    key: k,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...mods,
  }) as Electron.Input
const mod = process.platform === 'darwin' ? { meta: true } : { control: true }

describe('panelShortcut', () => {
  it('maps Cmd/Ctrl+1/2/3/0 to the panel commands', () => {
    expect(panelShortcut(key('1', mod))).toBe('cameras')
    expect(panelShortcut(key('2', mod))).toBe('photos')
    expect(panelShortcut(key('3', mod))).toBe('metadata')
    expect(panelShortcut(key('0', mod))).toBe('map-only')
  })

  it('leaves other keys and modifier combinations alone', () => {
    expect(panelShortcut(key('1'))).toBeNull()
    expect(panelShortcut(key('4', mod))).toBeNull()
    expect(panelShortcut(key('0', { ...mod, shift: true }))).toBeNull()
    expect(panelShortcut(key('1', { ...mod, alt: true }))).toBeNull()
    expect(panelShortcut({ ...key('1', mod), type: 'keyUp' })).toBeNull()
    expect(panelShortcut(key('1', { ...mod, isComposing: true }))).toBeNull()
  })
})
