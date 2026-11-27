import { type IpcName, ipcChannel, ipcNames, type StecknadelApi } from '@shared/ipc'
import { contextBridge, ipcRenderer } from 'electron'

const api = Object.fromEntries(
  ipcNames.map((name: IpcName) => [
    name,
    (input?: unknown) => ipcRenderer.invoke(ipcChannel(name), input),
  ]),
) as StecknadelApi

contextBridge.exposeInMainWorld('stecknadel', api)
