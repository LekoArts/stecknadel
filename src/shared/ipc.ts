import { z } from 'zod'
import type {
  CameraSummary,
  LibraryProgress,
  LibrarySnapshot,
  MetadataGroups,
  ThumbnailResult,
} from './library'
import { PHOTO_ID_PATTERN } from './library'

const photoRef = z.strictObject({ id: z.string().regex(PHOTO_ID_PATTERN) })

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
} as const

export type IpcContract = typeof ipcContract
export type IpcName = keyof IpcContract
export type IpcInput<K extends IpcName> = z.input<IpcContract[K]['input']>
export type IpcOutput<K extends IpcName> = z.output<IpcContract[K]['output']>

export const ipcNames = Object.keys(ipcContract) as IpcName[]

export const ipcChannel = (name: IpcName): string => `stecknadel:${name}`

/** main → renderer events. */
export interface IpcEvents {
  libraryProgress: LibraryProgress
}
export type IpcEventName = keyof IpcEvents
export const ipcEventNames: IpcEventName[] = ['libraryProgress']
export const ipcEventChannel = (name: IpcEventName): string => `stecknadel:event:${name}`

export type StecknadelApi = {
  [K in IpcName]: (
    ...args: undefined extends IpcInput<K> ? [input?: IpcInput<K>] : [input: IpcInput<K>]
  ) => Promise<IpcOutput<K>>
} & {
  /** Subscribes to a main → renderer event; returns the unsubscribe function. */
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
