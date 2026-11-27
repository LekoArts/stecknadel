import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DawarichState, IpcEventName, IpcEvents, IpcOutput } from '@shared/ipc'
import { summarizeTrack, type Track } from '@shared/track/types'
import type { ExifTool } from 'exiftool-vendored'
import type { CameraNames } from './cameras-store'
import type { Handlers } from './ipc'
import type { Library } from './library/library'
import { readMetadata } from './library/metadata'
import type { Secrets } from './secrets'
import type { SettingsStore } from './settings'
import type { ThumbnailCache } from './thumbs'
import { DawarichError, fetchDawarichTrack, parseDawarichUrl, testDawarich } from './track/dawarich'
import { parseGpx } from './track/gpx'

export interface HandlerDeps {
  et: ExifTool
  library: Library
  thumbs: ThumbnailCache
  cameraNames: CameraNames
  appInfo: () => Promise<IpcOutput<'getAppInfo'>>
  settings: SettingsStore
  secrets: Secrets
  /** The loaded track, kept in main for the preview and writes. */
  tracks: { current: Track | null }
  /** Main's own pickers: the only way a path enters the app. */
  chooseFolder: () => Promise<string | null>
  chooseGpxFile: () => Promise<string | null>
  send: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const { library, settings, secrets, tracks } = deps

  const dawarichState = async (): Promise<DawarichState> => ({
    url: settings.get().dawarichUrl,
    hasKey: await secrets.hasKey(),
    secureStorage: secrets.available(),
  })

  const keyOrStored = async (key: string | undefined): Promise<string> => {
    const resolved = key?.trim() || (await secrets.getKey())
    if (!resolved) throw new DawarichError('Enter your Dawarich API key')
    return resolved
  }

  return {
    getAppInfo: () => deps.appInfo(),
    openFolder: async () => {
      const folder = await deps.chooseFolder()
      if (!folder) return null
      return library.load(folder, (progress) => deps.send('libraryProgress', progress))
    },
    getThumbnail: async ({ id }) => {
      const photo = library.resolve(id)
      return deps.thumbs.get(photo.file.path, photo.tags.orientation)
    },
    getMetadata: async ({ id }) => readMetadata(deps.et, library.resolve(id).file.path),
    renameCamera: async ({ key, name }) => {
      if (!library.hasCamera(key)) throw new Error('Unknown camera')
      await deps.cameraNames.set(key, name)
      return library.cameraList()
    },
    getTrackState: async () => ({
      track: tracks.current ? summarizeTrack(tracks.current) : null,
      dawarich: await dawarichState(),
    }),
    loadGpx: async () => {
      const file = await deps.chooseGpxFile()
      if (!file) return null
      const track = parseGpx(await readFile(file, 'utf8'), basename(file))
      if (track.points.length === 0) throw new Error('This GPX file has no points with a time')
      tracks.current = track
      return summarizeTrack(track)
    },
    saveDawarichSettings: async ({ url, key }) => {
      const parsed = parseDawarichUrl(url).href
      if (key?.trim()) await secrets.setKey(key.trim())
      await settings.update({ dawarichUrl: parsed })
      return dawarichState()
    },
    testDawarich: async ({ url, key }) => testDawarich(url, await keyOrStored(key)),
    fetchDawarich: async (range) => {
      const url = settings.get().dawarichUrl
      if (!url) throw new DawarichError('Enter the address of your Dawarich server')
      const track = await fetchDawarichTrack(url, await keyOrStored(undefined), range, (p) =>
        deps.send('trackProgress', p),
      )
      tracks.current = track
      return summarizeTrack(track)
    },
  }
}
