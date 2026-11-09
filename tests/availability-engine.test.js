import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import {
  availabilityCopy,
  availabilityGet,
  availabilityMatrix,
  availabilitySummary
} from '../src/main/availabilityApi.js'
import { slotsBusy, slotsSave } from '../src/main/slotsApi.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)

  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)
  const timetableId = insert('INSERT INTO timetables (title) VALUES (?)', 'Test timetable')

  const teachers = {
    KN: insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'KN', 'Ms. Kanchan'),
    PAG: insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'PAG', 'Ms. Prachi Agarwal'),
    ATS: insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'ATS', 'Dr. Amit Saxena'),
    VAG: insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'VAG', 'Mr. Varun Agarwal')
  }
  const subjects = {
    BCS501: insert('INSERT INTO subjects (code, name) VALUES (?, ?)', 'BCS501', 'DBMS'),
    BCS502: insert('INSERT INTO subjects (code, name) VALUES (?, ?)', 'BCS502', 'Web Technology')
  }
  const venues = {
    B321: insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-321', 'classroom'),
    B317: insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-317', 'classroom'),
    B101: insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-101', 'lab')
  }
  const sections = {}
  for (const name of ['A', 'B', 'C', 'D']) {
    sections[name] = insert(
      'INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)',
      timetableId,
      5,
      name
    )
  }
  return { db, ids: { timetableId, teachers, subjects, venues, sections } }
}

const slotFor = (ids, overrides = {}) => ({
  section_id: ids.sections.A,
  day: 1,
  start_period: 1,
  span: 1,
  kind: 'L',
  subject_id: ids.subjects.BCS501,
  batch_no: null,
  elective_group: null,
  venue_id: ids.venues.B321,
  label: null,
  ...overrides
})

const constraintProblems = (result) =>
  (result.problems ?? []).filter((problem) => problem.type === 'constraint')

