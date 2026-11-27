import { type IpcInput, type IpcName, type IpcOutput, ipcChannel, ipcContract } from '@shared/ipc'
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'

export type Handlers = {
  [K in IpcName]: (input: IpcInput<K>, event: IpcMainInvokeEvent) => Promise<IpcOutput<K>>
}

/**
 * Registers every contract channel. Each call is accepted only from the main window's top frame
 * loaded from the app's own origin, and only with input that passes the channel's zod schema.
 */
export function registerIpc(
  handlers: Handlers,
  getWindow: () => BrowserWindow | null,
  isAppUrl: (url: string) => boolean,
): void {
  for (const name of Object.keys(ipcContract) as IpcName[]) {
    const schema = ipcContract[name].input
    const handler = handlers[name] as (
      input: unknown,
      event: IpcMainInvokeEvent,
    ) => Promise<unknown>
    ipcMain.handle(ipcChannel(name), async (event, raw: unknown) => {
      const win = getWindow()
      const frame = event.senderFrame
      const top = win && !win.isDestroyed() ? win.webContents.mainFrame : null
      if (
        !frame ||
        !top ||
        frame.processId !== top.processId ||
        frame.routingId !== top.routingId ||
        !isAppUrl(frame.url)
      ) {
        throw new Error(`Rejected ${name}: untrusted sender`)
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`Rejected ${name}: invalid input`)
      }
      return handler(parsed.data, event)
    })
  }
}
