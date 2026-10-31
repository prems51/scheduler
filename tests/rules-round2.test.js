import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import { batchLabel, sectionCodeLabel, sectionLabel } from '../desktop-shared/labels.js'
import { buildLegend } from '../desktop-shared/legend.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

/** An empty timetable with two teachers, two subjects, three venues and A/B/C. */
function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)

  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)

  const timetableId = insert('INSERT INTO timetables (title) VALUES (?)', 'Test timetable')
  const teachers = {
    KN: insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'KN', 'Ms. Kanchan'),
    PAG: insert('INSERT INTO teachers (code, name) VALUES (?, ?)', 'PAG', 'Ms. Prachi Agarwal')
  }
  const subjects = {
    BCS501: insert(
      'INSERT INTO subjects (code, name) VALUES (?, ?)',
      'BCS501',
      'Database Management System'
    ),
    BCS502: insert('INSERT INTO subjects (code, name) VALUES (?, ?)', 'BCS502', 'Web Technology')
  }
  const venues = {
    'B-321': insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-321', 'classroom'),
    'B-317': insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-317', 'classroom'),
    'B-114': insert('INSERT INTO venues (code, kind) VALUES (?, ?)', 'B-114', 'lab')
  }
  const sections = {}
  for (const name of ['A', 'B', 'C']) {
    sections[name] = insert(
      'INSERT INTO sections (timetable_id, semester, name) VALUES (?, ?, ?)',
      timetableId,
      5,
      name
    )
  }

  return { db, ids: { timetableId, teachers, subjects, venues, sections } }
}

