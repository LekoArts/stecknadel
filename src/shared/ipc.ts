import { z } from 'zod'
import type {
  CameraSummary,
  LibraryProgress,
  LibrarySnapshot,
  MetadataGroups,
  ThumbnailResult,
} from './library'
import { PHOTO_ID_PATTERN } from './library'
import { type PreviewSnapshot, previewInputSchema, type TrackGeometry } from './preview'
import { type SettingsView, saveSettingsSchema } from './settings'
import type { TrackSummary } from './track/types'

const photoRef = z.strictObject({ id: z.string().regex(PHOTO_ID_PATTERN) })

const MAX_FETCH_DAYS = 400
const utcInstant = z.iso.datetime({ offset: false })

/** What the renderer may know about the Dawarich connection: never the key itself. */
export interface DawarichState {
  url: string | null
  hasKey: boolean
  /** False when the OS offers no secure storage; the key can't be saved then. */
  secureStorage: boolean
}

/**
 * The typed IPC contract between renderer and main. Every renderer → main call is listed here
 * with a zod schema for its input (validated in main) and the TS type of its result.
 * The preload exposes each entry as `window.stecknadel.<name>(input)`.
 *
 * Photos are addressed by opaque IDs from the loaded library, never by path; folders only come
 * from main's own open dialog.
 */
export const ipcContract = {
  getAppInfo: {
    input: z.undefined(),
    output: z.object({
      version: z.string(),
      exiftoolVersion: z.string(),
      platform: z.enum(['darwin', 'win32', 'linux']),
    }),
  },
  /** Shows the folder picker and loads the chosen folder; null when cancelled or superseded. */
  openFolder: {
    input: z.undefined(),
    output: z.custom<LibrarySnapshot | null>(),
  },
  getThumbnail: {
    input: photoRef,
    output: z.custom<ThumbnailResult>(),
  },
  getMetadata: {
    input: photoRef,
    output: z.custom<MetadataGroups>(),
  },
  renameCamera: {
    input: z.strictObject({ key: z.string().min(1).max(500), name: z.string().max(100) }),
    output: z.custom<CameraSummary[]>(),
  },
  getTrackState: {
    input: z.undefined(),
    output: z.custom<{ track: TrackSummary | null; dawarich: DawarichState }>(),
  },
  /** Shows the GPX file picker and loads the chosen file; null when cancelled. */
  loadGpx: {
    input: z.undefined(),
    output: z.custom<TrackSummary | null>(),
  },
  /** Saves the server address and, if given, a new API key (write-only). */
  saveDawarichSettings: {
    input: z.strictObject({
      url: z.string().min(1).max(2000),
      key: z.string().min(1).max(4096).optional(),
    }),
    output: z.custom<DawarichState>(),
  },
  /** Checks address and key (the stored key when none is given) without saving them. */
  testDawarich: {
    input: z.strictObject({
      url: z.string().min(1).max(2000),
      key: z.string().min(1).max(4096).optional(),
    }),
    output: z.custom<{ version: string | null }>(),
  },
  /** Fetches the points in [start, end] with the saved address and key. */
  fetchDawarich: {
    input: z
      .strictObject({ start: utcInstant, end: utcInstant })
      .refine((r) => Date.parse(r.start) < Date.parse(r.end), 'start must be before end')
      .refine(
        (r) => Date.parse(r.end) - Date.parse(r.start) <= MAX_FETCH_DAYS * 86_400_000,
        `at most ${MAX_FETCH_DAYS} days`,
      ),
    output: z.custom<TrackSummary>(),
  },
  /** The loaded track's points and bridged stays; null without a track. */
  getTrackGeometry: {
    input: z.undefined(),
    output: z.custom<TrackGeometry | null>(),
  },
  /**
   * Runs the ExifTool preview for these camera settings; null when superseded by a newer
   * generation, or without photos or track.
   */
  runPreview: {
    input: previewInputSchema,
    output: z.custom<PreviewSnapshot | null>(),
  },
  getSettings: {
    input: z.undefined(),
    output: z.custom<SettingsView>(),
  },
  /** Saves matching, writing and map settings; a PMTiles source keeps the file main picked. */
  saveSettings: {
    input: saveSettingsSchema,
    output: z.custom<SettingsView>(),
  },
  /** Shows the PMTiles file picker and makes the chosen file the map source; null when cancelled. */
  choosePmtiles: {
    input: z.undefined(),
    output: z.custom<SettingsView | null>(),
  },
} as const

/** Test-only (STECKNADEL_E2E=1): the last preview snapshot main holds. */
export const DEBUG_PREVIEW_CHANNEL = 'stecknadel:debug:previewSnapshot'

export type IpcContract = typeof ipcContract
export type IpcName = keyof IpcContract
export type IpcInput<K extends IpcName> = z.input<IpcContract[K]['input']>
export type IpcOutput<K extends IpcName> = z.output<IpcContract[K]['output']>

export const ipcNames = Object.keys(ipcContract) as IpcName[]

export const ipcChannel = (name: IpcName): string => `stecknadel:${name}`

/** main → renderer events. */
export interface IpcEvents {
  libraryProgress: LibraryProgress
  trackProgress: { page: number; totalPages: number }
}
export type IpcEventName = keyof IpcEvents
export const ipcEventNames: IpcEventName[] = ['libraryProgress', 'trackProgress']
export const ipcEventChannel = (name: IpcEventName): string => `stecknadel:event:${name}`

export type StecknadelApi = {
  [K in IpcName]: (
    ...args: undefined extends IpcInput<K> ? [input?: IpcInput<K>] : [input: IpcInput<K>]
  ) => Promise<IpcOutput<K>>
} & {
  /** Subscribes to a main → renderer event; returns the unsubscribe function. */
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
