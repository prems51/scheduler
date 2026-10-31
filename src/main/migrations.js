// migrations.js — versioned schema migrations, applied on top of whatever the
// user's timetable.db already holds. Runs in the MAIN process (and in tests)
// with a plain better-sqlite3 database: no Electron imports here.
//
// Rules:
//   * PRAGMA user_version says which schema the file has.
//   * A fresh database gets schema.sql (already the final shape) and is stamped
//     with LATEST_VERSION; nothing is migrated.
//   * Every older database gets an automatic backup file first, then each
//     pending migration inside its own transaction.
//   * schema.sql and the migrations must always converge on the same schema.

import { basename, dirname, extname, join } from 'node:path'

export const LATEST_VERSION = 1

/** Table reconstruction shared by the migration and readable on its own. */
const SLOTS_TABLE_V1 = `
CREATE TABLE slots_v1 (
  id              INTEGER PRIMARY KEY,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  day             INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),
  start_period    INTEGER NOT NULL REFERENCES periods(no),
  span            INTEGER NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 4),
  kind            TEXT NOT NULL CHECK (kind IN ('L','T','P','ACTIVITY')),
  subject_id      INTEGER REFERENCES subjects(id),
  batch_no        INTEGER CHECK (batch_no IS NULL OR batch_no IN (1, 2)),
  elective_group  TEXT,
  venue_id        INTEGER REFERENCES venues(id),
  label           TEXT,
  merge_group     TEXT,
  CHECK (kind = 'ACTIVITY' OR subject_id IS NOT NULL),
  CHECK (start_period + span - 1 <= 8)
)`

/**
 * v1 — round-2 rules.
 *   batch TEXT ('B1'/'B2') -> batch_no INTEGER (1/2, NULL = whole section)
 *   + slots.merge_group for merged lectures
 * Rebuilds the table (SQLite cannot drop a column in place) and keeps every
 * row, index and foreign key.
 */
export const MIGRATIONS = [
  {
    version: 1,
    name: 'merge groups and derived batch numbers',
    up(db) {
      db.exec(SLOTS_TABLE_V1)
      db.exec(`
        INSERT INTO slots_v1
          (id, section_id, day, start_period, span, kind, subject_id, batch_no,
           elective_group, venue_id, label, merge_group)
        SELECT id, section_id, day, start_period, span, kind, subject_id,
               CASE
                 WHEN batch IS NULL OR TRIM(batch) = '' THEN NULL
                 WHEN TRIM(batch) GLOB '*[0-9]' THEN CAST(SUBSTR(TRIM(batch), -1) AS INTEGER)
                 ELSE NULL
               END,
               elective_group, venue_id, label, NULL
        FROM slots
      `)
      db.exec('DROP TABLE slots')
      db.exec('ALTER TABLE slots_v1 RENAME TO slots')
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_slots_day_period  ON slots (day, start_period);
        CREATE INDEX IF NOT EXISTS idx_slots_section     ON slots (section_id);
        CREATE INDEX IF NOT EXISTS idx_slots_venue       ON slots (venue_id);
        CREATE INDEX IF NOT EXISTS idx_slots_merge_group ON slots (merge_group);
      `)
    }
  }
]

export function schemaVersion(db) {
  return Number(db.pragma('user_version', { simple: true })) || 0
}

/** timetable.db -> timetable.backup-v1-2026-10-26T10-20-00-000Z.db (same folder). */
export function backupPathFor(dbFile, version, now = new Date()) {
  const folder = dirname(dbFile)
  const stem = basename(dbFile, extname(dbFile))
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return join(folder, `${stem}.backup-v${version}-${stamp}.db`)
}

/**
 * Applies every pending migration. Returns { version, applied, backups }.
 * `dbFile` is only needed for the backup; in-memory databases skip the copy.
 */
export function migrate(db, { dbFile = null, backup = true } = {}) {
  const startingVersion = schemaVersion(db)
  const applied = []
  const backups = []

  if (startingVersion >= LATEST_VERSION) {
    return { version: startingVersion, applied, backups }
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= startingVersion) continue

    if (backup && dbFile) {
      const path = backupPathFor(dbFile, migration.version)
      // VACUUM INTO writes a consistent snapshot, WAL included, in one step.
      db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
      backups.push(path)
    }

    // A table rebuild needs foreign keys off; the pragma cannot change inside
    // a transaction, so it happens around the migration.
    const hadForeignKeys = Boolean(db.pragma('foreign_keys', { simple: true }))
    if (hadForeignKeys) db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        migration.up(db)
        db.pragma(`user_version = ${migration.version}`)
      })()
    } finally {
      if (hadForeignKeys) db.pragma('foreign_keys = ON')
    }

    const broken = db.pragma('foreign_key_check')
    if (broken.length) {
      throw new Error(
        `Migration ${migration.version} left ${broken.length} broken foreign key reference(s).`
      )
    }
    applied.push(migration.version)
  }

  return { version: schemaVersion(db), applied, backups }
}
