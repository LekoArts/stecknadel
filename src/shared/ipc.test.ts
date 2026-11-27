import { describe, expect, it } from 'vitest'
import { type IpcName, ipcChannel, ipcContract, ipcNames } from './ipc'

const id = `p${'0123456789abcdef'.repeat(2).slice(0, 24)}`

/** For every channel: inputs its schema must accept and inputs it must reject. */
const samples: { [K in IpcName]: { valid: unknown[]; invalid: unknown[] } } = {
  getAppInfo: {
    valid: [undefined],
    invalid: [null, {}, 'x', 1, [], { path: '/etc/passwd' }],
  },
  openFolder: {
    valid: [undefined],
    invalid: [null, {}, '/Users', { path: '/Users' }, { folder: '/Users' }],
  },
  getThumbnail: {
    valid: [{ id }],
    invalid: [
      undefined,
      {},
      id,
      { id: '/etc/passwd' },
      { id: '../p0123456789abcdef01234567' },
      { id: `${id}x` },
      { id: id.toUpperCase() },
      { id, path: '/etc/passwd' },
    ],
  },
  getMetadata: {
    valid: [{ id }],
    invalid: [undefined, { id: 'C:\\photo.jpg' }, { id: 1 }, { id, extra: true }],
  },
  renameCamera: {
    valid: [
      { key: 'serial:FUJIFILM|3A006341', name: 'Fuji' },
      { key: 'unknown', name: '' },
    ],
    invalid: [
      undefined,
      { key: '', name: 'x' },
      { key: 'k' },
      { key: 'k', name: 'x'.repeat(101) },
      { key: 'k', name: 'x', path: '/tmp/cameras.json' },
    ],
  },
  getTrackState: { valid: [undefined], invalid: [null, {}, { path: '/tmp/t.gpx' }] },
  loadGpx: { valid: [undefined], invalid: [null, '/tmp/t.gpx', { path: '/tmp/t.gpx' }] },
  saveDawarichSettings: {
    valid: [{ url: 'https://d.example.com' }, { url: 'https://d.example.com', key: 'abc' }],
    invalid: [
      undefined,
      { url: '' },
      { url: 'https://d.example.com', key: '' },
      { url: 'https://d.example.com', key: 1 },
      { url: 'https://d.example.com', path: '/tmp' },
    ],
  },
  testDawarich: {
    valid: [{ url: 'https://d.example.com' }, { url: 'https://d.example.com', key: 'abc' }],
    invalid: [undefined, {}, { url: 'x'.repeat(2001) }],
  },
  fetchDawarich: {
    valid: [
      { start: '2026-11-01T00:00:00Z', end: '2026-11-17T23:59:59Z' },
      { start: '2026-11-01T00:00:00.000Z', end: '2026-11-01T00:00:01.000Z' },
    ],
    invalid: [
      undefined,
      { start: '2026-11-02T00:00:00Z' },
      { start: '2026-11-02T00:00:00Z', end: '2026-11-01T00:00:00Z' },
      { start: '2026-11-02T00:00:00+02:00', end: '2026-11-03T00:00:00Z' },
      { start: '2026-11-02', end: '2026-11-03' },
      { start: '2020-01-01T00:00:00Z', end: '2026-11-03T00:00:00Z' },
      { start: '2026-11-02T00:00:00Z', end: '2026-11-03T00:00:00Z', url: 'https://x' },
    ],
  },
}

describe('ipc contract', () => {
  it('has samples for every channel', () => {
    expect(Object.keys(samples).sort()).toEqual([...ipcNames].sort())
  })

  it('uses namespaced, unique channel names', () => {
    const channels = ipcNames.map(ipcChannel)
    expect(new Set(channels).size).toBe(channels.length)
    for (const channel of channels) expect(channel).toMatch(/^stecknadel:[a-zA-Z]+$/)
  })

  for (const name of ipcNames) {
    describe(name, () => {
      const { input } = ipcContract[name]
      for (const value of samples[name].valid) {
        it(`accepts ${JSON.stringify(value) ?? 'undefined'}`, () => {
          expect(input.safeParse(value).success).toBe(true)
        })
      }
      for (const value of samples[name].invalid) {
        it(`rejects ${JSON.stringify(value)}`, () => {
          expect(input.safeParse(value).success).toBe(false)
        })
      }
    })
  }
})
