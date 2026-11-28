import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { effectivePhoto } from '@shared/effective'
import type { DawarichState, IpcEventName, IpcEvents, IpcOutput, UpdateState } from '@shared/ipc'
import type { MapSource, SettingsView } from '@shared/settings'
import { summarizeTrack, type Track } from '@shared/track/types'
import { reportCsv, type WriteReport } from '@shared/write'
import type { ExifTool } from 'exiftool-vendored'
import { Recovery } from './backups'
import type { CameraNames } from './cameras-store'
import type { Handlers } from './ipc'
import { Journals } from './journal'
import type { Library } from './library/library'
import { readMetadata } from './library/metadata'
import type { PreviewContext, PreviewEngine } from './preview'
import type { Secrets } from './secrets'
import type { SettingsStore } from './settings'
import type { ThumbnailCache } from './thumbs'
import { bridgeTrack } from './track/bridge'
import { DawarichError, fetchDawarichTrack, parseDawarichUrl, testDawarich } from './track/dawarich'
import { parseGpx } from './track/gpx'
import { trackZones } from './track/zones'
import { Writer } from './write'

export interface HandlerDeps {
  et: ExifTool
  library: Library
  thumbs: ThumbnailCache
  cameraNames: CameraNames
  appInfo: () => Promise<IpcOutput<'getAppInfo'>>
  updates: { state: () => UpdateState; install: () => void }
  settings: SettingsStore
  secrets: Secrets
  preview: PreviewEngine
  /** The loaded track, kept in main for the preview and writes. */
  tracks: { current: Track | null }
  /** Main's own pickers: the only way a path enters the app. */
  chooseFolder: () => Promise<string | null>
  chooseGpxFile: () => Promise<string | null>
  choosePmtilesFile: () => Promise<string | null>
  chooseReportFile: () => Promise<string | null>
  /** Where write journals live (`userData/journal`). */
  journalDir: string
  send: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const { library, settings, secrets, tracks } = deps
  const zoneCache = new WeakMap<Track, Promise<(string | null)[]>>()
  const journals = new Journals(deps.journalDir)
  const recovery = new Recovery(deps.et, journals)
  // Writes, restores and cleanups touch the same files and journals: one at a time.
  let disk: Promise<unknown> = Promise.resolve()
  const onDisk = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = disk.then(fn)
    disk = result.catch(() => null)
    return result
  }
  let lastReport: WriteReport | null = null

  /** What the preview (and a write) sees now: photos as a write would, track and options. */
  const previewContext = (): PreviewContext | null => {
    const track = tracks.current
    const photos = library.all()
    if (!track || track.points.length === 0 || photos.length === 0) return null
    const { matching, writing } = settings.get()
    const { geoMaxIntSecs, geoMaxExtSecs, bridge } = matching
    return {
      loadId: library.loadId,
      photos: photos.map((p) => effectivePhoto(p.summary, writing.rawTarget)),
      track,
      options: {
        limits: { geoMaxIntSecs, geoMaxExtSecs },
        bridge,
        overwriteGps: writing.overwriteGps,
        rawTarget: writing.rawTarget,
      },
    }
  }

  const writer = new Writer({
    et: deps.et,
    preview: deps.preview,
    journals,
    resolve: (id) => library.resolve(id),
    context: previewContext,
    writing: () => settings.get().writing,
    onProgress: (p) => deps.send('writeProgress', p),
  })

  const dawarichState = async (): Promise<DawarichState> => ({
    url: settings.get().dawarichUrl,
    hasKey: await secrets.hasKey(),
    secureStorage: secrets.available(),
  })

  const settingsView = (): SettingsView => {
    const { matching, writing, mapSource } = settings.get()
    return {
      matching,
      writing,
      mapSource:
        mapSource.kind === 'pmtiles'
          ? { kind: 'pmtiles', name: basename(mapSource.path) }
          : mapSource,
    }
  }

  const keyOrStored = async (key: string | undefined): Promise<string> => {
    const resolved = key?.trim() || (await secrets.getKey())
    if (!resolved) throw new DawarichError('Enter your Dawarich API key')
    return resolved
  }

  return {
    getAppInfo: () => deps.appInfo(),
    getUpdate: async () => deps.updates.state(),
    installUpdate: async () => deps.updates.install(),
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
    getTrackGeometry: async () => {
      const track = tracks.current
      if (!track) return null
      const { geoMaxIntSecs, bridge } = settings.get().matching
      return {
        points: track.points.map((p): [number, number, number] => [p.t, p.lat, p.lon]),
        intervals: bridgeTrack(track.points, geoMaxIntSecs, bridge).intervals,
        geoMaxIntSecs,
      }
    },
    getTrackZones: async () => {
      const track = tracks.current
      if (!track) return null
      let zones = zoneCache.get(track)
      if (!zones) {
        zones = trackZones(deps.et, track.points)
        zoneCache.set(track, zones)
        zones.catch(() => zoneCache.delete(track))
      }
      return zones
    },
    getSettings: async () => settingsView(),
    saveSettings: async ({ matching, writing, mapSource }) => {
      let source: MapSource
      if (mapSource.kind === 'pmtiles') {
        const current = settings.get().mapSource
        if (current.kind !== 'pmtiles') throw new Error('Choose a PMTiles file first')
        source = current
      } else source = mapSource
      await settings.update({ matching, writing, mapSource: source })
      return settingsView()
    },
    choosePmtiles: async () => {
      const path = await deps.choosePmtilesFile()
      if (!path) return null
      await settings.update({ mapSource: { kind: 'pmtiles', path } })
      return settingsView()
    },
    runPreview: async (input) => {
      const ctx = previewContext()
      return ctx ? deps.preview.run(input, ctx) : null
    },
    writePhotos: ({ generation, writing }) =>
      onDisk(async () => {
        const result = await writer.write(generation, writing)
        if (result.kind !== 'done') return result
        lastReport = result.report
        return { ...result, library: await library.reload() }
      }),
    exportReport: async () => {
      if (!lastReport) return false
      const file = await deps.chooseReportFile()
      if (!file) return false
      await writeFile(file, reportCsv(lastReport))
      return true
    },
    reloadFolder: () => library.reload(),
    // Listing expires and prunes journals, so it queues with the rest.
    listWrites: () => onDisk(() => recovery.list()),
    inspectWrite: ({ writeId }) => recovery.inspect(writeId),
    restoreValues: ({ writeId, confirmInterrupted }) =>
      onDisk(() => recovery.restoreValues(writeId, confirmInterrupted)),
    restoreOriginals: ({ writeId, confirmInterrupted }) =>
      onDisk(() => recovery.restoreOriginals(writeId, confirmInterrupted)),
    cleanupBackups: ({ writeId }) => onDisk(() => recovery.cleanupBackups(writeId)),
    dismissWrite: ({ writeId }) =>
      onDisk(async () => {
        await recovery.dismiss(writeId)
        return null
      }),
  }
}
