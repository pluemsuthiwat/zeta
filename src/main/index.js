import { app, BrowserWindow, Tray, Menu, dialog, nativeImage, shell, Notification, nativeTheme, ipcMain } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db.js'
import { registerIpc, runningJobs } from './ipc.js'
import trayIconPath from '../../build/trayTemplate.png?asset'
import trayIcon2xPath from '../../build/trayTemplate@2x.png?asset'
import appIconPath from '../../build/icon.png?asset'

// Dev builds get their own data folder so test controllers never mix with real ones
// (and the dev Keychain entry differs from the packaged app's anyway).
const THEMES = {
  dark: { bg: '#0a0b0f', symbol: '#a3a8b6' },
  light: { bg: '#f4f5f8', symbol: '#565c6c' }
}
nativeTheme.themeSource = 'dark'

if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Zeta Dev'))
// Tests and scripts can point Zeta at a throwaway data folder.
if (process.env.ZETA_USER_DATA) app.setPath('userData', process.env.ZETA_USER_DATA)

// Windows needs an AppUserModelID for notifications (and taskbar grouping).
if (process.platform === 'win32') app.setAppUserModelId('com.suthiwat.zeta')

if (!app.requestSingleInstanceLock()) {
  // A second instance would run a second job runner against the same database.
  app.quit()
} else {
  let mainWindow = null
  let tray = null
  let quitting = false
  let store = null

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 1040,
      minHeight: 640,
      show: false,
      title: 'Zeta',
      icon: process.platform === 'win32' ? appIconPath : undefined,
      backgroundColor: THEMES.dark.bg,
      autoHideMenuBar: true,
      // Frameless look: the app header is the title bar. macOS keeps its traffic lights,
      // Windows gets native min/max/close buttons drawn over the header.
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 16, y: 16 } }
        : { titleBarOverlay: { color: THEMES.dark.bg, symbolColor: THEMES.dark.symbol, height: 48 } }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    mainWindow.once('ready-to-show', () => mainWindow.show())

    // Closing the window while a job runs only hides it: the job keeps going in the tray.
    mainWindow.on('close', (e) => {
      if (quitting || runningJobs.size === 0) return
      e.preventDefault()
      mainWindow.hide()
      ensureTray()
      if (Notification.isSupported()) {
        new Notification({ title: 'Zeta is still provisioning', body: 'The job keeps running. Open Zeta from the tray to watch it.' }).show()
      }
    })
    mainWindow.on('closed', () => (mainWindow = null))

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(process.env.ELECTRON_RENDERER_URL || 'file://')) e.preventDefault()
    })

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  function showWindow() {
    if (!mainWindow) createWindow()
    else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  }

  function ensureTray() {
    if (tray) return
    // macOS: monochrome template that follows the menu bar; Windows: the colored app icon.
    let image
    if (process.platform === 'darwin') {
      image = nativeImage.createEmpty()
      image.addRepresentation({ scaleFactor: 1, buffer: nativeImage.createFromPath(trayIconPath).toPNG() })
      image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(trayIcon2xPath).toPNG() })
      image.setTemplateImage(true)
    } else {
      image = nativeImage.createFromPath(appIconPath).resize({ width: 16, height: 16 })
    }
    tray = new Tray(image)
    tray.setToolTip(`Zeta ${app.getVersion()}`)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Zeta', click: showWindow },
        { type: 'separator' },
        { label: 'Quit Zeta', click: () => app.quit() }
      ])
    )
    tray.on('click', showWindow)
  }

  // Window chrome follows the theme the page picked (dark by default).
  ipcMain.on('window:setTheme', (_e, theme) => {
    const t = THEMES[theme] ? theme : 'dark'
    nativeTheme.themeSource = t
    if (!mainWindow) return
    mainWindow.setBackgroundColor(THEMES[t].bg)
    if (process.platform !== 'darwin') {
      mainWindow.setTitleBarOverlay({ color: THEMES[t].bg, symbolColor: THEMES[t].symbol, height: 48 })
    }
  })

  app.on('second-instance', showWindow)

  app.on('before-quit', (e) => {
    if (quitting || runningJobs.size === 0) {
      quitting = true
      return
    }
    const choice = dialog.showMessageBoxSync(mainWindow?.isVisible() ? mainWindow : undefined, {
      type: 'warning',
      buttons: ['Keep running', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'A provisioning job is running',
      message: 'A provisioning job is still running.',
      detail:
        'If you quit now the job stops. APs that were already sent may have changed or be rebooting; you would have to check them on the controller.'
    })
    if (choice === 0) e.preventDefault()
    else quitting = true
  })

  app.on('window-all-closed', () => {
    if (runningJobs.size > 0) return // stay alive in the tray
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', showWindow)

  app.on('will-quit', () => store?.close())

  app.whenReady().then(() => {
    store = openDatabase(join(app.getPath('userData'), 'zeta.db'))
    // Nothing can be running before this process started: any queued/running job was cut off.
    store.failStaleJobs(0, 'Zeta was closed while this AP was in progress. Check this AP on the controller.')
    setInterval(
      () => store.failStaleJobs(3 * 60_000, 'The job stopped responding. Check this AP on the controller.'),
      60_000
    )
    registerIpc(store)
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(appIconPath)
    createWindow()
  })
}
