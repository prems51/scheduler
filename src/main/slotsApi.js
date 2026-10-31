// slotsApi.js — the logic behind the slots:* IPC channels, without Electron.
// ipc.js registers these functions one-to-one on ipcMain, so a test that calls
// them is driving the exact same code path the renderer's UI drives.
//
// Round-3: they are moved here unchanged apart from being addressable directly
// (see tests/merge-flow-ipc.test.js), so bug fixes in the flow are covered by
// handler-level regression tests instead of copies of the handler bodies.

export class UserError extends Error {
  constructor(message, extra) {
    super(message)
    this.userMessage = message
    this.extra = extra
  }
}

export function fail(message, extra) {
  throw new UserError(message, extra)
}

// ---------- small validators ----------
export function requireText(value, label) {
  const text = String(value ?? '').trim()
  if (!text) fail(`${label} is required.`)
  return text
}

export function requireId(value, label) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) fail(`${label} is required.`)
  return id
}

export function optionalId(value, label) {
  if (value === null || value === undefined || value === '') return null
  return requireId(value, label)
}

export function optionalText(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

export function normalizeTeacherIds(teacherIds) {
  if (teacherIds === null || teacherIds === undefined) return []
  if (!Array.isArray(teacherIds)) fail('Teachers must be sent as a list.')
  return [...new Set(teacherIds.map((id) => requireId(id, 'Teacher')))]
}

export function normalizeSubjectCode(code) {
  return String(code ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
}

export function normalizeSlot(slot) {
  if (!slot || typeof slot !== 'object') fail('Slot data is missing.')

  const kind = String(slot.kind ?? '').trim().toUpperCase()
  if (!['L', 'T', 'P', 'ACTIVITY'].includes(kind)) {
    fail('Slot kind must be L, T, P or ACTIVITY.')
  }

  const day = Number(slot.day)
  if (!Number.isInteger(day) || day < 1 || day > 6) fail('Day must be 1 (Mon) to 6 (Sat).')

  const startPeriod = Number(slot.start_period)
  if (!Number.isInteger(startPeriod) || startPeriod < 1 || startPeriod > 8) {
    fail('Start period must be 1 to 8.')
  }

  const span = Number(slot.span ?? 1)
  if (!Number.isInteger(span) || span < 1 || span > 4) fail('Span must be 1 to 4 periods.')

  const subjectId = optionalId(slot.subject_id, 'Subject')
  const label = optionalText(slot.label)
  if (kind === 'ACTIVITY') {
    if (!label) fail('An activity needs a label, for example "Sports".')
  } else if (!subjectId) {
    fail('Choose a subject for this slot.')
  }

  const batchNo =
    slot.batch_no === null || slot.batch_no === undefined || slot.batch_no === ''
      ? null
      : Number(slot.batch_no)
  if (batchNo !== null && batchNo !== 1 && batchNo !== 2) {
    fail('Batch must be 1 or 2, or empty for the whole section.')
  }
  if (kind === 'ACTIVITY' && batchNo !== null) {
    fail('An activity covers the whole section, so it has no batch.')
  }

  return {
    section_id: requireId(slot.section_id, 'Section'),
    day,
    start_period: startPeriod,
    span,
    kind,
    subject_id: kind === 'ACTIVITY' ? null : subjectId,
    batch_no: batchNo,
    elective_group: optionalText(slot.elective_group),
    venue_id: optionalId(slot.venue_id, 'Venue'),
    label,
    merge_group: optionalText(slot.merge_group),
    merge_with: optionalId(slot.merge_with, 'Merged lecture'),
    detach: Boolean(slot.detach)
  }
}

export function validateSlotRefs(db, slot, teacherIds) {
  if (!db.prepare('SELECT id FROM sections WHERE id = ?').get(slot.section_id)) {
    fail('That section no longer exists.')
  }
  if (slot.subject_id && !db.prepare('SELECT id FROM subjects WHERE id = ?').get(slot.subject_id)) {
    fail('That subject no longer exists.')
  }
  if (slot.venue_id && !db.prepare('SELECT id FROM venues WHERE id = ?').get(slot.venue_id)) {
    fail('That venue no longer exists.')
  }
  for (const teacherId of teacherIds) {
    if (!db.prepare('SELECT id FROM teachers WHERE id = ?').get(teacherId)) {
      fail('One of the selected teachers no longer exists.')
    }
  }
}

// ---------- handlers (same bodies ipc.js registered) ----------

/** slots:listBySection */
export function slotsListBySection(db, sectionId) {
  return timetableCore.sectionSlots(db, requireId(sectionId, 'Section'))
}

/** slots:save */
export function slotsSave(db, slot = {}, teacherIds = [], slotId = null) {
  const normalized = normalizeSlot(slot)
  // Activities never carry teachers, whatever the editor sent.
  const teachers = normalized.kind === 'ACTIVITY' ? [] : normalizeTeacherIds(teacherIds)
  validateSlotRefs(db, normalized, teachers)
  const result = timetableCore.saveSlot(
    db,
    normalized,
    teachers,
    slotId === null || slotId === undefined ? null : requireId(slotId, 'Slot')
  )

  if (!result.ok) {
    fitProblems(result)
  }
  return db.prepare('SELECT * FROM slots WHERE id = ?').get(result.id)
}

/** slots:check */
export function slotsCheck(db, slot = {}, teacherIds = [], slotId = null) {
  const normalized = normalizeSlot(slot)
  const teachers = normalized.kind === 'ACTIVITY' ? [] : normalizeTeacherIds(teacherIds)
  validateSlotRefs(db, normalized, teachers)
  return timetableCore.checkConflicts(
    db,
    normalized,
    teachers,
    slotId === null || slotId === undefined ? null : requireId(slotId, 'Slot')
  )
}

/** slots:merge-candidates — the conflicts the editor offers as merges. */
export function slotsMergeCandidates(db, slot = {}, teacherIds = [], slotId = null) {
  const normalized = normalizeSlot(slot)
  const teachers = normalized.kind === 'ACTIVITY' ? [] : normalizeTeacherIds(teacherIds)
  validateSlotRefs(db, normalized, teachers)
  return timetableCore.findMergeCandidates(
    db,
    normalized,
    teachers,
    slotId === null || slotId === undefined ? null : requireId(slotId, 'Slot')
  )
}

/** slots:join-merge — adopts the other slot's teachers/venue; nothing written. */
export function slotsJoinMerge(db, slot = {}, candidateSlotId) {
  const normalized = normalizeSlot(slot)
  const result = timetableCore.joinMergeGroup(db, normalized, requireId(candidateSlotId, 'Slot'))
  if (!result.ok) {
    fail(result.problems[0]?.message || 'This slot cannot be merged.', {
      problems: result.problems
    })
  }
  return result
}

/** slots:leave-group — detach this section from the merged lecture in one save. */
export function slotsLeaveGroup(db, slotId, slot = null, teacherIds = null) {
  const id = requireId(slotId, 'Slot')
  const row = db.prepare('SELECT * FROM slots WHERE id = ?').get(id)
  if (!row) fail('That slot no longer exists.')
  if (!row.merge_group) return { id, merge_group: null, problems: [] }

  const payload = slot ? normalizeSlot({ ...slot, merge_group: null }) : normalizeSlot(row)
  const teachers =
    teacherIds === null || teacherIds === undefined
      ? db
          .prepare('SELECT teacher_id FROM slot_teachers WHERE slot_id = ?')
          .all(id)
          .map((entry) => entry.teacher_id)
      : normalizeTeacherIds(teacherIds)
  validateSlotRefs(db, payload, payload.kind === 'ACTIVITY' ? [] : teachers)

  const result = timetableCore.saveSlot(
    db,
    { ...payload, detach: true, merge_group: null },
    payload.kind === 'ACTIVITY' ? [] : teachers,
    id
  )
  if (!result.ok) {
    fail(result.problems[0]?.message || 'This section cannot leave the merged lecture yet.', {
      problems: result.problems
    })
  }
  return { id, merge_group: null }
}

/** slots:busy — teachers/venues occupied in the given window, group aware. */
export function slotsBusy(
  db,
  timetableId,
  day,
  startPeriod,
  span,
  ignoreSlotId = null,
  mergeGroupId = null
) {
  const timetable = requireId(timetableId, 'Timetable')
  if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(timetable)) {
    fail('That timetable no longer exists.')
  }

  const dayNumber = Number(day)
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 6) {
    fail('Day must be 1 (Mon) to 6 (Sat).')
  }
  const start = Number(startPeriod)
  if (!Number.isInteger(start) || start < 1 || start > 8) fail('Start period must be 1 to 8.')
  const length = Number(span ?? 1)
  if (!Number.isInteger(length) || length < 1 || length > 8) fail('Span must be 1 to 8 periods.')

  const ignore =
    ignoreSlotId === null || ignoreSlotId === undefined ? null : requireId(ignoreSlotId, 'Slot')
  const mergeGroup = optionalText(mergeGroupId)

  return timetableCore.busyResources(db, timetable, dayNumber, start, length, ignore, mergeGroup)
}

/** slots:delete — removes this section's slot only; the merged rest stays. */
export function slotsDelete(db, slotId) {
  const id = requireId(slotId, 'Slot')
  if (!db.prepare('SELECT id FROM slots WHERE id = ?').get(id)) fail('That slot no longer exists.')
  return timetableCore.deleteSlot(db, id)
}

function fitProblems(result) {
  const problems = result.problems || []
  fail(problems[0]?.message || 'This slot conflicts with another class.', { problems })
}

import timetableCore from '../../timetable-core.js'
