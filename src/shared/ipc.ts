import { z } from 'zod'

/**
 * The typed IPC contract between renderer and main. Every renderer → main call is listed here
 * with a zod schema for its input (validated in main) and the TS type of its result.
 * The preload exposes each entry as `window.stecknadel.<name>(input)`.
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
} as const

export type IpcContract = typeof ipcContract
export type IpcName = keyof IpcContract
export type IpcInput<K extends IpcName> = z.input<IpcContract[K]['input']>
export type IpcOutput<K extends IpcName> = z.output<IpcContract[K]['output']>

export const ipcNames = Object.keys(ipcContract) as IpcName[]

export const ipcChannel = (name: IpcName): string => `stecknadel:${name}`

export type StecknadelApi = {
  [K in IpcName]: (
    ...args: undefined extends IpcInput<K> ? [input?: IpcInput<K>] : [input: IpcInput<K>]
  ) => Promise<IpcOutput<K>>
}
