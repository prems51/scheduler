// backupApi.js — Electron-facing part of backup/restore: file pickers, closing
// the live database, replacing the file, and relaunching after a restore.

import { app, BrowserWindow, dialog, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as schedule } from 'node:timers'
import { closeDb, getDb, getDbPath } from './db'
import {
  AUTO_BACKUP_KEEP,
  backupToFile,
  backupsFolder,
  createBackup,
  createDailyBackup,
  inspectDatabaseFile,
  newestBackup,
  replaceDatabaseFile
} from './backupCore'
import { setEditorDirty } from './closeState'
import { logError, logInfo } from './logger'

export function getBackupsFolder() {
  return backupsFolder(app.getPath('userData'))
}

function dialogParent() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

function fileDate() {
  return new Date().toISOString().slice(0, 10)
}

export async function backupInfo() {
  const folder = getBackupsFolder()
  return {
    folder,
    lastAutomatic: newestBackup(folder, 'auto-'),
    lastSafety: newestBackup(folder, 'pre-restore-'),
    keep: AUTO_BACKUP_KEEP
  }
}

/** Automatic once-a-day copy made during startup. */
export async function runStartupBackup() {
  const folder = getBackupsFolder()
  mkdirSync(folder, { recursive: true })
  const result = await createDailyBackup(getDb(), folder)
  logInfo(
    'backup:auto',
    result.skipped
      ? `today's backup already exists: ${result.path}`
      : `automatic backup written: ${result.path}`,
    result.removed.length ? { removed: result.removed } : null
  )
  return result
}

export async function backupNow() {
  const parent = dialogParent()
  const options = {
    title: 'Save a backup of the timetable database',
    defaultPath: join(app.getPath('documents'), `timetable-backup-${fileDate()}.db`),
    filters: [{ name: 'Timetable backup', extensions: ['db'] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) return { canceled: true }

  const destination = resolve(result.filePath)
  if (destination === resolve(getDbPath())) {
    throw new Error('That is the timetable currently open. Choose a different file name.')
  }

  try {
    const path = await backupToFile(getDb(), destination)
    logInfo('backup:manual', `manual backup written: ${path}`)
    return { canceled: false, path }
  } catch (error) {
    logError('backup:manual', error, { destination })
    throw error
  }
}

export async function pickRestoreFile() {
  const parent = dialogParent()
  const options = {
    title: 'Choose a Timetable Manager backup',
    defaultPath: getBackupsFolder(),
    properties: ['openFile'],
    filters: [{ name: 'Timetable backup', extensions: ['db'] }]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths?.[0]) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
}

export function inspectRestore(path) {
  const info = inspectDatabaseFile(path)
  return { ...info, liveDatabase: getDbPath() }
}

/**
 * Validates, copies, and replaces the live database. A pre-restore safety copy
 * is written first; if anything after closing the database fails, that copy is
 * put back and the app is reopened so the user never loses the timetable.
 */
export async function restoreBackup(path) {
  const source = resolve(String(path ?? '').trim())
  const live = resolve(getDbPath())
  if (source === live) {
    throw new Error('That is the timetable currently open. Choose a backup file.')
  }

  const inspected = inspectDatabaseFile(source)
  const folder = getBackupsFolder()
  const db = getDb()
  const safety = await createBackup(db, folder, 'pre-restore')

  try {
    inspectDatabaseFile(safety)
    closeDb()
    replaceDatabaseFile(source, live)
    inspectDatabaseFile(live)
    setEditorDirty(false)
    logInfo('backup:restore', `restored ${source}; safety copy ${safety}`)

    // Let the IPC reply reach the renderer before the process is replaced.
    schedule(() => {
      app.relaunch()
      app.exit(0)
    }, 800)

    return { restarting: true, restored: inspected, safetyBackup: safety }
  } catch (error) {
    logError('backup:restore', error, { source, live, safety })
    try {
      closeDb()
      replaceDatabaseFile(safety, live)
      getDb()
    } catch (recoveryError) {
      logError('backup:restore-recovery', recoveryError, { safety, live })
    }
    throw error
  }
}

export function openBackupsFolder() {
  const folder = getBackupsFolder()
  mkdirSync(folder, { recursive: true })
  return shell.openPath(folder).then((message) => {
    if (message) throw new Error(message)
    return folder
  })
}
