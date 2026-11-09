import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  AUTO_BACKUP_KEEP,
  backupToFile,
  createBackup,
  createDailyBackup,
  inspectDatabaseFile,
  pruneBackups,
  replaceDatabaseFile
} from '../src/main/backupCore.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function seedDatabase(path) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  db.pragma('user_version = 2')
  db.prepare('INSERT INTO timetables (title) VALUES (?)').run('Backup test timetable')
  db.prepare('INSERT INTO teachers (code, name) VALUES (?, ?)').run('KN', 'Ms. Kanchan')
  return db
}

const folders = []
const databases = []

function tempFolder() {
  const folder = mkdtempSync(join(tmpdir(), 'timetable-backup-test-'))
  folders.push(folder)
  return folder
}

afterEach(() => {
  while (databases.length) {
    try {
      databases.pop().close()
    } catch {
      // already closed by the test
    }
  }
  while (folders.length) rmSync(folders.pop(), { recursive: true, force: true })
})

describe('backup and restore helpers', () => {
  it('writes a valid backup and reads its counts back', async () => {
    const folder = tempFolder()
    const db = seedDatabase(join(folder, 'live.db'))
    databases.push(db)
    const backups = join(folder, 'Backups')

    const path = await createBackup(db, backups, 'manual', new Date('2026-01-02T03:04:05Z'))
    expect(existsSync(path)).toBe(true)

    const info = inspectDatabaseFile(path)
    expect(info.version).toBe(2)
    expect(info.counts.timetables).toBe(1)
    expect(info.counts.teachers).toBe(1)

    const copy = new Database(path, { readonly: true })
    expect(copy.prepare('SELECT title FROM timetables').get().title).toBe('Backup test timetable')
    copy.close()
  })

  it('writes to a chosen path and refuses a text file or a database without the expected tables', async () => {
    const folder = tempFolder()
    const db = seedDatabase(join(folder, 'live.db'))
    databases.push(db)

    const chosen = join(folder, 'pen-drive', 'timetable.db')
    await backupToFile(db, chosen)
    expect(inspectDatabaseFile(chosen).counts.timetables).toBe(1)

    const text = join(folder, 'notes.db')
    writeFileSync(text, 'this is not a database')
    expect(() => inspectDatabaseFile(text)).toThrow(/SQLite/i)

    const wrong = join(folder, 'wrong.db')
    const other = new Database(wrong)
    other.exec('CREATE TABLE only_one (id INTEGER PRIMARY KEY)')
    other.close()
    expect(() => inspectDatabaseFile(wrong)).toThrow(/not a Timetable Manager backup/i)
  })

  it('makes one automatic backup per day and prunes only the automatic folder', async () => {
    const folder = tempFolder()
    const db = seedDatabase(join(folder, 'live.db'))
    databases.push(db)
    const backups = join(folder, 'Backups')

    const first = await createDailyBackup(db, backups, new Date('2026-02-01T08:00:00Z'))
    expect(first.skipped).toBe(false)
    const second = await createDailyBackup(db, backups, new Date('2026-02-01T18:00:00Z'))
    expect(second.skipped).toBe(true)
    expect(second.path).toBe(first.path)

    for (let index = 0; index < 16; index += 1) {
      writeFileSync(join(backups, `auto-2025-01-${String(index + 1).padStart(2, '0')}.db`), 'x')
    }
    const removed = pruneBackups(backups, 'auto-', AUTO_BACKUP_KEEP)
    expect(removed).toHaveLength(3)
    expect(
      readdirSync(backups).filter((name) => name.startsWith('auto-') && name.endsWith('.db'))
    ).toHaveLength(AUTO_BACKUP_KEEP)
    expect(readdirSync(backups).filter((name) => name.endsWith('-wal') || name.endsWith('-shm'))).toHaveLength(0)
  })

  it('replaces a database with a validated copy', async () => {
    const folder = tempFolder()
    const db = seedDatabase(join(folder, 'live.db'))
    databases.push(db)
    const backup = await createBackup(db, join(folder, 'Backups'), 'manual')
    db.close()
    databases.pop()

    const restored = join(folder, 'restored.db')
    replaceDatabaseFile(backup, restored)
    expect(inspectDatabaseFile(restored).counts.timetables).toBe(1)
  })
})
