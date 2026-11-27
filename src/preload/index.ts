import {
  type IpcEventName,
  type IpcName,
  ipcChannel,
  ipcEventChannel,
  ipcEventNames,
  ipcNames,
  type StecknadelApi,
} from '@shared/ipc'
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'

const calls = Object.fromEntries(
  ipcNames.map((name: IpcName) => [
    name,
    (input?: unknown) => ipcRenderer.invoke(ipcChannel(name), input),
  ]),
)

function on(event: IpcEventName, listener: (payload: unknown) => void): () => void {
  if (!ipcEventNames.includes(event)) throw new Error(`Unknown event ${String(event)}`)
  const channel = ipcEventChannel(event)
  // The Electron event object is not passed on: it would expose `sender` to the page.
  const wrapped = (_: IpcRendererEvent, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('stecknadel', { ...calls, on } as StecknadelApi)