describe('availability constraints in the engine', () => {
  let db
  let ids

  beforeEach(() => {
    const fixture = freshDb()
    db = fixture.db
    ids = fixture.ids
  })

  afterEach(() => {
    db.close()
  })

  it('rejects a slot on a hard "cannot" cell with an overridable error', () => {
    timetableCore.saveAvailability(
      db,
      ids.timetableId,
      'teacher',
      ids.teachers.KN,
      [{ day: 1, period: 1, level: 'cannot' }],
      'Asked on 2 Nov, has a clinic'
    )

    const result = timetableCore.saveSlot(
      db,
      slotFor(ids, { day: 1, start_period: 1 }),
      [ids.teachers.KN]
    )

    expect(result.ok).toBe(false)
    const [problem] = constraintProblems(result)
    expect(problem).toMatchObject({ level: 'error', overridable: true, target_type: 'teacher' })
    expect(problem.message).toContain('Ms. Kanchan (KN) is not available on Mon P1 (requested).')
    expect(problem.message).toContain('Note: Asked on 2 Nov')
  })

  it('the slots:save handler forwards overrideConstraints', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 1, period: 1, level: 'cannot' }
    ])

    expect(() => slotsSave(db, slotFor(ids), [ids.teachers.KN], null)).toThrow(
      /not available/
    )
    const saved = slotsSave(db, slotFor(ids), [ids.teachers.KN], null, {
      overrideConstraints: true
    })
    expect(saved.constraint_override).toBe(1)
    expect(saved.problems).toEqual([])

    // slots:busy also reports the level for the dropdown badges.
    const busy = slotsBusy(db, ids.timetableId, 1, 1, 1)
    expect(busy.constraints.teachers).toContainEqual({
      id: ids.teachers.KN,
      level: 'cannot'
    })
  })

  it('saves with overrideConstraints, sets constraint_override, and clears it after moving', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 1, period: 1, level: 'cannot' }
    ])

    const saved = timetableCore.saveSlot(
      db,
      slotFor(ids, { day: 1, start_period: 1 }),
      [ids.teachers.KN],
      null,
      { overrideConstraints: true }
    )
    expect(saved.ok).toBe(true)
    let row = db.prepare('SELECT * FROM slots WHERE id = ?').get(saved.id)
    expect(row.constraint_override).toBe(1)

    const moved = timetableCore.saveSlot(
      db,
      { ...row, day: 2, start_period: 1 },
      [ids.teachers.KN],
      saved.id,
      { overrideConstraints: true }
    )
    expect(moved.ok).toBe(true)
    row = db.prepare('SELECT * FROM slots WHERE id = ?').get(saved.id)
    expect(row.constraint_override).toBe(0)
  })

  it('never blocks an "avoid" request and returns it as a warning on success', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 5, period: 8, level: 'avoid' }
    ])

    const result = timetableCore.saveSlot(
      db,
      slotFor(ids, { day: 5, start_period: 8 }),
      [ids.teachers.KN]
    )

    expect(result.ok).toBe(true)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatchObject({ level: 'warning', overridable: false })
    expect(result.problems[0].message).toBe('KN prefers not to teach on Fri P8 (requested).')
    expect(db.prepare('SELECT constraint_override FROM slots WHERE id = ?').get(result.id).constraint_override).toBe(0)
  })

  it('enforces venue and section requests', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'venue', ids.venues.B321, [
      { day: 2, period: 2, level: 'cannot' }
    ])
    const venueResult = timetableCore.saveSlot(
      db,
      slotFor(ids, { day: 2, start_period: 2, venue_id: ids.venues.B321 }),
      [ids.teachers.PAG]
    )
    expect(venueResult.ok).toBe(false)
    expect(constraintProblems(venueResult)[0].message).toContain('Venue B-321 is not available')

    timetableCore.saveAvailability(db, ids.timetableId, 'section', ids.sections.A, [
      { day: 3, period: 3, level: 'cannot' }
    ])
    const sectionResult = timetableCore.saveSlot(
      db,
      slotFor(ids, { day: 3, start_period: 3, venue_id: ids.venues.B317 }),
      [ids.teachers.PAG]
    )
    expect(sectionResult.ok).toBe(false)
    expect(constraintProblems(sectionResult)[0].message).toContain(
      'Sem 5-A is not available on Wed P3'
    )
  })

  it('activity slots use only their venue and their section, never teachers', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 4, period: 4, level: 'cannot' }
    ])
    const activity = timetableCore.saveSlot(
      db,
      slotFor(ids, {
        day: 4,
        start_period: 4,
        kind: 'ACTIVITY',
        subject_id: null,
        label: 'Sports',
        venue_id: null
      }),
      [ids.teachers.KN]
    )
    expect(activity.ok).toBe(true)

    timetableCore.saveAvailability(db, ids.timetableId, 'venue', ids.venues.B101, [
      { day: 4, period: 5, level: 'cannot' }
    ])
    const blocked = timetableCore.saveSlot(
      db,
      slotFor(ids, {
        day: 4,
        start_period: 5,
        kind: 'ACTIVITY',
        subject_id: null,
        label: 'Sports',
        venue_id: ids.venues.B101
      }),
      []
    )
    expect(blocked.ok).toBe(false)
    expect(constraintProblems(blocked)[0].message).toContain('Venue B-101 is not available')
  })

  it('reports a 2-period lab touching a blocked period once, with a compact list', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.ATS, [
      { day: 1, period: 1, level: 'cannot' },
      { day: 1, period: 2, level: 'cannot' }
    ])
    const result = timetableCore.saveSlot(
      db,
      slotFor(ids, {
        day: 1,
        start_period: 1,
        span: 2,
        kind: 'P',
        venue_id: ids.venues.B101
      }),
      [ids.teachers.ATS]
    )

    expect(result.ok).toBe(false)
    const problems = constraintProblems(result)
    expect(problems).toHaveLength(1)
    expect(problems[0].periods).toEqual([1, 2])
    expect(problems[0].message).toContain('Mon P1–P2')
  })
})

