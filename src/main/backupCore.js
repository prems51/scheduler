// backupCore.js — file-level backup and restore helpers.
//
// No Electron imports here: the tests drive these with a temporary folder and
// a real better-sqlite3 database. The IPC wrapper in ./backupApi.js owns the
// dialogs, closing the live database and relaunching the app.

import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { LATEST_VERSION } from './migrations.js'

/**
 * The tables a Timetable Manager database must have. Availability tables are
 * deliberately absent: a v1 backup from before timing requests is still a valid
 * backup, and the app migrates it on the next start.
 */
export const REQUIRED_TABLES = [
  'teachers',
  'subjects',
  'venues',
  'periods',
  'timetables',
  'sections',
  'allocations',
  'allocation_teachers',
  'slots',
  'slot_teachers'
]

export const AUTO_BACKUP_KEEP = 14

export function backupsFolder(userData) {
  return join(userData, 'Backups')
}

export const dayStamp = (now = new Date()) => now.toISOString().slice(0, 10)

function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

function checkpoint(db) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // The backup API still takes a consistent snapshot when a checkpoint is
    // busy; a failed checkpoint must not stop a backup.
  }
}

/**
 * A copy made from a WAL database can inherit WAL mode, which would leave
 * `-wal`/`-shm` files beside the backup and make it look like several files.
 * Checkpoint and switch the copy to a single-file journal before it is used.
 */
function normalizeGeneratedBackup(path) {
  let copy
  try {
    copy = new Database(path)
    copy.pragma('wal_checkpoint(TRUNCATE)')
    copy.pragma('journal_mode = DELETE')
  } finally {
    if (copy) copy.close()
    rmSync(`${path}-wal`, { force: true })
    rmSync(`${path}-shm`, { force: true })
  }
}

/**
 * Sorted newest-first by the timestamp in the generated file name. `prefix` is
 * a literal file-name prefix, e.g. "auto-" or "pre-restore-".
 */
export function listBackups(folder, prefix = null) {
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => name.endsWith('.db') && (prefix === null || name.startsWith(prefix)))
    .sort((a, b) => b.localeCompare(a))
    .map((name) => join(folder, name))
}

export function newestBackup(folder, prefix = null) {
  return listBackups(folder, prefix)[0] ?? null
}

/**
 * Reads a candidate backup and returns its version and row counts. Throws a
 * message suitable for showing to a non-technical user when the file is not a
 * valid Timetable Manager database.
 */
export function inspectDatabaseFile(file) {
  const path = String(file ?? '').trim()
  if (!path) throw new Error('Choose a backup file first.')
  if (!existsSync(path)) throw new Error('That backup file no longer exists.')

  const stat = statSync(path)
  if (!stat.isFile()) throw new Error('That is a folder, not a backup file.')
  if (stat.size === 0) throw new Error('That file is empty, so it is not a valid backup.')

  let database
  try {
    database = new Database(path, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new Error(
      `That file is not a SQLite database the app can read. ${error.message}`
    )
  }

  try {
    try {
      const integrity = database.pragma('integrity_check', { simple: true })
      if (String(integrity).toLowerCase() !== 'ok') {
        throw new Error('That backup file is damaged and cannot be restored safely.')
      }

      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name)
      const known = new Set(tables)
      const missing = REQUIRED_TABLES.filter((table) => !known.has(table))
      if (missing.length) {
        throw new Error(
          `That is a SQLite file, but it is not a Timetable Manager backup (missing ${missing
            .slice(0, 4)
            .join(', ')}).`
        )
      }

      const version = Number(database.pragma('user_version', { simple: true })) || 0
      if (version > LATEST_VERSION) {
        throw new Error(
          'That backup was made by a newer version of Timetable Manager. Update the app before restoring it.'
        )
      }

      const count = (table) =>
        Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
      const counts = {
        timetables: count('timetables'),
        sections: count('sections'),
        teachers: count('teachers'),
        subjects: count('subjects'),
        venues: count('venues'),
        slots: count('slots'),
        allocations: count('allocations')
      }

      return { path, version, counts, tables }
    } catch (error) {
      // Keep the friendly messages above; wrap SQLite's terse "file is not a
      // database" so a non-technical user knows what is wrong.
      if (/Timetable Manager backup|newer version|damaged/i.test(error.message ?? '')) {
        throw error
      }
      throw new Error(`That file is not a valid SQLite backup. ${error.message}`)
    }
  } finally {
    database.close()
  }
}

