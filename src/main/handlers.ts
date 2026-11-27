import type { IpcEventName, IpcEvents, IpcOutput } from '@shared/ipc'
import type { ExifTool } from 'exiftool-vendored'
import type { CameraNames } from './cameras-store'
import type { Handlers } from './ipc'
import type { Library } from './library/library'
import { readMetadata } from './library/metadata'
import type { ThumbnailCache } from './thumbs'

export interface HandlerDeps {
  et: ExifTool
  library: Library
  thumbs: ThumbnailCache
  cameraNames: CameraNames
  appInfo: () => Promise<IpcOutput<'getAppInfo'>>
  /** Main's own folder picker; the only way a path enters the app. */
  chooseFolder: () => Promise<string | null>
  send: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
}

export function createHandlers(deps: HandlerDeps): Handlers {
  const { library } = deps
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
  }
}