describe('merged lectures and availability', () => {
  let db
  let ids

  beforeEach(() => {
    const fixture = freshDb()
    db = fixture.db
    ids = fixture.ids
  })

  afterEach(() => {
    db.close()
  })

  function mergedPair() {
    const first = timetableCore.saveSlot(db, slotFor(ids), [ids.teachers.KN])
    expect(first.ok).toBe(true)
    const second = slotFor(ids, {
      section_id: ids.sections.B,
      subject_id: ids.subjects.BCS502
    })
    const joined = timetableCore.joinMergeGroup(db, second, first.id)
    const saved = timetableCore.saveSlot(
      db,
      { ...second, merge_group: joined.merge_group, merge_with: first.id },
      [ids.teachers.KN]
    )
    expect(saved.ok).toBe(true)
    return { group: joined.merge_group, memberB: saved.id, memberA: first.id }
  }

  it('checks the shared teacher once when the group changes time', () => {
    const { group, memberB } = mergedPair()
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 2, period: 1, level: 'cannot' }
    ])

    const row = db.prepare('SELECT * FROM slots WHERE id = ?').get(memberB)
    const result = timetableCore.saveSlot(
      db,
      { ...row, day: 2, start_period: 1, merge_group: group },
      [ids.teachers.KN],
      memberB
    )

    expect(result.ok).toBe(false)
    expect(constraintProblems(result)).toHaveLength(1)
  })

  it('blocks a group edit when one member section requested that time off', () => {
    const { group, memberB } = mergedPair()
    timetableCore.saveAvailability(db, ids.timetableId, 'section', ids.sections.B, [
      { day: 3, period: 1, level: 'cannot' }
    ])

    let row = db.prepare('SELECT * FROM slots WHERE id = ?').get(memberB)
    const blocked = timetableCore.saveSlot(
      db,
      { ...row, day: 3, start_period: 1, merge_group: group },
      [ids.teachers.KN],
      memberB
    )
    expect(blocked.ok).toBe(false)
    expect(constraintProblems(blocked)[0].message).toContain('Sem 5-B is not available')

    const overridden = timetableCore.saveSlot(
      db,
      { ...row, day: 3, start_period: 1, merge_group: group },
      [ids.teachers.KN],
      memberB,
      { overrideConstraints: true }
    )
    expect(overridden.ok).toBe(true)
    const rows = db.prepare('SELECT constraint_override FROM slots WHERE merge_group = ?').all(group)
    expect(rows.every((entry) => entry.constraint_override === 1)).toBe(true)

    row = db.prepare('SELECT * FROM slots WHERE id = ?').get(memberB)
    expect(row.day).toBe(3)
  })
})

