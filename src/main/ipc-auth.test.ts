import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type IpcName, ipcChannel, ipcNames } from '@shared/ipc'
import type { SettingsView } from '@shared/settings'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CameraNames } from './cameras-store'
import { createHandlers } from './handlers'
import { registerIpc } from './ipc'
import { Library } from './library/library'
import { PreviewEngine } from './preview'
import { Secrets } from './secrets'
import { SettingsStore } from './settings'
import type { ThumbnailCache } from './thumbs'

type Invoke = (event: Partial<IpcMainInvokeEvent>, input: unknown) => Promise<unknown>
const registered = vi.hoisted(() => new Map<string, Invoke>())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Invoke) => registered.set(channel, fn) },
}))

const APP_URL = 'file:///app/out/renderer/index.html'
const window = {
  isDestroyed: () => false,
  webContents: { mainFrame: { processId: 4, routingId: 1 } },
} as unknown as BrowserWindow
const trusted = { senderFrame: { processId: 4, routingId: 1, url: APP_URL } } as never

let dir: string
let et: ExifTool
let library: Library
const thumbRequests: string[] = []
const chooseFolder = vi.fn<() => Promise<string | null>>()
const chooseGpxFile = vi.fn<() => Promise<string | null>>()
const choosePmtilesFile = vi.fn<() => Promise<string | null>>()
const SECRET = 'sk-test-secret-key-1234'

const invoke = (name: IpcName, input?: unknown, event = trusted): Promise<unknown> =>
  (registered.get(ipcChannel(name)) as Invoke)(event, input)

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'steck-ipc-'))
  await copyFile(join(__dirname, '../../test/fixtures/generated/smoke.jpg'), join(dir, 'a.jpg'))
  et = new ExifTool({ maxProcs: 1 })
  const cameraNames = new CameraNames(join(dir, 'userData/cameras.json'))
  library = new Library(et, () => cameraNames.all())
  registerIpc(
    createHandlers({
      et,
      library,
      cameraNames,
      thumbs: {
        get: async (file: string) => {
          thumbRequests.push(file)
          return { url: null, rotate: 0 }
        },
      } as unknown as ThumbnailCache,
      appInfo: async () => ({ version: '0.0.0', exiftoolVersion: '13.64', platform: 'darwin' }),
      settings: new SettingsStore(join(dir, 'userData/settings.json')),
      secrets: new Secrets(join(dir, 'userData/secrets.bin'), {
        isEncryptionAvailable: () => true,
        encryptString: (plain) => Buffer.from(plain.split('').reverse().join('')),
        decryptString: (enc) => enc.toString().split('').reverse().join(''),
      }),
      preview: new PreviewEngine(et),
      tracks: { current: null },
      chooseFolder,
      chooseGpxFile,
      choosePmtilesFile,
      chooseReportFile: async () => join(dir, 'report.csv'),
      journalDir: join(dir, 'userData/journal'),
      send: () => {},
    }),
    () => window,
    (url) => url === APP_URL,
  )
})
afterAll(async () => {
  await et.end()
  await rm(dir, { recursive: true, force: true })
})

