import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'

import {
  slotsCheck,
  slotsJoinMerge,
  slotsMergeCandidates,
  slotsSave
} from '../src/main/slotsApi'

// The real handler functions — ipc.js registers exactly these on the channels
// `slots:save`, `slots:check`, `slots:merge-candidates`, `slots:join-merge`,
// so this test replays precisely what the editor's "Mark as merged lecture"
// click does over IPC: check -> candidates -> join -> re-check -> save.
const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  return db
}

function seedBase(db) {
  const timetableId = Number(
    db
      .prepare("INSERT INTO timetables (title) VALUES ('Students Timetable 2026-27')")
      .run().lastInsertRowid
  )
  const KN = Number(
    db.prepare("INSERT INTO teachers (code, name) VALUES ('KN', 'Ms. Kanchan')")
      .run().lastInsertRowid
  )
  const ROS = Number(
    db.prepare("INSERT INTO teachers (code, name) VALUES ('ROS', 'Mr. Roshaan')")
      .run().lastInsertRowid
  )
  const bcs501 = Number(
    db.prepare("INSERT INTO subjects (code, name) VALUES ('BCS501', 'Software Engineering')")
      .run().lastInsertRowid
  )
  const b321 = Number(
    db.prepare("INSERT INTO venues (code, name, kind) VALUES ('B-321', 'Room 321', 'classroom')")
      .run().lastInsertRowid
  )
  const b101 = Number(
    db.prepare("INSERT INTO venues (code, name, kind) VALUES ('B-101', 'Room 101', 'classroom')")
      .run().lastInsertRowid
  )
  const section = (name) =>
    Number(
      db
        .prepare(
          `INSERT INTO sections (timetable_id, semester, name, default_venue_id)
           VALUES (?, 5, ?, ?)`
        )
        .run(timetableId, name, b321).lastInsertRowid
    )
  return {
    timetableId,
    KN,
    ROS,
    bcs501,
    b321,
    b101,
    secA: section('A'),
    secB: section('B'),
    secC: section('C')
  }
}

const lectureSlot = (sectionId, subjectId, venueId, extra = {}) => ({
  section_id: sectionId,
  day: 1,
  start_period: 3,
  span: 1,
  kind: 'L',
  subject_id: subjectId,
  batch_no: null,
  elective_group: null,
  venue_id: venueId,
  label: null,
  ...extra
})