describe('availability storage', () => {
  let db
  let ids

  beforeEach(() => {
    const fixture = freshDb()
    db = fixture.db
    ids = fixture.ids
  })

  afterEach(() => {
    db.close()
  })

  it('saveAvailability replaces the cells completely and clears an empty note', () => {
    timetableCore.saveAvailability(
      db,
      ids.timetableId,
      'teacher',
      ids.teachers.KN,
      [
        { day: 1, period: 1, level: 'cannot' },
        { day: 1, period: 2, level: 'avoid' },
        { day: 9, period: 1, level: 'cannot' },
        { day: 2, period: 2, level: 'maybe' }
      ],
      '  Friday clinic  '
    )
    let stored = timetableCore.getAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN)
    expect(stored.cells).toEqual([
      { day: 1, period: 1, level: 'cannot' },
      { day: 1, period: 2, level: 'avoid' }
    ])
    expect(stored.note).toBe('Friday clinic')

    stored = timetableCore.saveAvailability(
      db,
      ids.timetableId,
      'teacher',
      ids.teachers.KN,
      [{ day: 2, period: 3, level: 'cannot' }],
      ''
    )
    expect(stored.cells).toEqual([{ day: 2, period: 3, level: 'cannot' }])
    expect(stored.note).toBe(null)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM availability_notes').get().count
    ).toBe(0)
  })

  it('the teacher delete trigger removes their availability rows and note', () => {
    const temporary = Number(
      db
        .prepare('INSERT INTO teachers (code, name) VALUES (?, ?)')
        .run('TMP', 'Dr. Temporary').lastInsertRowid
    )
    timetableCore.saveAvailability(
      db,
      ids.timetableId,
      'teacher',
      temporary,
      [{ day: 1, period: 1, level: 'cannot' }],
      'Temporary'
    )
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM availability WHERE target_id = ?').get(temporary).count
    ).toBe(1)

    db.prepare('DELETE FROM teachers WHERE id = ?').run(temporary)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM availability WHERE target_id = ?').get(temporary).count
    ).toBe(0)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM availability_notes WHERE target_id = ?').get(temporary).count
    ).toBe(0)
  })

  it('availability:summary counts cannot and avoid cells per target', () => {
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 1, period: 1, level: 'cannot' },
      { day: 1, period: 2, level: 'cannot' },
      { day: 5, period: 8, level: 'avoid' }
    ])
    const summary = availabilitySummary(db, ids.timetableId, 'teacher')
    const kn = summary.find((entry) => entry.target_id === ids.teachers.KN)
    expect(kn).toMatchObject({ cannot: 2, avoid: 1, target_type: 'teacher' })
    expect(summary.find((entry) => entry.target_id === ids.teachers.PAG)).toMatchObject({
      cannot: 0,
      avoid: 0
    })
  })

  it('availability:copy copies cells and note between two teachers', () => {
    timetableCore.saveAvailability(
      db,
      ids.timetableId,
      'teacher',
      ids.teachers.KN,
      [
        { day: 1, period: 1, level: 'cannot' },
        { day: 6, period: 4, level: 'avoid' }
      ],
      'Copied request'
    )
    const copied = availabilityCopy(
      db,
      ids.timetableId,
      'teacher',
      ids.teachers.KN,
      'teacher',
      ids.teachers.PAG
    )
    expect(copied.cells).toHaveLength(2)
    expect(copied.note).toBe('Copied request')

    expect(() =>
      availabilityCopy(db, ids.timetableId, 'teacher', ids.teachers.KN, 'venue', ids.venues.B321)
    ).toThrow(/same kind/)
  })

  it('availabilityMatrix reports levels and busy info per target type', () => {
    const saved = timetableCore.saveSlot(db, slotFor(ids), [ids.teachers.KN])
    expect(saved.ok).toBe(true)
    const activity = timetableCore.saveSlot(
      db,
      slotFor(ids, {
        day: 2,
        start_period: 2,
        kind: 'ACTIVITY',
        subject_id: null,
        label: 'Sports',
        venue_id: ids.venues.B101
      }),
      []
    )
    expect(activity.ok).toBe(true)
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 3, period: 5, level: 'avoid' }
    ])

    const teacherMatrix = availabilityMatrix(db, ids.timetableId, 'teacher', ids.teachers.KN)
    const teacherCell = teacherMatrix.find((cell) => cell.day === 1 && cell.period === 1)
    expect(teacherCell.busy).toMatchObject({
      sectionLabel: 'Sem 5-A',
      subjectCode: 'BCS501',
      slotId: saved.id
    })
    expect(teacherMatrix.find((cell) => cell.day === 2 && cell.period === 2).busy).toBe(null)
    expect(teacherMatrix.find((cell) => cell.day === 3 && cell.period === 5).level).toBe('avoid')

    const venueMatrix = availabilityMatrix(db, ids.timetableId, 'venue', ids.venues.B101)
    expect(venueMatrix.find((cell) => cell.day === 2 && cell.period === 2).busy).toMatchObject({
      subjectCode: 'Sports'
    })

    const sectionMatrix = availabilityMatrix(db, ids.timetableId, 'section', ids.sections.A)
    expect(sectionMatrix.find((cell) => cell.day === 1 && cell.period === 1).busy).not.toBe(null)
    expect(sectionMatrix.find((cell) => cell.day === 2 && cell.period === 2).busy).toBe(null)
  })

  it('a merged lecture is shown once in the availability matrix', () => {
    const first = timetableCore.saveSlot(db, slotFor(ids), [ids.teachers.KN])
    const second = slotFor(ids, { section_id: ids.sections.B })
    const joined = timetableCore.joinMergeGroup(db, second, first.id)
    timetableCore.saveSlot(
      db,
      { ...second, merge_group: joined.merge_group, merge_with: first.id },
      [ids.teachers.KN]
    )

    const matrix = availabilityMatrix(db, ids.timetableId, 'teacher', ids.teachers.KN)
    const occupied = matrix.filter((cell) => cell.busy)
    expect(occupied).toHaveLength(1)
    expect(occupied[0].busy.sectionLabel).toMatch(/^Sem 5-[AB]$/)
  })

  it('availability handlers reject a section from another timetable', () => {
    const otherTimetable = Number(
      db.prepare('INSERT INTO timetables (title) VALUES (?)').run('Other').lastInsertRowid
    )
    const otherSection = Number(
      db
        .prepare('INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)')
        .run(otherTimetable, 5, 'Z').lastInsertRowid
    )
    expect(() =>
      availabilityGet(db, ids.timetableId, 'section', otherSection)
    ).toThrow(/does not belong/)
  })

  it('periodsInRange uses the real period times and the 50 percent rule', () => {
    expect(timetableCore.periodsInRange(db, 540, 660)).toEqual([1, 2])
    expect(timetableCore.periodsInRange(db, 840, 1040)).toEqual([5, 6, 7, 8])
    expect(timetableCore.periodsInRange(db, 765, 820)).toEqual([])
    expect(timetableCore.periodsInRange(db, 600, 630)).toEqual([2])
  })
})

