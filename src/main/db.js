import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'

// Bundled at build time, so no filesystem path is guessed in dev or in the
// packaged app (asar included). schema.sql stays the single source of truth
// for a fresh database; migrations.js upgrades one that already has data.
import schemaSql from '../../schema.sql?raw'
import { LATEST_VERSION, migrate, schemaVersion } from './migrations'

let db = null
let dbFile = null

export function getDbPath() {
  return join(app.getPath('userData'), 'timetable.db')
}

function hasSlotsTable(database) {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'slots'")
      .get()
  )
}

export function getDb() {
  if (db) return db

  dbFile = getDbPath()
  db = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // A brand-new file gets schema.sql (already the final shape) and the current
  // version stamp. An existing file is NEVER run through schema.sql — its
  // indexes reference columns the old file does not have — it is migrated
  // instead, with an automatic backup of timetable.db first.
  const fresh = !hasSlotsTable(db)

  let report
  if (fresh) {
    db.exec(schemaSql)
    db.pragma(`user_version = ${LATEST_VERSION}`)
    report = { version: schemaVersion(db), applied: [], backups: [] }
  } else {
    report = migrate(db, { dbFile })
  }

  if (report.backups?.length) {
    console.log(`[db] backup written before migrating: ${report.backups.join(', ')}`)
  }
  if (report.applied?.length) {
    console.log(`[db] migrated to v${report.version} (applied ${report.applied.join(', ')})`)
  }

  const teachers = db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count
  console.log(`[db] open: ${dbFile} (schema v${report.version}, ${teachers} teacher(s))`)
  return db
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
