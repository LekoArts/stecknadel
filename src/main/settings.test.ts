import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchingSchema, saveSettingsSchema } from '@shared/settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, migrateSettings, SettingsStore } from './settings'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'steck-settings-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const matching = (patch: Record<string, unknown>) => ({ ...DEFAULT_SETTINGS.matching, ...patch })

describe('settings defaults', () => {
  it('match user decisions 7, 8, 9, 10 and 19', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    await store.load()
    expect(store.get()).toEqual({
      dawarichUrl: null,
      matching: {
        geoMaxIntSecs: 1800,
        geoMaxExtSecs: 1800,
        bridge: { enabled: true, radiusMeters: 250, maxGapHours: 24 },
      },
      writing: { overwriteGps: false, writeOffsetTime: true, rawTarget: 'in-file', backups: false },
      mapSource: { kind: 'openfreemap' },
    })
  })
})

describe('ranges (user decision 20)', () => {
  it.each([
    ['geoMaxIntSecs', 59, false],
    ['geoMaxIntSecs', 60, true],
    ['geoMaxIntSecs', 604_800, true],
    ['geoMaxIntSecs', 604_801, false],
    ['geoMaxExtSecs', 59, false],
    ['geoMaxExtSecs', 604_801, false],
    ['geoMaxExtSecs', 1.5, false],
  ])('%s = %d → valid %s', (key, value, ok) => {
    expect(matchingSchema.safeParse(matching({ [key]: value })).success).toBe(ok)
  })

  it.each([
    [{ radiusMeters: 9 }, false],
    [{ radiusMeters: 10 }, true],
    [{ radiusMeters: 5000 }, true],
    [{ radiusMeters: 5001 }, false],
    [{ maxGapHours: 0 }, false],
    [{ maxGapHours: 1 }, true],
    [{ maxGapHours: 72 }, true],
    [{ maxGapHours: 73 }, false],
  ])('bridge %o → valid %s', (patch, ok) => {
    const bridge = { ...DEFAULT_SETTINGS.matching.bridge, ...patch }
    expect(matchingSchema.safeParse(matching({ bridge })).success).toBe(ok)
  })

  it('a saved map style must be an https URL; a PMTiles path cannot come from the renderer', () => {
    const base = { matching: DEFAULT_SETTINGS.matching, writing: DEFAULT_SETTINGS.writing }
    const ok = (mapSource: unknown) => saveSettingsSchema.safeParse({ ...base, mapSource }).success
    expect(ok({ kind: 'style', url: 'https://tiles.example.com/style.json' })).toBe(true)
    expect(ok({ kind: 'style', url: 'http://tiles.example.com/style.json' })).toBe(false)
    expect(ok({ kind: 'style', url: 'javascript:alert(1)' })).toBe(false)
    expect(ok({ kind: 'pmtiles' })).toBe(true)
    expect(ok({ kind: 'pmtiles', path: '/etc/passwd' })).toBe(false)
  })
})

describe('migration', () => {
  it('fills missing keys from defaults and keeps the stored ones', () => {
    const s = migrateSettings({
      dawarichUrl: 'https://dawarich.example.com/',
      matching: { geoMaxIntSecs: 3600, bridge: { radiusMeters: 100 } },
    })
    expect(s.dawarichUrl).toBe('https://dawarich.example.com/')
    expect(s.matching).toEqual({
      geoMaxIntSecs: 3600,
      geoMaxExtSecs: 1800,
      bridge: { enabled: true, radiusMeters: 100, maxGapHours: 24 },
    })
    expect(s.writing).toEqual(DEFAULT_SETTINGS.writing)
    expect(s.mapSource).toEqual({ kind: 'openfreemap' })
  })

  it('replaces only the invalid values', () => {
    const s = migrateSettings({
      matching: { geoMaxIntSecs: 59, geoMaxExtSecs: 7200, bridge: 'no' },
      writing: { backups: 'yes', rawTarget: 'sidecar' },
      mapSource: { kind: 'style', url: 'http://insecure.example.com' },
    })
    expect(s.matching.geoMaxIntSecs).toBe(1800)
    expect(s.matching.geoMaxExtSecs).toBe(7200)
    expect(s.matching.bridge).toEqual(DEFAULT_SETTINGS.matching.bridge)
    expect(s.writing).toEqual({ ...DEFAULT_SETTINGS.writing, rawTarget: 'sidecar' })
    expect(s.mapSource).toEqual({ kind: 'openfreemap' })
  })

  it('moves the earlier matching.overwriteGps to writing', () => {
    expect(migrateSettings({ matching: { overwriteGps: true } }).writing.overwriteGps).toBe(true)
  })

  it('a corrupt file loads as defaults; updates persist atomically', async () => {
    const file = join(dir, 'settings.json')
    await writeFile(file, '{not json')
    const store = new SettingsStore(file)
    await store.load()
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    await store.update({ writing: { ...DEFAULT_SETTINGS.writing, backups: true } })
    const again = new SettingsStore(file)
    await again.load()
    expect(again.get().writing.backups).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8')).writing.backups).toBe(true)
  })
})