describe('whole-timetable validation categories', () => {
  let db
  let ids

  beforeEach(() => {
    const fixture = freshDb()
    db = fixture.db
    ids = fixture.ids
  })

  afterEach(() => {
    db.close()
  })

  it('returns correct counts for clashes, violations, overridden and ignored', () => {
    const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)
    const save = (overrides, teacher) =>
      timetableCore.saveSlot(db, slotFor(ids, overrides), [teacher])

    const first = save({ day: 1, start_period: 1, section_id: ids.sections.A }, ids.teachers.KN)
    const second = save(
      { day: 2, start_period: 1, section_id: ids.sections.B, venue_id: ids.venues.B317 },
      ids.teachers.PAG
    )
    const third = save(
      { day: 3, start_period: 1, section_id: ids.sections.C, venue_id: ids.venues.B101 },
      ids.teachers.ATS
    )
    const fourth = save(
      { day: 4, start_period: 1, section_id: ids.sections.D, venue_id: ids.venues.B317 },
      ids.teachers.VAG
    )

    // Hard request on the first slot, not overridden.
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.KN, [
      { day: 1, period: 1, level: 'cannot' }
    ])
    // Hard section request on the second slot, explicitly overridden.
    timetableCore.saveAvailability(db, ids.timetableId, 'section', ids.sections.B, [
      { day: 2, period: 1, level: 'cannot' }
    ])
    db.prepare('UPDATE slots SET constraint_override = 1 WHERE id = ?').run(second.id)
    // Soft request on the third slot.
    timetableCore.saveAvailability(db, ids.timetableId, 'teacher', ids.teachers.ATS, [
      { day: 3, period: 1, level: 'avoid' }
    ])
    // A real clash against the fourth slot: same teacher, other section/venue.
    const clashId = insert(
      `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id, venue_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ids.sections.C,
      4,
      1,
      1,
      'L',
      ids.subjects.BCS501,
      ids.venues.B101
    )
    insert('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)', clashId, ids.teachers.VAG)

    const report = timetableCore.validateTimetable(db, ids.timetableId)
    expect(report.counts).toEqual({
      clashes: 2,
      violations: 1,
      overridden: 1,
      ignored: 1,
      issues: 3
    })
    expect(report.violations[0].slot_id).toBe(first.id)
    expect(report.overridden[0].slot_id).toBe(second.id)
    expect(report.ignored[0].slot_id).toBe(third.id)
    expect(report.clashes.map((entry) => entry.slot_id).sort()).toEqual(
      [fourth.id, clashId].sort()
    )
    expect(report.violations[0]).toMatchObject({
      section_id: ids.sections.A,
      day: 1,
      start_period: 1
    })
    expect(report.violations[0].message).toContain('not available')
  })
})