/**
 * Copies the open database to `destination` through SQLite's backup API. The
 * file is written beside the destination first and only then moved into place,
 * so a failed backup never destroys an older file at that path.
 */
export async function backupToFile(db, destination, now = new Date()) {
  const target = String(destination ?? '').trim()
  if (!target) throw new Error('Choose where to save the backup.')
  mkdirSync(dirname(target), { recursive: true })

  const temp = `${target}.partial-${process.pid}-${now.getTime()}`
  try {
    checkpoint(db)
    await db.backup(temp)
    normalizeGeneratedBackup(temp)
    inspectDatabaseFile(temp)
    try {
      renameSync(temp, target)
    } catch {
      rmSync(target, { force: true })
      renameSync(temp, target)
    }
    rmSync(`${target}-wal`, { force: true })
    rmSync(`${target}-shm`, { force: true })
    return target
  } finally {
    rmSync(temp, { force: true })
  }
}

/** Creates a new timestamped backup inside a folder. */
export async function createBackup(db, folder, prefix = 'manual', now = new Date()) {
  let path = join(folder, `${prefix}-${backupStamp(now)}.db`)
  let suffix = 1
  while (existsSync(path)) {
    path = join(folder, `${prefix}-${backupStamp(now)}-${suffix}.db`)
    suffix += 1
  }
  return backupToFile(db, path, now)
}

/**
 * One automatic backup per calendar day on startup, pruned to the last 14.
 * A corrupt same-day file is removed and rewritten instead of being trusted.
 */
export async function createDailyBackup(db, folder, now = new Date()) {
  mkdirSync(folder, { recursive: true })
  const path = join(folder, `auto-${dayStamp(now)}.db`)

  if (existsSync(path)) {
    try {
      inspectDatabaseFile(path)
      return { path, skipped: true, removed: [] }
    } catch {
      rmSync(path, { force: true })
    }
  }

  await backupToFile(db, path, now)
  return { path, skipped: false, removed: pruneBackups(folder, 'auto-', AUTO_BACKUP_KEEP) }
}

/** Keeps the newest `keep` files matching a prefix. */
export function pruneBackups(folder, prefix, keep = AUTO_BACKUP_KEEP) {
  const files = listBackups(folder, prefix)
  const removable = files.slice(keep)
  for (const file of removable) {
    rmSync(file, { force: true })
    rmSync(`${file}-wal`, { force: true })
    rmSync(`${file}-shm`, { force: true })
  }
  return removable
}

/**
 * Replaces the live database with a validated backup. The caller must close the
 * live database first. On Windows a rename over an existing file can fail, so
 * the destination is removed only after the new file is complete and validated.
 */
export function replaceDatabaseFile(source, destination) {
  const from = String(source ?? '').trim()
  const to = String(destination ?? '').trim()
  if (!from || !to) throw new Error('A restore needs both a backup file and a database path.')
  if (from === to) throw new Error('That is the timetable currently open. Choose a backup file.')

  inspectDatabaseFile(from)
  const temp = `${to}.restore-${process.pid}-${Date.now()}`
  copyFileSync(from, temp)
  try {
    inspectDatabaseFile(temp)
    for (const suffix of ['-wal', '-shm']) rmSync(`${to}${suffix}`, { force: true })
    try {
      renameSync(temp, to)
    } catch {
      rmSync(to, { force: true })
      renameSync(temp, to)
    }
    return to
  } finally {
    rmSync(temp, { force: true })
  }
}