describe('merged lectures', () => {
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

  const lecture = (overrides = {}) => ({
    section_id: ids.sections.B,
    day: 1,
    start_period: 1,
    span: 1,
    kind: 'L',
    subject_id: ids.subjects.BCS501,
    batch_no: null,
    elective_group: null,
    venue_id: ids.venues['B-321'],
    label: null,
    merge_group: null,
    ...overrides
  })

  /** Section A gets the class first; section B tries to use the same one. */
  function conflictingSetup(secondOverrides = {}) {
    const first = timetableCore.saveSlot(
      db,
      lecture({ section_id: ids.sections.A }),
      [ids.teachers.KN]
    )
    expect(first.ok).toBe(true)

    const second = lecture(secondOverrides)
    return { firstId: first.id, second }
  }

  it('rejects the same teacher and venue in another section without a merge', () => {
    const { second } = conflictingSetup()
    const result = timetableCore.saveSlot(db, second, [ids.teachers.KN])

    expect(result.ok).toBe(false)
    const types = result.problems.map((problem) => problem.type)
    expect(types).toContain('teacher')
    expect(types).toContain('venue')
  })

  it('offers exactly the conflicting slot as a merge candidate', () => {
    const { firstId, second } = conflictingSetup()
    const candidates = timetableCore.findMergeCandidates(db, second, [ids.teachers.KN])

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      slot_id: firstId,
      section: 'Sem 5-A',
      subject_code: 'BCS501',
      teacher_codes: 'KN',
      venue_code: 'B-321'
    })
    expect(candidates[0].label).toBe('Mark as merged lecture with Sem 5-A (BCS501, KN, B-321)')
  })

  it("refuses to merge slots whose timing only partly overlaps", () => {
    const { firstId, second } = conflictingSetup({ span: 2 })
    const candidates = timetableCore.findMergeCandidates(db, second, [ids.teachers.KN])

    expect(candidates).toEqual([])
    const teacherProblem = timetableCore
      .checkConflicts(db, second, [ids.teachers.KN])
      .find((problem) => problem.type === 'teacher')
    expect(teacherProblem.message).toContain("Can't merge: different timing.")

    const join = timetableCore.joinMergeGroup(db, second, firstId)
    expect(join.ok).toBe(false)
    expect(join.problems[0].message).toContain("Can't merge: different timing.")
  })

  it('accepts both slots once they are in the same merge group', () => {
    const { firstId, second } = conflictingSetup()
    const join = timetableCore.joinMergeGroup(db, second, firstId)

    expect(join.ok).toBe(true)
    expect(join.teacher_ids).toEqual([ids.teachers.KN])
    expect(join.venue_id).toBe(ids.venues['B-321'])
    expect(join.note).toBe('Teachers and venue copied from the merged lecture')

    const saved = timetableCore.saveSlot(
      db,
      {
        ...second,
        merge_group: join.merge_group,
        merge_with: firstId,
        // The editor copies these from the merged lecture.
        venue_id: join.venue_id,
        batch_no: null,
        subject_id: ids.subjects.BCS502
      },
      [ids.teachers.KN]
    )

    expect(saved.ok).toBe(true)
    const rows = db
      .prepare('SELECT id, merge_group, subject_id FROM slots ORDER BY id')
      .all()
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.merge_group === join.merge_group)).toBe(true)
    // The per-section subject stays different.
    expect(rows[0].subject_id).toBe(ids.subjects.BCS501)
    expect(rows[1].subject_id).toBe(ids.subjects.BCS502)
  })

  function mergedPair() {
    const { firstId, second } = conflictingSetup()
    const join = timetableCore.joinMergeGroup(db, second, firstId)
    const saved = timetableCore.saveSlot(
      db,
      { ...second, merge_group: join.merge_group, merge_with: firstId, venue_id: join.venue_id },
      [ids.teachers.KN]
    )
    expect(saved.ok).toBe(true)
    return { group: join.merge_group, firstId, secondId: saved.id }
  }

  it('moves every member when one member changes its time', () => {
    const { group, firstId, secondId } = mergedPair()

    const payload = db.prepare('SELECT * FROM slots WHERE id = ?').get(secondId)
    const moved = timetableCore.saveSlot(
      db,
      { ...payload, day: 2, start_period: 4, merge_group: group },
      [ids.teachers.KN],
      secondId
    )

    expect(moved.ok).toBe(true)
    const rows = db.prepare('SELECT id, day, start_period FROM slots').all()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.day).toBe(2)
      expect(row.start_period).toBe(4)
    }
    expect(timetableCore.mergePartners(db, firstId)).toEqual([
      expect.objectContaining({ slot_id: secondId, section: '5-B' })
    ])
  })

  it('blocks the whole edit and names the section that would clash', () => {
    const { group, secondId } = mergedPair()

    // A third section already has KN at Tue P6.
    const blocker = timetableCore.saveSlot(
      db,
      lecture({
        section_id: ids.sections.C,
        day: 2,
        start_period: 6,
        venue_id: ids.venues['B-317'],
        subject_id: ids.subjects.BCS502
      }),
      [ids.teachers.KN]
    )
    expect(blocker.ok).toBe(true)

    const payload = db.prepare('SELECT * FROM slots WHERE id = ?').get(secondId)
    const moved = timetableCore.saveSlot(
      db,
      { ...payload, day: 2, start_period: 6, merge_group: group },
      [ids.teachers.KN],
      secondId
    )

    expect(moved.ok).toBe(false)
    const messages = moved.problems.map((problem) => problem.message)
    expect(messages.some((message) => message.startsWith('Sem 5-A:'))).toBe(true)
    expect(messages.some((message) => message.startsWith('Sem 5-B:'))).toBe(true)

    // Nothing moved.
    const rows = db.prepare('SELECT day, start_period FROM slots WHERE merge_group = ?').all(group)
    expect(rows).toEqual([{ day: 1, start_period: 1 }, { day: 1, start_period: 1 }])
  })

  it('deletes only one member and clears the group when it is alone', () => {
    const { group, firstId, secondId } = mergedPair()
    const result = timetableCore.deleteSlot(db, firstId)

    expect(result).toMatchObject({ id: firstId, merge_group: group, remaining: 1 })
    const survivor = db.prepare('SELECT * FROM slots WHERE id = ?').get(secondId)
    expect(survivor.merge_group).toBeNull()
  })

  it('detaches one section only when it passes the normal check on its own', () => {
    const { group, secondId } = mergedPair()
    const payload = db.prepare('SELECT * FROM slots WHERE id = ?').get(secondId)

    // With the group's own teacher and venue it still clashes: rejected.
    const blocked = timetableCore.saveSlot(
      db,
      { ...payload, merge_group: null, detach: true },
      [ids.teachers.KN],
      secondId
    )
    expect(blocked.ok).toBe(false)
    expect(db.prepare('SELECT merge_group FROM slots WHERE id = ?').get(secondId).merge_group).toBe(
      group
    )

    // With its own teacher and venue it is fine.
    const detached = timetableCore.saveSlot(
      db,
      { ...payload, merge_group: null, detach: true, venue_id: ids.venues['B-317'] },
      [ids.teachers.PAG],
      secondId
    )
    expect(detached.ok).toBe(true)
    expect(db.prepare('SELECT merge_group FROM slots WHERE id = ?').get(secondId).merge_group).toBeNull()
  })

  it('shows and counts a merged lecture once in the generated views', () => {
    const { group } = mergedPair()
    expect(group).toBeTruthy()

    const faculty = timetableCore.facultyTimetable(db, ids.timetableId, ids.teachers.KN)
    expect(faculty).toHaveLength(1)
    expect(faculty[0]).toMatchObject({
      merged_label: '5-A + 5-B',
      subject_code: 'BCS501',
      teacher_codes: 'KN'
    })

    const summary = timetableCore.viewsSummary(db, ids.timetableId)
    expect(summary.teachers.find((teacher) => teacher.code === 'KN').periods).toBe(1)

    const venue = timetableCore.venueTimetable(db, ids.timetableId, ids.venues['B-321'])
    expect(venue).toHaveLength(1)
    expect(venue[0].merged_label).toBe('5-A + 5-B')

    const legend = buildLegend(venue, {
      teachers: [
        { id: ids.teachers.KN, code: 'KN', name: 'Ms. Kanchan' },
        { id: ids.teachers.PAG, code: 'PAG', name: 'Ms. Prachi Agarwal' }
      ]
    })
    expect(legend).toEqual([
      {
        code: 'BCS501',
        name: 'Database Management System',
        teachers: 'KN',
        teacherNames: 'Ms. Kanchan'
      }
    ])
  })
})

