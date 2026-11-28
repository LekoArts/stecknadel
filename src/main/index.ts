import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  DEBUG_PREVIEW_CHANNEL,
  type IpcEventName,
  type IpcEvents,
  ipcEventChannel,
  type PanelCommand,
} from '@shared/ipc'
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
import { installMenu, panelShortcut } from './menu'
import { PMTILES_SCHEME, servePmtiles } from './pmtilesProtocol'
import { PreviewEngine } from './preview'
import { Secrets } from './secrets'
import { SettingsStore } from './settings'
import { runSmoke } from './smoke'
import { type ImageOps, THUMB_SCHEME, ThumbnailCache } from './thumbs'
import { installKind, startUpdates } from './updates'

// Lets the packaged-app tests run against a throwaway profile.
if (process.env.STECKNADEL_USER_DATA) app.setPath('userData', process.env.STECKNADEL_USER_DATA)

// One instance per profile: writes, restores and journals are serialized only within a process.
// Electron keys the lock on the userData path, so test profiles don't collide.
if (!process.env.STECKNADEL_SMOKE_FILE && !app.requestSingleInstanceLock()) app.exit(0)

protocol.registerSchemesAsPrivileged([
  { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true } },
  {
    scheme: PMTILES_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
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

// STECKNADEL_E2E_HIDDEN=1 runs a test out of the way of whoever is using the machine: an invisible,
// click-through window that never takes focus, the Dock or the menu bar, and keeps rendering.
// Playwright drives and captures it through the page, not the screen. Without it you watch the test.
const background = process.env.STECKNADEL_E2E === '1' && process.env.STECKNADEL_E2E_HIDDEN === '1'
if (background) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
}

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

function send<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(ipcEventChannel(event), payload)
  }
}

const sendPanel = (command: PanelCommand): void => send('panel', command)

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
      backgroundThrottling: !background,
    },
  })
  mainWindow = win

  if (background) {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.setHasShadow(false)
  }
  win.on('ready-to-show', () => (background ? win.showInactive() : win.show()))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('before-input-event', (event, input) => {
    const command = panelShortcut(input)
    if (command) {
      event.preventDefault()
      if (!input.isAutoRepeat) sendPanel(command)
    }
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
  let line: string
  try {
    const result = await runSmoke(exiftool, file)
    line = result.line
    code = result.ok ? 0 : 1
  } catch (error) {
    line = `STECKNADEL_SMOKE error ${error instanceof Error ? error.message : String(error)}`
  }
  try {
    console.log(line)
    // The Windows portable exe re-spawns the app without its stdout; CI reads this file instead.
    const out = process.env.STECKNADEL_SMOKE_OUT
    if (out) await writeFile(out, `${line}\n`)
  } finally {
    await exiftool.end()
  }
  app.exit(code)
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!background) mainWindow.focus()
})

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

  protocol.handle(PMTILES_SCHEME, (request) => {
    const source = settings.get().mapSource
    return servePmtiles(request, source.kind === 'pmtiles' ? source.path : null)
  })

  const updates = startUpdates({
    kind: installKind({ platform: process.platform, packaged: app.isPackaged, vars: process.env }),
    version: app.getVersion(),
    fetchJson: async (url) => {
      const res = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Stecknadel' },
        redirect: 'error',
      })
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      return res.json()
    },
    nsis: async () => (await import('electron-updater')).autoUpdater,
    onState: (state) => send('update', state),
    log: (message) => console.warn(message),
  })
  app.on('will-quit', () => updates.stop())

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
      choosePmtilesFile: () =>
        choosePath({
          title: 'Choose offline map',
          properties: ['openFile'],
          filters: [{ name: 'PMTiles map', extensions: ['pmtiles'] }],
        }),
      chooseReportFile: async () => {
        const options = {
          title: 'Export write report',
          defaultPath: 'stecknadel-report.csv',
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        }
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options)
        return result.canceled ? null : (result.filePath ?? null)
      },
      journalDir: join(userData, 'journal'),
      updates,
      send,
    }),
    () => mainWindow,
    isAppUrl,
  )

  installMenu(sendPanel, () => send('openSettings', null))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
