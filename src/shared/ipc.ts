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
import {
  type JournalView,
  type RecoveryResult,
  restoreInputSchema,
  type TargetValues,
  type WriteProgress,
  type WriteResult,
  writeInputSchema,
  writeRefSchema,
} from './write'

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
  getUpdate: {
    input: z.undefined(),
    output: z.custom<UpdateState>(),
  },
  /** Quits and installs a downloaded update (NSIS installs only). */
  installUpdate: {
    input: z.undefined(),
    output: z.void(),
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
  /** The IANA zone at each point of the loaded track (aligned with the geometry's points). */
  getTrackZones: {
    input: z.undefined(),
    output: z.custom<(string | null)[] | null>(),
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
  /**
   * Writes the confirmed preview into the files. `stale` when the preview, the settings or the
   * files no longer match what the user confirmed (nothing was touched then).
   */
  writePhotos: {
    input: writeInputSchema,
    output: z.custom<WriteResult>(),
  },
  /** Shows a save dialog and writes the last report as CSV; false when cancelled or none. */
  exportReport: {
    input: z.undefined(),
    output: z.custom<boolean>(),
  },
  /** Reads the open folder again (after a restore changed its files); null when none is open. */
  reloadFolder: {
    input: z.undefined(),
    output: z.custom<LibrarySnapshot | null>(),
  },
  /** Recent writes that can still be restored or have backups. */
  listWrites: {
    input: z.undefined(),
    output: z.custom<JournalView[]>(),
  },
  /** An interrupted write's targets: journaled values next to the current ones. */
  inspectWrite: {
    input: writeRefSchema,
    output: z.custom<TargetValues[]>(),
  },
  restoreValues: {
    input: restoreInputSchema,
    output: z.custom<RecoveryResult>(),
  },
  restoreOriginals: {
    input: restoreInputSchema,
    output: z.custom<RecoveryResult>(),
  },
  cleanupBackups: {
    input: writeRefSchema,
    output: z.custom<RecoveryResult>(),
  },
  /** Forgets a write whose files were moved or deleted. */
  dismissWrite: {
    input: writeRefSchema,
    output: z.custom<null>(),
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

/** A newer version: on GitHub (portable, macOS) or downloaded and ready to install (NSIS). */
export type UpdateState =
  | { kind: 'none' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'ready'; version: string }

/** A View menu panel command. */
export type PanelCommand = 'cameras' | 'photos' | 'metadata' | 'map-only'

/** main → renderer events. */
export interface IpcEvents {
  libraryProgress: LibraryProgress
  trackProgress: { page: number; totalPages: number }
  panel: PanelCommand
  writeProgress: WriteProgress
  update: UpdateState
}
export type IpcEventName = keyof IpcEvents
export const ipcEventNames: IpcEventName[] = [
  'libraryProgress',
  'trackProgress',
  'panel',
  'writeProgress',
  'update',
]
export const ipcEventChannel = (name: IpcEventName): string => `stecknadel:event:${name}`

export type StecknadelApi = {
  [K in IpcName]: (
    ...args: undefined extends IpcInput<K> ? [input?: IpcInput<K>] : [input: IpcInput<K>]
  ) => Promise<IpcOutput<K>>
} & {
  /** Subscribes to a main → renderer event; returns the unsubscribe function. */
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