describe('IPC authorization', () => {
  it('registers every contract channel', () => {
    expect([...registered.keys()].sort()).toEqual(ipcNames.map(ipcChannel).sort())
  })

  it('accepts a call from the main window top frame', async () => {
    await expect(invoke('getAppInfo')).resolves.toMatchObject({ version: '0.0.0' })
  })

  it.each([
    ['a subframe', { processId: 4, routingId: 7, url: APP_URL }],
    ['another renderer process', { processId: 9, routingId: 1, url: APP_URL }],
    ['a foreign origin', { processId: 4, routingId: 1, url: 'https://evil.example/' }],
    ['a missing frame', null],
  ])('rejects every channel when called from %s', async (_, senderFrame) => {
    for (const name of ipcNames) {
      await expect(invoke(name, undefined, { senderFrame } as never), name).rejects.toThrow(
        /untrusted sender/,
      )
    }
  })

  it('rejects photo IDs that are well-formed but not in the loaded library', async () => {
    const id = `p${'a'.repeat(24)}`
    await expect(invoke('getThumbnail', { id })).rejects.toThrow(/Unknown photo/)
    await expect(invoke('getMetadata', { id })).rejects.toThrow(/Unknown photo/)
    expect(thumbRequests).toEqual([])
  })

  it('no channel accepts a raw file path', async () => {
    const paths = ['/etc/passwd', 'C:\\Windows\\win.ini', join(dir, 'a.jpg'), '../a.jpg']
    const shapes = (p: string): unknown[] => [
      p,
      { path: p },
      { file: p },
      { id: p },
      { folder: p },
      { key: 'unknown', name: 'x', path: p },
      [p],
    ]
    for (const name of ipcNames) {
      for (const input of paths.flatMap(shapes)) {
        await expect(invoke(name, input), `${name} ${JSON.stringify(input)}`).rejects.toThrow(
          /invalid input/,
        )
      }
    }
  })

  it('resolves loaded photos by ID, and renames only known cameras', async () => {
    chooseFolder.mockResolvedValueOnce(dir)
    const snapshot = (await invoke('openFolder')) as Awaited<ReturnType<Library['load']>>
    const photo = snapshot?.photos[0]
    expect(photo?.name).toBe('a.jpg')
    await invoke('getThumbnail', { id: photo?.id })
    expect(thumbRequests).toEqual([join(dir, 'a.jpg')])
    const metadata = (await invoke('getMetadata', { id: photo?.id })) as Record<string, unknown>
    expect(metadata.IFD0).toHaveProperty('Make')

    await expect(invoke('renameCamera', { key: 'serial:Nope|1', name: 'x' })).rejects.toThrow(
      /Unknown camera/,
    )
    const cameras = (await invoke('renameCamera', {
      key: photo?.cameraKey,
      name: '  Trip camera ',
    })) as { name: string }[]
    expect(cameras[0].name).toBe('Trip camera')
  })

  it('loads a GPX track chosen in main’s dialog', async () => {
    chooseGpxFile.mockResolvedValueOnce(join(__dirname, '../../test/fixtures/synthetic-trip.gpx'))
    const summary = (await invoke('loadGpx')) as { count: number }
    expect(summary.count).toBe(663)
    const state = (await invoke('getTrackState')) as { track: { count: number } }
    expect(state.track.count).toBe(663)
    chooseGpxFile.mockResolvedValueOnce(null)
    await expect(invoke('loadGpx')).resolves.toBeNull()
  })

  it('stores the Dawarich key write-only: no channel ever returns it', async () => {
    await expect(
      invoke('saveDawarichSettings', { url: 'http://dawarich.example.com', key: SECRET }),
    ).rejects.toThrow(/https/)
    const state = await invoke('saveDawarichSettings', {
      url: 'https://dawarich.example.com',
      key: ` ${SECRET} `,
    })
    expect(state).toEqual({
      url: 'https://dawarich.example.com/',
      hasKey: true,
      secureStorage: true,
    })
    const all = JSON.stringify([state, await invoke('getTrackState')])
    expect(all).not.toContain(SECRET)
    // Saving only the address keeps the stored key.
    await expect(
      invoke('saveDawarichSettings', { url: 'https://dawarich.example.com/' }),
    ).resolves.toMatchObject({ hasKey: true })
  })

  it('returns null without loading anything when the folder dialog is cancelled', async () => {
    chooseFolder.mockResolvedValueOnce(null)
    await expect(invoke('openFolder')).resolves.toBeNull()
  })

  it('saves settings; a PMTiles path only comes from main’s picker and never goes back out', async () => {
    const view = (await invoke('getSettings')) as SettingsView
    expect(view.mapSource).toEqual({ kind: 'openfreemap' })
    const matching = { ...view.matching, geoMaxIntSecs: 600 }
    await expect(
      invoke('saveSettings', { ...view, matching, mapSource: { kind: 'pmtiles' } }),
    ).rejects.toThrow(/Choose a PMTiles file first/)
    const saved = (await invoke('saveSettings', { ...view, matching })) as SettingsView
    expect(saved.matching.geoMaxIntSecs).toBe(600)
    await expect(
      invoke('saveSettings', { ...view, matching: { ...matching, geoMaxIntSecs: 30 } }),
    ).rejects.toThrow(/invalid input/)

    const pmtiles = join(dir, 'secret-folder', 'alps.pmtiles')
    choosePmtilesFile.mockResolvedValueOnce(pmtiles)
    const chosen = (await invoke('choosePmtiles')) as SettingsView
    expect(chosen.mapSource).toEqual({ kind: 'pmtiles', name: 'alps.pmtiles' })
    const kept = (await invoke('saveSettings', {
      ...chosen,
      mapSource: { kind: 'pmtiles' },
    })) as SettingsView
    expect(kept.mapSource).toEqual({ kind: 'pmtiles', name: 'alps.pmtiles' })
    expect(JSON.stringify([chosen, kept, await invoke('getSettings')])).not.toContain(
      'secret-folder',
    )
    choosePmtilesFile.mockResolvedValueOnce(null)
    await expect(invoke('choosePmtiles')).resolves.toBeNull()
  })
})

describe('writing over IPC', () => {
  it('refuses an unconfirmed generation and unknown writes; has nothing to export yet', async () => {
    const writing = ((await invoke('getSettings')) as SettingsView).writing
    await expect(invoke('writePhotos', { generation: 99, writing })).resolves.toMatchObject({
      kind: 'stale',
    })
    await expect(invoke('exportReport')).resolves.toBe(false)
    await expect(invoke('listWrites')).resolves.toEqual([])
    const writeId = '0b0c1d2e-3f40-4152-8637-48495a6b7c8d'
    await expect(invoke('restoreValues', { writeId, confirmInterrupted: true })).rejects.toThrow(
      /no longer recorded/,
    )
    await expect(invoke('cleanupBackups', { writeId: '../x' })).rejects.toThrow(/invalid input/)
  })
})
