import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, session, shell } from 'electron'
import { CONTENT_SECURITY_POLICY, DEV_CONTENT_SECURITY_POLICY } from './csp'
import { exiftool } from './exiftool'
import { registerIpc } from './ipc'
import { runSmoke } from './smoke'

const rendererIndex = join(__dirname, '../renderer/index.html')
const devUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined

let mainWindow: BrowserWindow | null = null

function isAppUrl(url: string): boolean {
  if (devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return url.split('#')[0] === pathToFileURL(rendererIndex).href
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'Stecknadel',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(rendererIndex)
  }
}

async function smokeAndExit(file: string): Promise<void> {
  let code = 1
  try {
    const { ok, line } = await runSmoke(exiftool, file)
    console.log(line)
    code = ok ? 0 : 1
  } catch (error) {
    console.log(`STECKNADEL_SMOKE error ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await exiftool.end()
  }
  app.exit(code)
}

app.on('before-quit', () => {
  void exiftool.end()
})

app.whenReady().then(() => {
  const smokeFile = process.env.STECKNADEL_SMOKE_FILE
  if (smokeFile) {
    void smokeAndExit(smokeFile)
    return
  }

  electronApp.setAppUserModelId('com.lekoarts.stecknadel')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [devUrl ? DEV_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY],
      },
    })
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc(
    {
      getAppInfo: async () => ({
        version: app.getVersion(),
        exiftoolVersion: await exiftool.version(),
        platform: process.platform as 'darwin' | 'win32' | 'linux',
      }),
    },
    () => mainWindow,
    isAppUrl,
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