describe('activities', () => {
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

  const classSlot = (overrides = {}) => ({
    section_id: ids.sections.A,
    day: 1,
    start_period: 1,
    span: 1,
    kind: 'L',
    subject_id: ids.subjects.BCS501,
    batch_no: null,
    elective_group: null,
    venue_id: ids.venues['B-321'],
    label: null,
    merge_group: null,
    ...overrides
  })

  const activity = (overrides = {}) => ({
    section_id: ids.sections.A,
    day: 1,
    start_period: 1,
    span: 1,
    kind: 'ACTIVITY',
    subject_id: null,
    batch_no: null,
    elective_group: null,
    venue_id: null,
    label: 'SUPER - 30',
    merge_group: null,
    ...overrides
  })

  it('lets an activity run at the same time as a whole-section lecture', () => {
    expect(timetableCore.saveSlot(db, classSlot(), [ids.teachers.KN]).ok).toBe(true)
    const result = timetableCore.saveSlot(db, activity(), [])
    expect(result.ok).toBe(true)
  })

  it('lets a lecture be placed over an existing activity', () => {
    expect(timetableCore.saveSlot(db, activity(), []).ok).toBe(true)
    const result = timetableCore.saveSlot(db, classSlot(), [ids.teachers.KN])
    expect(result.ok).toBe(true)
  })

  it('lets an activity run while both batches have tutorials', () => {
    const b1 = timetableCore.saveSlot(
      db,
      classSlot({ kind: 'T', batch_no: 1, venue_id: ids.venues['B-317'] }),
      [ids.teachers.KN]
    )
    const b2 = timetableCore.saveSlot(
      db,
      classSlot({ kind: 'T', batch_no: 2, subject_id: ids.subjects.BCS502 }),
      [ids.teachers.PAG]
    )
    expect(b1.ok && b2.ok).toBe(true)

    const result = timetableCore.saveSlot(db, activity({ span: 2 }), [])
    expect(result.ok).toBe(true)
  })

  it('still rejects two overlapping activities of the same section', () => {
    expect(timetableCore.saveSlot(db, activity(), []).ok).toBe(true)
    const result = timetableCore.saveSlot(db, activity({ label: 'Sports' }), [])

    expect(result.ok).toBe(false)
    expect(result.problems[0].type).toBe('section')
    expect(result.problems[0].message).toContain('activity')
  })

  it('puts an activity with a venue into the venue clash check', () => {
    const other = classSlot({ section_id: ids.sections.B, venue_id: ids.venues['B-321'] })
    expect(timetableCore.saveSlot(db, other, [ids.teachers.PAG]).ok).toBe(true)

    const result = timetableCore.saveSlot(db, activity({ venue_id: ids.venues['B-321'] }), [])
    expect(result.ok).toBe(false)
    expect(result.problems.map((problem) => problem.type)).toContain('venue')
  })

  it('never reports a venue clash for an activity without a venue', () => {
    const other = classSlot({ section_id: ids.sections.B, venue_id: ids.venues['B-321'] })
    expect(timetableCore.saveSlot(db, other, [ids.teachers.PAG]).ok).toBe(true)

    const result = timetableCore.saveSlot(db, activity({ venue_id: null }), [])
    expect(result.ok).toBe(true)
  })

  it('shows the venue under the activity and lists it in that venue', () => {
    const saved = timetableCore.saveSlot(
      db,
      activity({ venue_id: ids.venues['B-114'], label: 'Sports' }),
      []
    )
    expect(saved.ok).toBe(true)

    const rows = timetableCore.venueTimetable(db, ids.timetableId, ids.venues['B-114'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'ACTIVITY', label: 'Sports', venue_code: 'B-114' })
  })
})

