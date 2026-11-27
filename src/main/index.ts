import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { DEBUG_PREVIEW_CHANNEL, ipcEventChannel } from '@shared/ipc'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron'
import { CameraNames } from './cameras-store'
import { CONTENT_SECURITY_POLICY, DEV_CONTENT_SECURITY_POLICY } from './csp'
import { exiftool } from './exiftool'
import { createHandlers } from './handlers'
import { registerIpc } from './ipc'
import { Library } from './library/library'
import { PreviewEngine } from './preview'
import { Secrets } from './secrets'
import { SettingsStore } from './settings'
import { runSmoke } from './smoke'
import { type ImageOps, THUMB_SCHEME, ThumbnailCache } from './thumbs'

// Lets the packaged-app tests run against a throwaway profile.
if (process.env.STECKNADEL_USER_DATA) app.setPath('userData', process.env.STECKNADEL_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true } },
])

const imageOps: ImageOps = {
  resizeJpeg(jpeg, size) {
    const image = nativeImage.createFromBuffer(jpeg)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    const scale = size / Math.max(width, height)
    const out =
      scale < 1
        ? image.resize({
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            quality: 'good',
          })
        : image
    return out.toJPEG(82)
  },
  async osThumbnail(file, size) {
    const image = await nativeImage.createThumbnailFromPath(file, { width: size, height: size })
    return image.isEmpty() ? null : image.toJPEG(82)
  },
}

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

async function choosePath(options: Electron.OpenDialogOptions): Promise<string | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
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

app.whenReady().then(async () => {
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

  const userData = app.getPath('userData')
  const cameraNames = new CameraNames(join(userData, 'cameras.json'))
  await cameraNames.load()
  const library = new Library(exiftool, () => cameraNames.all())
  const settings = new SettingsStore(join(userData, 'settings.json'))
  await settings.load()
  const secrets = new Secrets(join(userData, 'secrets.bin'), safeStorage)
  const thumbs = new ThumbnailCache(join(userData, 'thumbs'), exiftool, imageOps)
  const preview = new PreviewEngine(exiftool)
  app.on('will-quit', () => {
    void preview.dispose()
  })
  if (process.env.STECKNADEL_E2E === '1') {
    ipcMain.handle(DEBUG_PREVIEW_CHANNEL, () => preview.snapshot)
  }

  protocol.handle(THUMB_SCHEME, async (request) => {
    const url = new URL(request.url)
    const file = url.host === 'thumb' ? thumbs.resolve(url.pathname) : null
    if (!file) return new Response(null, { status: 404 })
    try {
      return new Response(await readFile(file), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })

  registerIpc(
    createHandlers({
      et: exiftool,
      library,
      thumbs,
      cameraNames,
      appInfo: async () => ({
        version: app.getVersion(),
        exiftoolVersion: await exiftool.version(),
        platform: process.platform as 'darwin' | 'win32' | 'linux',
      }),
      settings,
      secrets,
      preview,
      tracks: { current: null },
      chooseFolder: () => choosePath({ title: 'Open photo folder', properties: ['openDirectory'] }),
      chooseGpxFile: () =>
        choosePath({
          title: 'Load GPX track',
          properties: ['openFile'],
          filters: [{ name: 'GPX track', extensions: ['gpx'] }],
        }),
      send: (event, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(ipcEventChannel(event), payload)
        }
      },
    }),
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
