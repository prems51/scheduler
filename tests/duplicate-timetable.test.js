import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function seed() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)

  const timetableId = insert('INSERT INTO timetables (title, effective_from) VALUES (?, ?)', '2026-27 Odd', '2026-07-14')
  const KN = insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'KN', 'Ms. Kanchan')
  const PAG = insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'PAG', 'Ms. Prachi')
  const dbms = insert('INSERT INTO subjects (code, name) VALUES (?, ?)', 'BCS501', 'DBMS')
  const lab = insert('INSERT INTO subjects (code, name) VALUES (?, ?)', 'BCS551', 'DBMS Lab')
  const room = insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-321', 'classroom')

  const sectionA = insert('INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)', timetableId, 5, 'A')
  const sectionB = insert('INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)', timetableId, 5, 'B')

  const allocationA = insert('INSERT INTO allocations (section_id, subject_id) VALUES (?, ?)', sectionA, dbms)
  const allocationB = insert('INSERT INTO allocations (section_id, subject_id) VALUES (?, ?)', sectionB, dbms)
  insert('INSERT INTO allocation_teachers (allocation_id, teacher_id) VALUES (?, ?)', allocationA, KN)
  insert('INSERT INTO allocation_teachers (allocation_id, teacher_id) VALUES (?, ?)', allocationB, KN)

  const insertSlot = (section, day, period, subject, mergeGroup = null, override = 0) =>
    insert(
      `INSERT INTO slots
         (section_id, day, start_period, span, kind, subject_id, venue_id, merge_group, constraint_override)
       VALUES (?, ?, ?, 1, 'L', ?, ?, ?, ?)`,
      section,
      day,
      period,
      subject,
      room,
      mergeGroup,
      override
    )

  const slotA1 = insertSlot(sectionA, 1, 1, dbms, 'original-group')
  const slotB1 = insertSlot(sectionB, 1, 1, dbms, 'original-group')
  const slotA2 = insertSlot(sectionA, 2, 2, lab, null, 1)
  for (const slot of [slotA1, slotB1, slotA2]) {
    insert('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)', slot, KN)
  }

  db.prepare(
    'INSERT INTO availability (timetable_id, target_type, target_id, day, period, level) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(timetableId, 'teacher', KN, 1, 1, 'cannot')
  db.prepare(
    'INSERT INTO availability (timetable_id, target_type, target_id, day, period, level) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(timetableId, 'venue', room, 2, 2, 'avoid')
  db.prepare(
    'INSERT INTO availability (timetable_id, target_type, target_id, day, period, level) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(timetableId, 'section', sectionA, 4, 4, 'cannot')
  db.prepare(
    'INSERT INTO availability_notes (timetable_id, target_type, target_id, note) VALUES (?, ?, ?, ?)'
  ).run(timetableId, 'teacher', KN, 'Doctor appointment')
  db.prepare(
    'INSERT INTO availability_notes (timetable_id, target_type, target_id, note) VALUES (?, ?, ?, ?)'
  ).run(timetableId, 'section', sectionA, 'Lab day')

  return {
    db,
    ids: { timetableId, KN, PAG, dbms, lab, room, sectionA, sectionB, slotA1, slotB1, slotA2 }
  }
}

describe('duplicate timetable', () => {
  let db
  let ids

  beforeEach(() => {
    ;({ db, ids } = seed())
  })

  afterEach(() => {
    db.close()
  })

  it('copies sections, allocations, classes and teachers into a new term', () => {
    const result = timetableCore.duplicateTimetable(db, ids.timetableId, '2026-27 Even')

    expect(result.timetable.title).toBe('2026-27 Even')
    expect(result.timetable.effective_from).toBe('2026-07-14')
    expect(result.counts).toMatchObject({ sections: 2, allocations: 2, slots: 3, availability: 3, notes: 2 })

    const newId = result.timetable.id
    const newSections = db
      .prepare('SELECT * FROM sections WHERE timetable_id = ? ORDER BY semester, name')
      .all(newId)
    expect(newSections).toHaveLength(2)
    expect(newSections.map((section) => section.name)).toEqual(['A', 'B'])

    const newSlots = db
      .prepare(
        `SELECT s.* FROM slots s JOIN sections sec ON sec.id = s.section_id
         WHERE sec.timetable_id = ? ORDER BY s.id`
      )
      .all(newId)
    expect(newSlots).toHaveLength(3)
    expect(newSlots.find((slot) => slot.constraint_override === 1)).toBeTruthy()

    const newMergeGroups = new Set(newSlots.map((slot) => slot.merge_group).filter(Boolean))
    expect(newMergeGroups.size).toBe(1)
    const [newMergeGroup] = [...newMergeGroups]
    expect(newMergeGroup).not.toBe('original-group')
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM slot_teachers st JOIN slots s ON s.id = st.slot_id JOIN sections sec ON sec.id = s.section_id WHERE sec.timetable_id = ?').get(newId).count
    ).toBe(3)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM allocation_teachers at JOIN allocations a ON a.id = at.allocation_id JOIN sections sec ON sec.id = a.section_id WHERE sec.timetable_id = ?').get(newId).count
    ).toBe(2)
  })

  it('copies requests and remaps section targets to the new sections', () => {
    const result = timetableCore.duplicateTimetable(db, ids.timetableId, 'Copy with requests')
    const newId = result.timetable.id
    const newSectionA = db
      .prepare('SELECT id FROM sections WHERE timetable_id = ? AND name = ?')
      .get(newId, 'A').id

    const requests = db
      .prepare('SELECT target_type, target_id, day, period, level FROM availability WHERE timetable_id = ? ORDER BY target_type')
      .all(newId)
    expect(requests).toHaveLength(3)
    expect(requests.find((row) => row.target_type === 'section').target_id).toBe(newSectionA)
    expect(requests.find((row) => row.target_type === 'teacher').target_id).toBe(ids.KN)
    expect(requests.find((row) => row.target_type === 'venue').target_id).toBe(ids.room)

    const notes = db
      .prepare('SELECT target_type, target_id FROM availability_notes WHERE timetable_id = ? ORDER BY target_type')
      .all(newId)
    expect(notes).toHaveLength(2)
    expect(notes.find((row) => row.target_type === 'section').target_id).toBe(newSectionA)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM availability WHERE timetable_id = ?').get(ids.timetableId).count
    ).toBe(3)
    expect(
      db.prepare('SELECT merge_group FROM slots WHERE id = ?').get(ids.slotA1).merge_group
    ).toBe('original-group')
  })

  it('builds the dashboard counts and per-section slot counts', () => {
    const overview = timetableCore.dashboardOverview(db, ids.timetableId)
    expect(overview.stats).toMatchObject({ sections: 2, teachers: 2, subjects: 2, venues: 1, slots: 3 })
    const sectionA = overview.sections.find((section) => section.id === ids.sectionA)
    expect(sectionA.slot_count).toBe(2)
    expect(sectionA.allocation_count).toBe(1)
    expect(sectionA.conflicts).toBeGreaterThanOrEqual(1)
  })

  it('rejects an empty title and an unknown timetable', () => {
    expect(() => timetableCore.duplicateTimetable(db, ids.timetableId, '   ')).toThrow(/title/i)
    expect(() => timetableCore.duplicateTimetable(db, 99999, 'Copy')).toThrow(/no longer exists/i)
  })
})
