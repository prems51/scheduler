import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import seedModule from '../scripts/seed-section-b.js'

const { seedSectionB } = seedModule
const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  return db
}

describe('busy resources', () => {
  let db
  let ids

  beforeEach(() => {
    db = freshDb()
    ids = seedSectionB(db)
  })

  afterEach(() => {
    db.close()
  })

  const slotId = (subjectCode, day, period) =>
    db
      .prepare(
        `SELECT s.id FROM slots s
         JOIN subjects sub ON sub.id = s.subject_id
         WHERE sub.code = ? AND s.day = ? AND s.start_period = ?`
      )
      .get(subjectCode, day, period).id

  it('reports the teacher and venue of a single busy period with a reason', () => {
    const busy = timetableCore.busyResources(db, ids.timetableId, 1, 1, 1)

    expect(busy.teachers).toHaveLength(1)
    expect(busy.teachers[0]).toMatchObject({ id: ids.teacherIds.PAG })
    expect(busy.teachers[0].reason).toContain('Mon P1')
    expect(busy.teachers[0].reason).toContain('Sem 5-B')
    expect(busy.teachers[0].reason).toContain('BCS502')

    expect(busy.venues).toHaveLength(1)
    expect(busy.venues[0]).toMatchObject({ id: ids.venueIds['B-321'] })
    expect(busy.venues[0].reason).toContain('BCS502')
  })

  it('does not report the slot being edited as busy', () => {
    const busy = timetableCore.busyResources(db, ids.timetableId, 1, 1, 1, slotId('BCS502', 1, 1))

    expect(busy).toEqual({ teachers: [], venues: [] })
  })

  it('lists both parallel electives, but drops the ignored elective', () => {
    const all = timetableCore.busyResources(db, ids.timetableId, 3, 5, 1)
    expect(all.teachers.map((entry) => entry.id).sort()).toEqual(
      [ids.teacherIds.ASP, ids.teacherIds.VAG].sort()
    )
    expect(all.venues.map((entry) => entry.id).sort()).toEqual(
      [ids.venueIds['B-321'], ids.venueIds['B-318']].sort()
    )

    const mnpm = slotId('MNPM501', 3, 5)
    const other = timetableCore.busyResources(db, ids.timetableId, 3, 5, 1, mnpm)
    expect(other.teachers.map((entry) => entry.id)).toEqual([ids.teacherIds.ASP])
    expect(other.venues.map((entry) => entry.id)).toEqual([ids.venueIds['B-321']])
    const reason = other.teachers[0].reason
    expect(reason).toContain('Wed P5')
    expect(reason).toContain('HTCS501')
  })

  it('covers a multi-period range and de-duplicates teachers', () => {
    // Wed P4 (BCS055, AM) + Wed P5 (two electives).
    const busy = timetableCore.busyResources(db, ids.timetableId, 3, 4, 2)
    const teacherIds = busy.teachers.map((entry) => entry.id)

    expect(teacherIds).toContain(ids.teacherIds.AM)
    expect(teacherIds).toContain(ids.teacherIds.VAG)
    expect(teacherIds).toContain(ids.teacherIds.ASP)
    expect(new Set(teacherIds).size).toBe(teacherIds.length)
    expect(busy.teachers.find((entry) => entry.id === ids.teacherIds.AM).reason).toContain('Wed P4')
  })
})

describe('whole-timetable validation', () => {
  let db
  let ids

  beforeEach(() => {
    db = freshDb()
    ids = seedSectionB(db)
  })

  afterEach(() => {
    db.close()
  })

  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)

  it('finds no problems in the seeded Section B timetable', () => {
    const report = timetableCore.validateTimetable(db, ids.timetableId)

    expect(report.checked).toBe(43)
    expect(report.slots).toEqual([])
  })

  it('reports teacher and venue clashes from a stored conflict', () => {
    const sectionId = insert(
      'INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)',
      ids.timetableId,
      5,
      'A'
    )
    const clashId = insert(
      `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, venue_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sectionId,
      1,
      1,
      1,
      'L',
      ids.subjectIds.BCS501,
      ids.venueIds['B-321']
    )
    insert(
      'INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)',
      clashId,
      ids.teacherIds.PAG
    )

    const report = timetableCore.validateTimetable(db, ids.timetableId)
    expect(report.checked).toBe(44)
    expect(report.slots).toHaveLength(2)

    const clash = report.slots.find((entry) => entry.slot_id === clashId)
    expect(clash).toMatchObject({
      section: 'Sem 5-A',
      where: 'Mon P1',
      what: 'BCS501',
      day: 1,
      start_period: 1
    })
    expect(clash.problems.map((problem) => problem.type).sort()).toEqual(['teacher', 'venue'])

    const original = report.slots.find((entry) => entry.slot_id !== clashId)
    expect(original.section).toBe('Sem 5-B')
    expect(original.what).toBe('BCS502')
  })

  it('reports a stored class that runs across lunch', () => {
    const sectionId = insert(
      'INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)',
      ids.timetableId,
      5,
      'C'
    )
    const lunchId = insert(
      `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, venue_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sectionId,
      2,
      4,
      2,
      'L',
      ids.subjectIds.BCS501,
      ids.venueIds['B-317']
    )
    insert(
      'INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)',
      lunchId,
      ids.teacherIds.VB
    )

    const report = timetableCore.validateTimetable(db, ids.timetableId)
    const lunch = report.slots.find((entry) => entry.slot_id === lunchId)
    expect(lunch.problems.map((problem) => problem.type)).toContain('lunch')
  })
})