describe('batch numbers', () => {
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

  const slot = (overrides = {}) => ({
    section_id: ids.sections.A,
    day: 3,
    start_period: 2,
    span: 1,
    kind: 'P',
    subject_id: ids.subjects.BCS501,
    batch_no: null,
    elective_group: null,
    venue_id: ids.venues['B-114'],
    label: null,
    merge_group: null,
    ...overrides
  })

  it('lets batch 1 and batch 2 run in parallel and rejects a whole-section clash', () => {
    expect(timetableCore.saveSlot(db, slot({ batch_no: 1 }), [ids.teachers.KN]).ok).toBe(true)
    expect(
      timetableCore.saveSlot(
        db,
        slot({ batch_no: 2, venue_id: ids.venues['B-317'], subject_id: ids.subjects.BCS502 }),
        [ids.teachers.PAG]
      ).ok
    ).toBe(true)

    const whole = timetableCore.saveSlot(db, slot({ venue_id: ids.venues['B-317'] }), [
      ids.teachers.PAG
    ])
    expect(whole.ok).toBe(false)
    expect(whole.problems.map((problem) => problem.type)).toContain('section')
  })

  it('derives the label from the section', () => {
    expect(batchLabel('A', 1)).toBe('A1')
    expect(batchLabel('B', 2)).toBe('B2')
    expect(batchLabel('C', null)).toBe('C')
    expect(sectionCodeLabel(5, 'A', 2)).toBe('5-A2')
    expect(sectionLabel(5, 'A', 1)).toBe('Sem 5 - A1')
    expect(sectionLabel(5, 'A', null)).toBe('Sem 5-A')
  })
})
