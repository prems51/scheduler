import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { LATEST_VERSION, backupPathFor, migrate, schemaVersion } from '../src/main/migrations.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const legacySql = readFileSync(join(here, 'fixtures', 'schema-v0.sql'), 'utf8')

/** A database exactly as the previous release left it: batch TEXT 'B1'/'B2'. */
function legacyDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(legacySql)

  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)

  const timetableId = insert(
    'INSERT INTO timetables (title, coordinator, convener) VALUES (?, ?, ?)',
    'Students Timetable 2026-27 (Odd Semester)',
    'Ms. Kanchan',
    'Dr. Lalit Mohan Trivedi'
  )
  const teacherId = insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'KN', 'Ms. Kanchan')
  const subjectId = insert(
    'INSERT INTO subjects (code, name) VALUES (?, ?)',
    'BCS551',
    'DBMS Lab'
  )
  const venueId = insert(
    'INSERT INTO venues (code, kind) VALUES (?, ?)',
    'B-114',
    'lab'
  )
  const sectionId = insert(
    'INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)',
    timetableId,
    5,
    'B'
  )

  const batch1 = insert(
    `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, batch, venue_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sectionId,
    1,
    3,
    2,
    'P',
    subjectId,
    'B1',
    venueId
  )
  const batch2 = insert(
    `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, batch, venue_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sectionId,
    1,
    5,
    2,
    'P',
    subjectId,
    'B2',
    venueId
  )
  const whole = insert(
    `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, batch, venue_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sectionId,
    2,
    1,
    1,
    'L',
    subjectId,
    null,
    venueId
  )
  const activity = insert(
    `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, batch, venue_id, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sectionId,
    6,
    1,
    2,
    'ACTIVITY',
    null,
    null,
    null,
    'Sports'
  )

  insert('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)', batch1, teacherId)
  insert('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)', whole, teacherId)

  return { db, ids: { timetableId, teacherId, subjectId, venueId, sectionId, batch1, batch2, whole, activity } }
}

describe('migrations', () => {
  const cleanups = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  it('upgrades a legacy database to batch_no and merge_group without losing data', () => {
    const { db, ids } = legacyDb()
    cleanups.push(() => db.close())

    expect(schemaVersion(db)).toBe(0)

    const report = migrate(db)
    expect(report.applied).toEqual([1])
    expect(report.version).toBe(LATEST_VERSION)
    expect(report.backups).toEqual([]) // in-memory database: nothing to copy

    const columns = db.prepare('PRAGMA table_info(slots)').all().map((column) => column.name)
    expect(columns).toContain('batch_no')
    expect(columns).toContain('merge_group')
    expect(columns).not.toContain('batch')

    const rows = db.prepare('SELECT * FROM slots ORDER BY id').all()
    expect(rows).toHaveLength(4)

    const [first, second, whole, activity] = rows
    expect(first).toMatchObject({ id: ids.batch1, batch_no: 1, span: 2, start_period: 3, kind: 'P' })
    expect(second).toMatchObject({ id: ids.batch2, batch_no: 2, span: 2, start_period: 5 })
    expect(whole).toMatchObject({ id: ids.whole, batch_no: null, span: 1, kind: 'L' })
    expect(activity).toMatchObject({ id: ids.activity, batch_no: null, kind: 'ACTIVITY', label: 'Sports' })

    // Teachers and foreign keys survived the table rebuild.
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM slot_teachers').get().count
    ).toBe(2)
    expect(db.pragma('foreign_key_check')).toEqual([])

    // Indexes are all back.
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'slots'")
      .all()
      .map((row) => row.name)
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_slots_day_period',
        'idx_slots_section',
        'idx_slots_venue',
        'idx_slots_merge_group'
      ])
    )
  })

  it('writes a backup file of the existing timetable.db before migrating', () => {
    const { db } = legacyDb()
    const folder = mkdtempSync(join(tmpdir(), 'timetable-migrate-'))

    const file = join(folder, 'timetable.db')
    const onDisk = new Database(file)
    onDisk.exec(legacySql)
    onDisk
      .prepare('INSERT INTO teachers (code, name) VALUES (?, ?)')
      .run('KN', 'Ms. Kanchan')
    onDisk.close()
    db.close()

    const target = new Database(file)
    cleanups.push(() => {
      target.close()
      rmSync(folder, { recursive: true, force: true })
    })
    const report = migrate(target, { dbFile: file })

    expect(report.backups).toHaveLength(1)
    expect(existsSync(report.backups[0])).toBe(true)
    expect(report.backups[0]).toContain('timetable.backup-v1-')

    // The backup is still the OLD schema with its data.
    const backup = new Database(report.backups[0])
    const backupColumns = backup.prepare('PRAGMA table_info(slots)').all().map((c) => c.name)
    expect(backupColumns).toContain('batch')
    expect(backup.prepare('SELECT COUNT(*) AS count FROM teachers').get().count).toBe(1)
    backup.close()

    // And the live file is the new schema.
    expect(schemaVersion(target)).toBe(LATEST_VERSION)
    expect(target.prepare('PRAGMA table_info(slots)').all().map((c) => c.name)).not.toContain('batch')
  })

  it('is idempotent: a second run does nothing', () => {
    const { db } = legacyDb()
    cleanups.push(() => db.close())

    migrate(db)
    const again = migrate(db)
    expect(again.applied).toEqual([])
    expect(again.version).toBe(LATEST_VERSION)
  })

  it('names backups next to the database, with a filesystem-safe stamp', () => {
    const path = backupPathFor(
      join('C:', 'data', 'timetable.db'),
      1,
      new Date('2026-10-26T10:20:30.400Z')
    )
    expect(path).toContain('timetable.backup-v1-2026-10-26T10-20-30-400Z.db')
    // Only the drive letter may carry a colon; the file name never does.
    const fileName = path.split(/[\\/]/).pop()
    expect(fileName).not.toMatch(/[:]/)
  })
})
