import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type IpcName, ipcChannel, ipcNames } from '@shared/ipc'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { ExifTool } from 'exiftool-vendored'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CameraNames } from './cameras-store'
import { createHandlers } from './handlers'
import { registerIpc } from './ipc'
import { Library } from './library/library'
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
      chooseFolder,
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

  it('returns null without loading anything when the folder dialog is cancelled', async () => {
    chooseFolder.mockResolvedValueOnce(null)
    await expect(invoke('openFolder')).resolves.toBeNull()
  })
})
