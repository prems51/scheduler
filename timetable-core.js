// timetable-core.js — the conflict engine. Runs in Electron's MAIN process
// (better-sqlite3) and in the tests; the renderer reaches it through IPC only.
//
// Round-2 rules implemented here:
//   * merged lectures (slots.merge_group): one real-world class, several
//     sections; never a teacher/venue clash inside the group, and time/venue/
//     teachers are edited for every member at once
//   * batch numbers (batch_no 1/2) with labels derived from the section
//   * activities may hold a venue, never clash with a class of their section,
//     and never change the section/batch rules for real classes

import { randomUUID } from 'node:crypto'
import { sectionLabel } from './desktop-shared/labels.js'

const LUNCH_AFTER = 4 // periods 1-4 are morning, 5-8 afternoon; a lab cannot span lunch
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------- small helpers ----------

function kindOf(row) {
  return String(row?.kind ?? 'L').toUpperCase()
}

function isActivity(row) {
  return kindOf(row) === 'ACTIVITY'
}

/** Same day, same start period and same length: the only timing a merge allows. */
export function sameTiming(a, b) {
  return (
    Number(a.day) === Number(b.day) &&
    Number(a.start_period) === Number(b.start_period) &&
    Number(a.span ?? 1) === Number(b.span ?? 1)
  )
}

function normalizeBatch(value) {
  const number = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(number)
    ? null
    : number
}

