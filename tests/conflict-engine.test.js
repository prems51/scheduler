import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import seedModule from '../scripts/seed-section-b.js'

const { seedSectionB, SLOTS } = seedModule
const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  return db
}

function problemsOf(result) {
  return (result.problems || []).map((problem) => problem.type)
}

describe('section B timetable (Students Timetable 2026-27, Odd Semester)', () => {
  let db
  let ids

  beforeEach(() => {
    db = freshDb()
    ids = seedSectionB(db)
  })

  afterEach(() => {
    db.close()
  })

  // ---------- helpers ----------
  const otherSection = (name = 'A') =>
    Number(
      db
        .prepare('INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)')
        .run(ids.timetableId, 5, name).lastInsertRowid
    )

  const slot = (overrides = {}) => ({
    section_id: ids.sectionId,
    day: 1,
    start_period: 1,
    span: 1,
    kind: 'L',
    subject_id: ids.subjectIds.BCS501,
    batch_no: null,
    elective_group: null,
    venue_id: ids.venueIds['B-321'],
    label: null,
    ...overrides
  })

  it('seeds all 43 slots through saveSlot with zero conflicts', () => {
    expect(SLOTS).toHaveLength(43)
    expect(ids.slotIds).toHaveLength(43)
    expect(db.prepare('SELECT COUNT(*) AS count FROM slots').get().count).toBe(43)

    // Re-check every stored slot against the rest of the timetable.
    for (const slotId of ids.slotIds) {
      const row = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId)
      const teacherIds = db
        .prepare('SELECT teacher_id FROM slot_teachers WHERE slot_id = ?')
        .all(slotId)
        .map((r) => r.teacher_id)
      expect(timetableCore.checkConflicts(db, row, teacherIds, slotId)).toEqual([])
    }
  })

  it('rejects a teacher clash (KN at Mon P3 in another section)', () => {
    const sectionA = otherSection()
    const result = timetableCore.saveSlot(
      db,
      slot({
        section_id: sectionA,
        day: 1,
        start_period: 3,
        kind: 'L',
        subject_id: ids.subjectIds.BCS501,
        venue_id: ids.venueIds['B-317']
      }),
      [ids.teacherIds.KN]
    )

    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('teacher')
    expect(result.problems[0].message).toContain('KN')
  })

  it('rejects a venue clash (another section in B-321 at Mon P1)', () => {
    const sectionA = otherSection()
    const result = timetableCore.saveSlot(
      db,
      slot({
        section_id: sectionA,
        day: 1,
        start_period: 1,
        subject_id: ids.subjectIds.BCS501,
        venue_id: ids.venueIds['B-321']
      }),
      [ids.teacherIds.VB]
    )

    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('venue')
    expect(result.problems[0].message).toContain('B-321')
  })

  it('rejects a whole-section slot over an existing class at Mon P1', () => {
    const result = timetableCore.saveSlot(
      db,
      slot({ day: 1, start_period: 1, venue_id: ids.venueIds['B-317'] }),
      [ids.teacherIds.VB]
    )

    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('section')
    expect(result.problems[0].message).toContain('already has a class')
  })

  it('accepts B1 and B2 practicals running in parallel', () => {
    const b1 = timetableCore.saveSlot(
      db,
      slot({
        day: 4,
        start_period: 5,
        kind: 'P',
        subject_id: ids.subjectIds.BCS553,
        batch_no: 1,
        venue_id: ids.venueIds['B-113']
      }),
      [ids.teacherIds.ATS]
    )
    const b2 = timetableCore.saveSlot(
      db,
      slot({
        day: 4,
        start_period: 5,
        kind: 'P',
        subject_id: ids.subjectIds.BCS552,
        batch_no: 2,
        venue_id: ids.venueIds['B-109']
      }),
      [ids.teacherIds.PAG]
    )

    expect(b1.ok).toBe(true)
    expect(b2.ok).toBe(true)
  })

  it('rejects a batch slot when a whole-section slot occupies the same period', () => {
    const b1 = timetableCore.saveSlot(
      db,
      slot({
        day: 4,
        start_period: 5,
        kind: 'P',
        subject_id: ids.subjectIds.BCS553,
        batch_no: 1,
        venue_id: ids.venueIds['B-113']
      }),
      [ids.teacherIds.ATS]
    )
    expect(b1.ok).toBe(true)

    const wholeSection = timetableCore.saveSlot(
      db,
      slot({
        day: 4,
        start_period: 5,
        subject_id: ids.subjectIds.BCS501,
        venue_id: ids.venueIds['B-318']
      }),
      [ids.teacherIds.VB]
    )

    expect(wholeSection.ok).toBe(false)
    expect(problemsOf(wholeSection)).toContain('section')
  })

  it('rejects a lab that crosses lunch (P4 with span 2)', () => {
    const sectionA = otherSection()
    const result = timetableCore.saveSlot(
      db,
      slot({
        section_id: sectionA,
        day: 2,
        start_period: 4,
        span: 2,
        kind: 'P',
        subject_id: ids.subjectIds.BCS551,
        venue_id: ids.venueIds['B-109']
      }),
      [ids.teacherIds.VB]
    )

    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('lunch')
  })

  it('rejects a P4 lecture that overlaps a P3-P4 practical for the same teacher', () => {
    const sectionA = otherSection()
    const result = timetableCore.saveSlot(
      db,
      slot({
        section_id: sectionA,
        day: 1,
        start_period: 4,
        kind: 'L',
        subject_id: ids.subjectIds.BCS501,
        venue_id: ids.venueIds['B-317']
      }),
      [ids.teacherIds.KN]
    )

    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('teacher')
    expect(result.problems[0].message).toContain('KN')
  })

  it('does not report a slot as conflicting with itself when editing', () => {
    const row = db.prepare('SELECT * FROM slots WHERE id = ?').get(ids.slotIds[0])
    const teacherIds = db
      .prepare('SELECT teacher_id FROM slot_teachers WHERE slot_id = ?')
      .all(row.id)
      .map((r) => r.teacher_id)

    const result = timetableCore.saveSlot(db, { ...row }, teacherIds, row.id)

    expect(result.ok).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM slots').get().count).toBe(43)
  })

  it('accepts parallel electives that share an elective_group and rejects them without one', () => {
    const groupSlot = slot({
      day: 4,
      start_period: 5,
      subject_id: ids.subjectIds.MNPM501,
      venue_id: ids.venueIds['B-318'],
      elective_group: 'E9'
    })
    const electiveA = timetableCore.saveSlot(db, groupSlot, [ids.teacherIds.VAG])
    const electiveB = timetableCore.saveSlot(
      db,
      { ...groupSlot, subject_id: ids.subjectIds.HTCS501, venue_id: ids.venueIds['B-321'] },
      [ids.teacherIds.ASP]
    )

    expect(electiveA.ok).toBe(true)
    expect(electiveB.ok).toBe(true)

    const noGroup = slot({
      day: 4,
      start_period: 6,
      subject_id: ids.subjectIds.MNPM501,
      venue_id: ids.venueIds['B-318']
    })
    const plainA = timetableCore.saveSlot(db, noGroup, [ids.teacherIds.VAG])
    const plainB = timetableCore.saveSlot(
      db,
      { ...noGroup, subject_id: ids.subjectIds.HTCS501, venue_id: ids.venueIds['B-321'] },
      [ids.teacherIds.ASP]
    )

    expect(plainA.ok).toBe(true)
    expect(plainB.ok).toBe(false)
    expect(problemsOf(plainB)).toContain('section')
  })

  // ---------- generated views ----------
  it('facultyTimetable for KN returns exactly her seeded classes', () => {
    const expected = SLOTS.filter((entry) => (entry.teachers || []).includes('KN'))
      .map((entry) => `${entry.day}-${entry.period}-${entry.subject}`)
      .sort()
    const actual = timetableCore
      .facultyTimetable(db, ids.timetableId, ids.teacherIds.KN)
      .map((row) => `${row.day}-${row.start_period}-${row.subject_code}`)
      .sort()

    expect(actual).toHaveLength(7)
    expect(actual).toEqual(expected)
  })

  it('venueTimetable for B-114 returns exactly its seeded labs', () => {
    const expected = SLOTS.filter((entry) => entry.venue === 'B-114')
      .map((entry) => `${entry.day}-${entry.period}-${entry.subject}`)
      .sort()
    const actual = timetableCore
      .venueTimetable(db, ids.timetableId, ids.venueIds['B-114'])
      .map((row) => `${row.day}-${row.start_period}-${row.subject_code}`)
      .sort()

    expect(actual).toEqual(['1-3-BCS551', '5-5-BCS551'])
    expect(actual).toEqual(expected)
  })
})
