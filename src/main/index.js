import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { join } from 'path'
import { getDb, closeDb } from './db'
import { registerIpcHandlers } from './ipc'
import { runStartupBackup } from './backupApi'
import { isEditorDirty, setEditorDirty } from './closeState'
import { installErrorLogging, logError, logInfo } from './logger'

installErrorLogging()

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    title: 'Timetable Manager',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.setTitle('Timetable Manager')
    mainWindow.show()
  })

  // An open class editor with unsaved typing must not disappear on Alt+F4 or
  // the window's close button. The renderer reports its dirty flag over IPC.
  mainWindow.on('close', (event) => {
    if (!isEditorDirty()) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Unsaved class changes',
      message: 'You have unsaved changes in the class editor.',
      detail: 'Keep editing to save them, or close and discard the changes.',
      buttons: ['Keep editing', 'Discard changes and close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (choice === 0) {
      event.preventDefault()
      return
    }
    setEditorDirty(false)
    mainWindow.destroy()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('render-process-gone', new Error(details.reason || 'renderer gone'), details)
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    logError('did-fail-load', new Error(`${description} (${code})`), { url })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  try {
    const db = getDb()
    runStartupBackup()
      .then((result) => {
        if (!result.skipped) console.log(`[backup] automatic backup: ${result.path}`)
      })
      .catch((error) => logError('backup:startup', error))
    logInfo('app:start', `database opened: ${db.name}`)
  } catch (error) {
    logError('db:open', error)
    dialog.showErrorBox(
      'Timetable data could not be opened',
      'The app could not open its database. Your file has not been deleted. Close the app, check that the folder is writable, and try again.\n\nA backup can be restored from the Settings page once the app opens.'
    )
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