function parseIds(value) {
  return String(value ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
}

function periodRangeLabel(day, startPeriod, span) {
  const end = startPeriod + span - 1
  return `${DAY_NAMES[day]} P${startPeriod}${end > startPeriod ? `–P${end}` : ''}`
}

function teacherIdsOf(db, slotId) {
  return db
    .prepare('SELECT teacher_id FROM slot_teachers WHERE slot_id = ? ORDER BY teacher_id')
    .all(slotId)
    .map((row) => row.teacher_id)
}

function teachersOf(db, ids = []) {
  if (!ids.length) return []
  const statement = db.prepare('SELECT id, code, name FROM teachers WHERE id = ?')
  return ids.map((id) => statement.get(id)).filter(Boolean)
}

/** The "Mark as merged lecture with …" description of a conflicting slot. */
function mergeCandidate(row, teacherCodes) {
  const codes = parseIds(row.teacher_ids)
    .map((id) => teacherCodes.get(Number(id)))
    .filter(Boolean)
  const section = sectionLabel(row.semester, row.section_name, row.batch_no)
  const inside = [row.what, codes.join('/') || 'no teacher', row.venue_code]
    .filter(Boolean)
    .join(', ')
  return {
    slot_id: row.id,
    section_id: row.section_id,
    section,
    semester: row.semester,
    section_name: row.section_name,
    batch_no: row.batch_no ?? null,
    subject_code: row.what,
    teachers: codes,
    teacher_codes: codes.join('/'),
    venue_code: row.venue_code ?? null,
    merge_group: row.merge_group ?? null,
    label: `Mark as merged lecture with ${section} (${inside})`
  }
}

/** Everything that overlaps this slot in the same timetable. */
function overlappingSlots(db, slot, ignoreSlotId = null) {
  const end = Number(slot.start_period) + Number(slot.span ?? 1)
  const { timetable_id: timetableId } = db
    .prepare('SELECT timetable_id FROM sections WHERE id = ?')
    .get(slot.section_id)
  return db
    .prepare(
      `SELECT s.id, s.section_id, s.day, s.start_period, s.span, s.kind, s.batch_no,
              s.elective_group, s.venue_id, s.merge_group,
              sec.semester, sec.name AS section_name,
              COALESCE(sub.code, s.label) AS what, v.code AS venue_code,
              (SELECT GROUP_CONCAT(st.teacher_id) FROM slot_teachers st WHERE st.slot_id = s.id) AS teacher_ids
       FROM slots s
       JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN venues v ON v.id = s.venue_id
       WHERE sec.timetable_id = ? AND s.day = ? AND s.id != ?
         AND s.start_period < ? AND s.start_period + s.span > ?
       ORDER BY s.start_period, s.id`
    )
    .all(timetableId, slot.day, ignoreSlotId ?? -1, end, slot.start_period)
}

/**
 * slot = { section_id, day, start_period, span, kind, subject_id, batch_no,
 *          elective_group, venue_id, label, merge_group }
 * teacherIds = [1, 2]
 * Returns [] when OK, otherwise [{ type, message, merge?, merge_timing_ok? }].
 */
export function checkConflicts(db, slot, teacherIds = [], ignoreSlotId = null, extraIgnoreIds = []) {
  const problems = []
  const skip = new Set([Number(ignoreSlotId ?? -1), ...extraIgnoreIds.map(Number)])

  // A slot being merged with an existing one must not clash with that partner
  // (or the partner's group): the partner typically still has merge_group NULL
  // because the group only comes into being on Save, so equality on
  // merge_group alone exempts nothing in the editor's live re-check.
  if (slot.merge_with) {
    const target = db
      .prepare('SELECT id, merge_group FROM slots WHERE id = ?')
      .get(Number(slot.merge_with))
    if (target) {
      skip.add(Number(target.id))
      if (target.merge_group) {
        for (const member of db
          .prepare('SELECT id FROM slots WHERE merge_group = ?')
          .all(target.merge_group)) {
          skip.add(Number(member.id))
        }
      }
    }
  }

  const start = Number(slot.start_period)
  const span = Number(slot.span ?? 1)
  const end = start + span // exclusive

  // 1. Shape checks
  if (start <= LUNCH_AFTER && end - 1 > LUNCH_AFTER) {
    problems.push({ type: 'lunch', message: 'This slot runs across the lunch break.' })
  }
  if (end - 1 > 8) {
    problems.push({ type: 'range', message: 'This slot goes past the last period.' })
  }

  const teacherCodes = new Map(
    db
      .prepare('SELECT id, code FROM teachers')
      .all()
      .map((teacher) => [Number(teacher.id), teacher.code])
  )

  for (const other of overlappingSlots(db, slot, ignoreSlotId)) {
    if (skip.has(other.id)) continue
    // Members of one merged lecture are the same real-world class.
    if (slot.merge_group && other.merge_group === slot.merge_group) continue

    const exactTiming = sameTiming(slot, other)
    const timingNote = exactTiming ? '' : " Can't merge: different timing."
    const merge = exactTiming ? mergeCandidate(other, teacherCodes) : null
    const where = `${DAY_NAMES[other.day]} P${other.start_period} (${other.what}, ${sectionLabel(
      other.semester,
      other.section_name,
      other.batch_no
    )})`

    // Teacher clash
    const theirTeachers = parseIds(other.teacher_ids)
    const mine = teacherIds.map(Number).filter((id) => theirTeachers.includes(id))
    if (mine.length) {
      problems.push({
        type: 'teacher',
        message: `Teacher ${mine
          .map((id) => teacherCodes.get(id))
          .join('/')} is already busy: ${where}.${timingNote}`,
        merge,
        merge_timing_ok: exactTiming
      })
    }

    // Venue clash (activities take part when they have a venue)
    if (slot.venue_id && other.venue_id === slot.venue_id) {
      problems.push({
        type: 'venue',
        message: `Venue ${other.venue_code} is already taken: ${where}.${timingNote}`,
        merge,
        merge_timing_ok: exactTiming
      })
    }

    // Section / batch clash
    if (Number(other.section_id) === Number(slot.section_id)) {
      const bothActivities = isActivity(slot) && isActivity(other)
      const oneActivity = isActivity(slot) !== isActivity(other)
      if (bothActivities) {
        problems.push({
          type: 'section',
          message: `This section already has an activity at that time: ${where}.`
        })
      } else if (!oneActivity) {
        const batchesOverlap =
          !slot.batch_no || !other.batch_no || Number(slot.batch_no) === Number(other.batch_no)
        const sameElectiveGroup = slot.elective_group && slot.elective_group === other.elective_group
        if (batchesOverlap && !sameElectiveGroup) {
          problems.push({
            type: 'section',
            message: `This section already has a class: ${where}.`
          })
        }
      }
    }
  }

  return problems
}

/** The conflicting slots this one could merge with (exact same timing only). */
export function findMergeCandidates(db, slot, teacherIds = [], ignoreSlotId = null) {
  const problems = checkConflicts(db, slot, teacherIds, ignoreSlotId)
  const bySlot = new Map()
  for (const problem of problems) {
    if (problem.merge) bySlot.set(problem.merge.slot_id, problem.merge)
  }
  return [...bySlot.values()]
}

// ---------- writing ----------

const SLOT_COLUMNS = [
  'section_id',
  'day',
  'start_period',
  'span',
  'kind',
  'subject_id',
  'batch_no',
  'elective_group',
  'venue_id',
  'label',
  'merge_group'
]

function writeSlot(db, slot, teacherIds, slotId) {
  const values = SLOT_COLUMNS.map((column) => slot[column] ?? null)
  let id = slotId
  if (id) {
    db.prepare(`UPDATE slots SET ${SLOT_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...values,
      id
    )
  } else {
    id = Number(
      db
        .prepare(
          `INSERT INTO slots (${SLOT_COLUMNS.join(', ')}) VALUES (${SLOT_COLUMNS.map(() => '?').join(', ')})`
        )
        .run(...values).lastInsertRowid
    )
  }
  db.prepare('DELETE FROM slot_teachers WHERE slot_id = ?').run(id)
  const insert = db.prepare('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)')
  for (const teacherId of teacherIds) insert.run(id, teacherId)
  return Number(id)
}

function replaceTeachers(db, slotId, teacherIds) {
  db.prepare('DELETE FROM slot_teachers WHERE slot_id = ?').run(slotId)
  const insert = db.prepare('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)')
  for (const teacherId of teacherIds) insert.run(slotId, teacherId)
}

/** A one-member group is not a group: keep the data clean after a delete/detach. */
function cleanupGroup(db, groupId) {
  if (!groupId) return
  const left = db.prepare('SELECT id FROM slots WHERE merge_group = ?').all(groupId)
  if (left.length <= 1) {
    db.prepare('UPDATE slots SET merge_group = NULL WHERE merge_group = ?').run(groupId)
  }
}

function groupMembers(db, groupId) {
  return db
    .prepare(
      `SELECT s.id, s.section_id, s.day, s.start_period, s.span, s.kind, s.subject_id,
              s.batch_no, s.elective_group, s.venue_id, s.label, s.merge_group,
              sec.semester, sec.name AS section_name
       FROM slots s
       JOIN sections sec ON sec.id = s.section_id
       WHERE s.merge_group = ?
       ORDER BY s.id`
    )
    .all(groupId)
}

function saveSingle(db, slot, teacherIds, slotId, detachFrom = null) {
  const problems = checkConflicts(db, { ...slot, merge_group: null }, teacherIds, slotId)
  if (problems.length) return { ok: false, problems }

  const tx = db.transaction(() => {
    const id = writeSlot(db, { ...slot, merge_group: null }, teacherIds, slotId)
    if (detachFrom) cleanupGroup(db, detachFrom)
    return id
  })
  return { ok: true, problems: [], id: Number(tx()) }
}

/**
 * Saves one member of a merged lecture. Day, start period, span, venue and the
 * teacher set are shared: editing them on any member moves the whole group,
 * after every member has been checked against everything outside the group.
 */
function saveMergedGroup(db, slot, teacherIds, slotId) {
  const groupId = slot.merge_group
  const members = groupMembers(db, groupId).filter((member) => member.id !== slotId)
  const mergeWith = Number(slot.merge_with) || null

  if (!members.length && !mergeWith) {
    return {
      ok: false,
      problems: [
        {
          type: 'merge',
          message:
            'A merged lecture needs at least two sections. Pick a conflicting slot to merge with.'
        }
      ]
    }
  }

  const shared = {
    day: Number(slot.day),
    start_period: Number(slot.start_period),
    span: Number(slot.span ?? 1),
    venue_id: slot.venue_id ?? null
  }

  // The very first merge: the candidate has no group yet, so it must be
  // ignored explicitly or its own teacher/venue would look like a clash.
  const ignore = [...(mergeWith ? [mergeWith] : []), ...(slotId ? [slotId] : [])]
  const ownSection = db
    .prepare('SELECT semester, name FROM sections WHERE id = ?')
    .get(slot.section_id)
  const ownLabel = ownSection
    ? sectionLabel(ownSection.semester, ownSection.name, slot.batch_no)
    : 'This section'
  const problems = checkConflicts(
    db,
    { ...slot, merge_group: groupId },
    teacherIds,
    slotId,
    ignore
  ).map((problem) => ({ ...problem, message: `${ownLabel}: ${problem.message}`, member: ownLabel }))

  for (const member of members) {
    const candidate = {
      ...member,
      ...shared,
      kind: member.kind,
      subject_id: member.subject_id,
      batch_no: member.batch_no,
      elective_group: member.elective_group,
      label: member.label,
      merge_group: groupId
    }
    const found = checkConflicts(db, candidate, teacherIds, member.id, ignore)
    const where = sectionLabel(member.semester, member.section_name, member.batch_no)
    for (const problem of found) {
      problems.push({ ...problem, message: `${where}: ${problem.message}`, member: where })
    }
  }

  if (problems.length) return { ok: false, problems }

  const tx = db.transaction(() => {
    const id = writeSlot(db, { ...slot, merge_group: groupId }, teacherIds, slotId)
    const update = db.prepare(
      'UPDATE slots SET day = ?, start_period = ?, span = ?, venue_id = ? WHERE id = ?'
    )
    for (const member of members) {
      update.run(shared.day, shared.start_period, shared.span, shared.venue_id, member.id)
      replaceTeachers(db, member.id, teacherIds)
    }
    // First merge: the slot we merged with joins the new group too.
    if (mergeWith && !members.some((member) => member.id === mergeWith)) {
      db.prepare('UPDATE slots SET merge_group = ? WHERE id = ?').run(groupId, mergeWith)
    }
    return id
  })

  return { ok: true, problems: [], id: Number(tx()), merge_group: groupId }
}

/**
 * Validates, then inserts or updates. Returns { ok, problems, id, merge_group? }.
 * `slot.detach = true` removes this section from its merged lecture in the same
 * save, and only when it passes the normal conflict check on its own.
 */
export function saveSlot(db, slot, teacherIds = [], slotId = null) {
  if (slotId && !db.prepare('SELECT id FROM slots WHERE id = ?').get(slotId)) {
    return { ok: false, problems: [{ type: 'section', message: 'That slot no longer exists.' }] }
  }
  const existing = slotId ? db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) : null
  const detach = Boolean(slot.detach)
  const payload = { ...slot, batch_no: normalizeBatch(slot.batch_no) }

  if (detach) {
    return saveSingle(db, payload, teacherIds, slotId, existing?.merge_group ?? null)
  }

  const groupId = payload.merge_group ?? existing?.merge_group ?? null
  if (groupId) return saveMergedGroup(db, { ...payload, merge_group: groupId }, teacherIds, slotId)
  return saveSingle(db, { ...payload, merge_group: null }, teacherIds, slotId)
}

/**
 * Deletes one section's slot. Other sections of a merged lecture stay; a group
 * left with a single member loses its group id.
 */
export function deleteSlot(db, slotId) {
  const row = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId)
  if (!row) return { id: slotId, merge_group: null, remaining: 0 }

  let remaining = 0
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM slots WHERE id = ?').run(slotId)
    if (row.merge_group) {
      remaining = db
        .prepare('SELECT COUNT(*) AS count FROM slots WHERE merge_group = ?')
        .get(row.merge_group).count
      cleanupGroup(db, row.merge_group)
    }
  })
  tx()

  return { id: slotId, merge_group: row.merge_group ?? null, remaining }
}

/**
 * What the editor needs when the user clicks "Mark as merged lecture": the
 * existing slot's teachers and venue, and the group id the new slot joins.
 * Nothing is written yet — Save does that, with slot.merge_with.
 */
export function joinMergeGroup(db, slot, candidateSlotId) {
  const candidate = db
    .prepare(
      `SELECT s.id, s.section_id, s.day, s.start_period, s.span, s.kind, s.merge_group,
              s.venue_id, s.batch_no, sec.semester, sec.name AS section_name,
              COALESCE(sub.code, s.label) AS what, v.code AS venue_code
       FROM slots s
       JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN venues v ON v.id = s.venue_id
       WHERE s.id = ?`
    )
    .get(Number(candidateSlotId))

  if (!candidate) {
    return { ok: false, problems: [{ type: 'merge', message: 'That slot no longer exists.' }] }
  }
  if (Number(candidate.section_id) === Number(slot.section_id)) {
    return {
      ok: false,
      problems: [{ type: 'merge', message: 'A section cannot be merged with itself.' }]
    }
  }
  if (!sameTiming(slot, candidate)) {
    return { ok: false, problems: [{ type: 'merge', message: "Can't merge: different timing." }] }
  }

  const teacherIds = teacherIdsOf(db, candidate.id)
  return {
    ok: true,
    merge_group: candidate.merge_group || randomUUID(),
    venue_id: candidate.venue_id ?? null,
    venue_code: candidate.venue_code ?? null,
    teacher_ids: teacherIds,
    teachers: teachersOf(db, teacherIds),
    note: 'Teachers and venue copied from the merged lecture',
    candidate: {
      slot_id: candidate.id,
      section: sectionLabel(candidate.semester, candidate.section_name, candidate.batch_no),
      section_code: `${candidate.semester}-${candidate.section_name}`,
      subject_code: candidate.what
    }
  }
}

/** The other sections of the same merged lecture, for the editor's chips. */
export function mergePartners(db, slotId) {
  const row = db.prepare('SELECT merge_group FROM slots WHERE id = ?').get(slotId)
  if (!row?.merge_group) return []
  return groupMembers(db, row.merge_group)
    .filter((member) => member.id !== slotId)
    .map((member) => ({
      slot_id: member.id,
      section: `${member.semester}-${member.section_name}`,
      section_label: sectionLabel(member.semester, member.section_name, member.batch_no)
    }))
}

// ---------- Generated views: same query shape, different filter ----------
const VIEW_SQL = `
  SELECT s.id, s.day, s.start_period, s.span, s.kind, s.batch_no, s.elective_group, s.label,
         s.subject_id, s.venue_id, s.merge_group, sec.id AS section_id,
         sub.code AS subject_code, sub.name AS subject_name,
         v.code AS venue_code,
         sec.semester, sec.name AS section_name,
         (SELECT GROUP_CONCAT(t.code, '/') FROM slot_teachers st JOIN teachers t ON t.id = st.teacher_id WHERE st.slot_id = s.id) AS teacher_codes,
         (SELECT GROUP_CONCAT(st.teacher_id) FROM slot_teachers st WHERE st.slot_id = s.id) AS teacher_id_list
  FROM slots s
  JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN subjects sub ON sub.id = s.subject_id
  LEFT JOIN venues v ON v.id = s.venue_id
`

function shapeViewRow(row) {
  const { teacher_id_list: teacherIdList, ...rest } = row
  return { ...rest, teacher_ids: parseIds(teacherIdList) }
}

/**
 * Collapses a merged lecture into one row for the faculty/venue views: the
 * sections are listed together and differing subject codes are joined, so the
 * lecture is drawn and counted once.
 */
function collapseMerged(rows) {
  const out = []
  const indexOfGroup = new Map()

  for (const row of rows) {
    if (!row.merge_group) {
      out.push({ ...shapeViewRow(row) })
      continue
    }
    if (!indexOfGroup.has(row.merge_group)) {
      indexOfGroup.set(row.merge_group, out.length)
      out.push({
        ...shapeViewRow(row),
        merged_sections: [],
        merged_codes: [],
        merged_names: []
      })
    }
    const target = out[indexOfGroup.get(row.merge_group)]
    const section = `${row.semester}-${row.section_name}`
    if (!target.merged_sections.includes(section)) target.merged_sections.push(section)
    if (row.subject_code && !target.merged_codes.includes(row.subject_code)) {
      target.merged_codes.push(row.subject_code)
    }
    if (row.subject_name && !target.merged_names.includes(row.subject_name)) {
      target.merged_names.push(row.subject_name)
    }
  }

  return out.map((row) => {
    if (!row.merged_sections) return row
    const { merged_codes: codes, merged_names: names, merged_sections: sections, ...rest } = row
    const sorted = [...sections].sort()
    return {
      ...rest,
      merged_sections: sorted,
      merged_label: sorted.join(' + '),
      subject_code: codes.join(' / '),
      subject_name: names.join(' / ')
    }
  })
}

export function sectionTimetable(db, sectionId) {
  return db
    .prepare(`${VIEW_SQL} WHERE s.section_id = ? ORDER BY s.day, s.start_period`)
    .all(sectionId)
    .map(shapeViewRow)
}

/**
 * Section slots exactly as the renderer receives them: one row per slot, with
 * teacher ids/codes and — for a merged lecture — the other sections' labels.
 */
export function sectionSlots(db, sectionId) {
  const rows = sectionTimetable(db, sectionId)
  const teacherStmt = db.prepare(`
    SELECT t.id, t.code
    FROM slot_teachers st
    JOIN teachers t ON t.id = st.teacher_id
    WHERE st.slot_id = ?
    ORDER BY t.code
  `)

  const groups = [...new Set(rows.map((row) => row.merge_group).filter(Boolean))]
  const partners = new Map()
  if (groups.length) {
    const placeholders = groups.map(() => '?').join(', ')
    const mates = db
      .prepare(
        `SELECT s.id, s.merge_group, sec.semester, sec.name
         FROM slots s
         JOIN sections sec ON sec.id = s.section_id
         WHERE s.merge_group IN (${placeholders})`
      )
      .all(...groups)
    for (const mate of mates) {
      if (!partners.has(mate.merge_group)) partners.set(mate.merge_group, [])
      partners.get(mate.merge_group).push(mate)
    }
  }

  return rows.map((row) => {
    const teachers = teacherStmt.all(row.id)
    const others = (partners.get(row.merge_group) ?? [])
      .filter((mate) => mate.id !== row.id)
      .map((mate) => ({ slot_id: mate.id, section: `${mate.semester}-${mate.name}` }))
      .sort((a, b) => a.section.localeCompare(b.section))
    return {
      ...row,
      teacher_ids: teachers.map((teacher) => teacher.id),
      teacher_codes: teachers.map((teacher) => teacher.code).join('/') || null,
      merge_partners: others,
      merge_label: others.length
        ? `Merged: ${others.map((other) => other.section).join(', ')}`
        : null
    }
  })
}

/**
 * Who is already busy if a class runs on this day/period range. Returns
 * { teachers: [{id, reason, section, mergeable}], venues: [...] }.
 * `mergeable` is true when the busy slot has exactly the same timing, which is
 * what the editor turns into "busy in 5-A, can be merged".
 */
export function busyResources(
  db,
  timetableId,
  day,
  startPeriod,
  span,
  ignoreSlotId = null,
  mergeGroup = null
) {
  const end = startPeriod + span
  const rows = db
    .prepare(
      `SELECT s.id, s.day, s.start_period, s.span, s.batch_no, s.section_id, s.venue_id,
              s.merge_group, s.kind,
              sec.semester, sec.name AS section_name,
              COALESCE(sub.code, s.label) AS what,
              (SELECT GROUP_CONCAT(st.teacher_id) FROM slot_teachers st WHERE st.slot_id = s.id) AS teacher_ids
       FROM slots s
       JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       WHERE sec.timetable_id = ? AND s.day = ?
         AND s.start_period < ? AND s.start_period + s.span > ?
         AND s.id != ?
       ORDER BY s.start_period, s.id`
    )
    .all(timetableId, day, end, startPeriod, ignoreSlotId ?? -1)

  const teachers = new Map()
  const venues = new Map()

  for (const row of rows) {
    if (mergeGroup && row.merge_group === mergeGroup) continue
    const reason = `${periodRangeLabel(row.day, row.start_period, row.span)}, ${sectionLabel(
      row.semester,
      row.section_name,
      row.batch_no
    )} ${row.what}`
    const mergeable = sameTiming({ day, start_period: startPeriod, span }, row)
    const section = sectionLabel(row.semester, row.section_name, row.batch_no)
    for (const teacherId of parseIds(row.teacher_ids)) {
      const previous = teachers.get(teacherId)
      if (!previous || (mergeable && !previous.mergeable)) {
        teachers.set(teacherId, { id: teacherId, reason, section, mergeable })
      }
    }
    if (row.venue_id) {
      const previous = venues.get(row.venue_id)
      if (!previous || (mergeable && !previous.mergeable)) {
        venues.set(row.venue_id, { id: row.venue_id, reason, section, mergeable })
      }
    }
  }

  return { teachers: [...teachers.values()], venues: [...venues.values()] }
}

/** Re-checks every slot in a timetable against all others. */
export function validateTimetable(db, timetableId) {
  const rows = db
    .prepare(
      `SELECT s.*, sec.semester, sec.name AS section_name,
              COALESCE(sub.code, s.label) AS what, v.code AS venue_code,
              (SELECT GROUP_CONCAT(st.teacher_id) FROM slot_teachers st WHERE st.slot_id = s.id) AS teacher_ids
       FROM slots s
       JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN venues v ON v.id = s.venue_id
       WHERE sec.timetable_id = ?
       ORDER BY s.day, s.start_period, s.id`
    )
    .all(timetableId)

  const conflicts = []
  for (const row of rows) {
    const teacherIds = parseIds(row.teacher_ids)
    const problems = checkConflicts(db, row, teacherIds, row.id)
    if (!problems.length) continue
    conflicts.push({
      slot_id: row.id,
      section_id: row.section_id,
      section: sectionLabel(row.semester, row.section_name, row.batch_no),
      day: row.day,
      start_period: row.start_period,
      span: row.span,
      kind: row.kind,
      what: row.what,
      batch_no: row.batch_no ?? null,
      merge_group: row.merge_group ?? null,
      where: periodRangeLabel(row.day, row.start_period, row.span),
      problems
    })
  }

  return { timetable_id: timetableId, checked: rows.length, slots: conflicts }
}

export function facultyTimetable(db, timetableId, teacherId) {
  const rows = db
    .prepare(
      `${VIEW_SQL}
       WHERE sec.timetable_id = ? AND EXISTS (SELECT 1 FROM slot_teachers st WHERE st.slot_id = s.id AND st.teacher_id = ?)
       ORDER BY s.day, s.start_period, s.id`
    )
    .all(timetableId, teacherId)
  return collapseMerged(rows)
}

export function venueTimetable(db, timetableId, venueId) {
  const rows = db
    .prepare(
      `${VIEW_SQL} WHERE sec.timetable_id = ? AND s.venue_id = ? ORDER BY s.day, s.start_period, s.id`
    )
    .all(timetableId, venueId)
  return collapseMerged(rows)
}

/**
 * One line per teacher and venue for the generated views' side lists:
 * id/code/name plus the number of periods booked in this timetable.
 * A merged lecture counts once, no matter how many sections attend it.
 */
export function viewsSummary(db, timetableId) {
  const teachers = db
    .prepare(
      `SELECT t.id, t.code, t.name,
              COALESCE((SELECT SUM(span) FROM (
                SELECT DISTINCT COALESCE(s.merge_group, 'slot:' || s.id) AS grp, s.span
                FROM slot_teachers st
                JOIN slots s ON s.id = st.slot_id
                JOIN sections sec ON sec.id = s.section_id
                WHERE st.teacher_id = t.id AND sec.timetable_id = ?
              )), 0) AS periods
       FROM teachers t
       ORDER BY t.code`
    )
    .all(timetableId)

  const venues = db
    .prepare(
      `SELECT v.id, v.code, v.name, v.kind,
              COALESCE((SELECT SUM(span) FROM (
                SELECT DISTINCT COALESCE(s.merge_group, 'slot:' || s.id) AS grp, s.span
                FROM slots s
                JOIN sections sec ON sec.id = s.section_id
                WHERE s.venue_id = v.id AND sec.timetable_id = ?
              )), 0) AS periods
       FROM venues v
       ORDER BY v.code`
    )
    .all(timetableId)

  return { teachers, venues }
}

/** Free periods for a teacher or venue: handy extra, almost free to build. */
export function freePeriods(busyRows) {
  const busy = new Set()
  for (const row of busyRows) {
    for (let period = row.start_period; period < row.start_period + row.span; period += 1) {
      busy.add(`${row.day}-${period}`)
    }
  }
  const free = []
  for (let day = 1; day <= 5; day += 1) {
    for (let period = 1; period <= 8; period += 1) {
      if (!busy.has(`${day}-${period}`)) free.push({ day, period })
    }
  }
  return free
}

const timetableCore = {
  checkConflicts,
  findMergeCandidates,
  saveSlot,
  deleteSlot,
  joinMergeGroup,
  mergePartners,
  sameTiming,
  sectionTimetable,
  sectionSlots,
  busyResources,
  validateTimetable,
  facultyTimetable,
  venueTimetable,
  viewsSummary,
  freePeriods
}

export default timetableCore
export { LUNCH_AFTER, DAY_NAMES }
