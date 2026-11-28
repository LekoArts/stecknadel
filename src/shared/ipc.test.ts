import { describe, expect, it } from 'vitest'
import { type IpcName, ipcChannel, ipcContract, ipcNames } from './ipc'
import { DEFAULT_MATCHING, DEFAULT_WRITING } from './settings'

const id = `p${'0123456789abcdef'.repeat(2).slice(0, 24)}`

/** For every channel: inputs its schema must accept and inputs it must reject. */
const settings = { matching: DEFAULT_MATCHING, writing: DEFAULT_WRITING }

const WRITE_ID = '0b0c1d2e-3f40-4152-8637-48495a6b7c8d'
const PHOTO = 'p0123456789abcdef01234567'
const badWriteRefs = [
  undefined,
  {},
  { writeId: '../../etc/passwd' },
  { writeId: `${WRITE_ID}.json` },
  { writeId: WRITE_ID, path: '/x' },
]

const samples: { [K in IpcName]: { valid: unknown[]; invalid: unknown[] } } = {
  getAppInfo: {
    valid: [undefined],
    invalid: [null, {}, 'x', 1, [], { path: '/etc/passwd' }],
  },
  getUpdate: { valid: [undefined], invalid: [null, {}, 'x'] },
  installUpdate: { valid: [undefined], invalid: [null, {}, 'x'] },
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
      { key: 'serial:FUJIFILM|3A000042', name: 'Fuji' },
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
  getTrackGeometry: { valid: [undefined], invalid: [{}, 'x'] },
  getTrackZones: { valid: [undefined], invalid: [{}, 'x'] },
  getSettings: {
    valid: [undefined],
    invalid: [null, {}, { path: '/x.pmtiles' }],
  },
  saveSettings: {
    valid: [
      { ...settings, mapSource: { kind: 'openfreemap' } },
      { ...settings, mapSource: { kind: 'style', url: 'https://example.com/style.json' } },
      { ...settings, mapSource: { kind: 'pmtiles' } },
    ],
    invalid: [
      undefined,
      { ...settings },
      { ...settings, mapSource: { kind: 'pmtiles', path: '/x.pmtiles' } },
      { ...settings, mapSource: { kind: 'style', url: 'file:///etc/style.json' } },
      { ...settings, mapSource: { kind: 'openfreemap' }, extra: 1 },
      {
        ...settings,
        writing: { ...DEFAULT_WRITING, rawTarget: 'both' },
        mapSource: { kind: 'openfreemap' },
      },
    ],
  },
  choosePmtiles: {
    valid: [undefined],
    invalid: [null, {}, '/x.pmtiles', { path: '/x.pmtiles' }],
  },
  runPreview: {
    valid: [
      { generation: 1, cameras: {}, manual: {} },
      {
        generation: 2,
        cameras: {
          'serial:X|1': {
            segments: [{ tz: { kind: 'zone', id: 'Europe/Berlin' }, driftSeconds: 0 }],
            useRecordedOffsets: true,
            confirmed: false,
          },
        },
        manual: { p0123456789abcdef01234567: { lat: 46.5, lon: 7.9, ele: null } },
      },
    ],
    invalid: [
      undefined,
      { generation: 0, cameras: {}, manual: {} },
      { generation: 1.5, cameras: {}, manual: {} },
      { generation: 1, cameras: { k: { segments: [] } }, manual: {} },
      { generation: 1, cameras: {}, manual: { '/etc/passwd': { lat: 1, lon: 1, ele: null } } },
      {
        generation: 1,
        cameras: {},
        manual: { p0123456789abcdef01234567: { lat: 91, lon: 1, ele: null } },
      },
      { generation: 1, cameras: {}, manual: {}, extra: true },
    ],
  },
  writePhotos: {
    valid: [{ generation: 3, writing: DEFAULT_WRITING, ids: [PHOTO] }],
    invalid: [
      undefined,
      { generation: 3, writing: DEFAULT_WRITING },
      { generation: 3, writing: DEFAULT_WRITING, ids: [] },
      { generation: 3, writing: DEFAULT_WRITING, ids: ['/etc/passwd'] },
      { generation: 0, writing: DEFAULT_WRITING, ids: [PHOTO] },
      { generation: 3, ids: [PHOTO] },
      { generation: 3, writing: { ...DEFAULT_WRITING, rawTarget: 'elsewhere' }, ids: [PHOTO] },
      { generation: 3, writing: DEFAULT_WRITING, ids: [PHOTO], paths: ['/etc/passwd'] },
    ],
  },
  exportReport: { valid: [undefined], invalid: [{}, '/tmp/report.csv'] },
  listWrites: { valid: [undefined], invalid: [{}, null] },
  reloadFolder: { valid: [undefined], invalid: [{}, { folder: '/etc' }] },
  inspectWrite: { valid: [{ writeId: WRITE_ID }], invalid: badWriteRefs },
  restoreValues: {
    valid: [{ writeId: WRITE_ID, confirmInterrupted: false }],
    invalid: [...badWriteRefs, { writeId: WRITE_ID }],
  },
  restoreOriginals: {
    valid: [{ writeId: WRITE_ID, confirmInterrupted: true }],
    invalid: [...badWriteRefs, { writeId: WRITE_ID, confirmInterrupted: 'yes' }],
  },
  cleanupBackups: { valid: [{ writeId: WRITE_ID }], invalid: badWriteRefs },
  dismissWrite: { valid: [{ writeId: WRITE_ID }], invalid: badWriteRefs },
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