describe('mark as merged lecture (real IPC handler flow)', () => {
  let db
  let ids

  beforeEach(() => {
    db = freshDb()
    ids = seedBase(db)
    // Section 5-A already has the Monday P3 lecture with KN in B-321.
    ids.slotA = Number(
      slotsSave(db, lectureSlot(ids.secA, ids.bcs501, ids.b321), [ids.KN], null).id
    )
  })

  afterEach(() => {
    db.close()
  })

  it('replays the editor: check -> candidates -> join -> re-check -> save', () => {
    const newSlot = lectureSlot(ids.secB, ids.bcs501, ids.b321)
    const teacherIds = [ids.KN]

    // 1. The first conflict check the editor shows.
    const problems = slotsCheck(db, newSlot, teacherIds, null)
    const withMerge = problems.filter((problem) => problem.merge && problem.merge_timing_ok)
    expect(problems.some((problem) => problem.type === 'teacher'), 'teacher clash').toBe(true)
    expect(problems.some((problem) => problem.type === 'venue'), 'venue clash').toBe(true)
    expect(new Set(withMerge.map((problem) => problem.merge.slot_id))).toEqual(
      new Set([ids.slotA])
    )

    // 2. The merge candidates behind the "Mark as merged lecture" button.
    const candidates = slotsMergeCandidates(db, newSlot, teacherIds, null)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].slot_id).toBe(ids.slotA)
    expect(candidates[0].teachers).toEqual(['KN'])
    expect(candidates[0].teacher_codes).toBe('KN')
    expect(candidates[0].venue_code).toBe('B-321')

    // 3. The join click: adopt teachers + venue, get a group id.
    const joined = slotsJoinMerge(db, newSlot, ids.slotA)
    expect(joined.ok).toBe(true)
    expect(joined.teacher_ids).toEqual([ids.KN])
    expect(joined.venue_id).toBe(ids.b321)
    expect(joined.note).toBe('Teachers and venue copied from the merged lecture')
    expect(String(joined.merge_group)).toBeTruthy()

    const amended = { ...newSlot, merge_group: joined.merge_group, merge_with: ids.slotA }
    const adoptedTeachers = joined.teacher_ids

    // 4. The re-check after the merge click: the partner must be exempt.
    expect(slotsCheck(db, amended, adoptedTeachers, null)).toEqual([])

    // 5. Save: both slots land in one group, grid shows them merged.
    const saved = slotsSave(db, amended, adoptedTeachers, null)
    expect(saved.merge_group).toBe(joined.merge_group)
    const slotA = db.prepare('SELECT * FROM slots WHERE id = ?').get(ids.slotA)
    expect(slotA.merge_group).toBe(joined.merge_group)
  })

  it('after saving, the faculty and venue views show the merged lecture once', () => {
    const newSlot = lectureSlot(ids.secB, ids.bcs501, ids.b321)
    const joined = slotsJoinMerge(db, newSlot, ids.slotA)
    const amended = { ...newSlot, merge_group: joined.merge_group, merge_with: ids.slotA }
    expect(slotsCheck(db, amended, joined.teacher_ids, null)).toEqual([])
    slotsSave(db, amended, joined.teacher_ids, null)

    const facultyRows = timetableCore.facultyTimetable(db, ids.timetableId, ids.KN)
    expect(facultyRows).toHaveLength(1)
    expect(facultyRows[0].merged_sections).toEqual(['5-A', '5-B'])

    const venueRows = timetableCore.venueTimetable(db, ids.timetableId, ids.b321)
    expect(venueRows).toHaveLength(1)
    expect(venueRows[0].merged_sections).toEqual(['5-A', '5-B'])
  })

  it('joins an existing group of two sections as a third member', () => {
    const newB = lectureSlot(ids.secB, ids.bcs501, ids.b321)
    const joined1 = slotsJoinMerge(db, newB, ids.slotA)
    slotsSave(
      db,
      { ...newB, merge_group: joined1.merge_group, merge_with: ids.slotA },
      joined1.teacher_ids,
      null
    )
    const slotB = db
      .prepare('SELECT * FROM slots WHERE section_id = ?')
      .get(ids.secB)

    // A third section joins the same lecture.
    const newC = lectureSlot(ids.secC, ids.bcs501, ids.b321)
    const joined2 = slotsJoinMerge(db, newC, ids.slotA)
    expect(joined2.merge_group).toBe(joined1.merge_group)
    const amended = { ...newC, merge_group: joined2.merge_group, merge_with: ids.slotA }
    expect(slotsCheck(db, amended, joined2.teacher_ids, null)).toEqual([])
    slotsSave(db, amended, joined2.teacher_ids, null)

    const group = db
      .prepare('SELECT id FROM slots WHERE merge_group = ? ORDER BY id')
      .all(joined1.merge_group)
    expect(group).toHaveLength(3)
    expect(slotB.merge_group).toBe(joined1.merge_group)
  })

  it('refuses a merge with a different span and leaves a clear reason', () => {
    const longSlot = Number(
      slotsSave(
        db,
        lectureSlot(ids.secC, ids.bcs501, ids.b321, { start_period: 5, span: 2 }),
        [ids.ROS],
        null
      ).id
    )

    const newSlot = lectureSlot(ids.secB, ids.bcs501, ids.b321, { day: 1, start_period: 6, span: 1 })
    const problems = slotsCheck(db, newSlot, [ids.ROS], null)
    expect(problems.some((problem) => problem.merge_timing_ok === false)).toBe(true)
    expect(problems[0].message).toContain("Can't merge: different timing.")

    let caught
    try {
      slotsJoinMerge(db, newSlot, longSlot)
    } catch (error) {
      caught = error
    }
    expect(caught?.userMessage).toBe("Can't merge: different timing.")
  })

  it('reports two different conflicting slots instead of one mergeable offer', () => {
    // KN is busy in 5-A at that time, but 5-A sits in a different venue.
    slotsSave(
      db,
      { ...lectureSlot(ids.secA, ids.bcs501, ids.b321), venue_id: ids.b101 },
      [ids.KN],
      ids.slotA
    )
    // And B-321 is taken by 5-C with a different teacher.
    const slotC = Number(
      slotsSave(db, lectureSlot(ids.secC, ids.bcs501, ids.b321), [ids.ROS], null).id
    )

    const newSlot = lectureSlot(ids.secB, ids.bcs501, ids.b321)
    const problems = slotsCheck(db, newSlot, [ids.KN], null)
    const candidates = slotsMergeCandidates(db, newSlot, [ids.KN], null)
    // The teacher clash and the venue clash point at two different slots — the
    // UI must not pretend one button fixes everything (merge-offers tests).
    expect(problems.filter((problem) => problem.merge && problem.merge_timing_ok)).toHaveLength(2)
    expect(candidates.map((candidate) => candidate.slot_id).sort()).toEqual(
      [ids.slotA, slotC].sort()
    )
  })

  it('editing the merged time moves every member; deleting one member cleans the group', () => {
    const newB = lectureSlot(ids.secB, ids.bcs501, ids.b321)
    const joined = slotsJoinMerge(db, newB, ids.slotA)
    slotsSave(
      db,
      { ...newB, merge_group: joined.merge_group, merge_with: ids.slotA },
      joined.teacher_ids,
      null
    )
    const slotBId = db.prepare('SELECT id FROM slots WHERE section_id = ?').get(ids.secB).id
    const mergedGroup = joined.merge_group

    // Edit 5-B's slot: the whole group moves to Tue P1.
    expect(
      slotsCheck(
        db,
        { ...newB, day: 2, start_period: 1, merge_group: mergedGroup },
        [ids.KN],
        slotBId
      )
    ).toEqual([])
    slotsSave(db, { ...newB, day: 2, start_period: 1, merge_group: mergedGroup }, [ids.KN], slotBId)
    const both = db.prepare('SELECT day, start_period FROM slots WHERE merge_group = ?').all(mergedGroup)
    expect(both).toHaveLength(2)
    for (const row of both) expect([row.day, row.start_period]).toEqual([2, 1])

    // Delete 5-B's member: 5-A stays but loses the (now single) group id.
    timetableCore.deleteSlot(db, slotBId)
    const slotA = db.prepare('SELECT * FROM slots WHERE id = ?').get(ids.slotA)
    expect(slotA.merge_group).toBeNull()
  })
})
