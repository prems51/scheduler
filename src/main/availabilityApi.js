// availabilityApi.js — the logic behind the availability:* IPC channels,
// without Electron (ipc.js registers these one-to-one). A test can call them
// directly and drive the same path the Constraints page drives.

import timetableCore from '../../timetable-core.js'
import { AVAILABILITY_TARGETS } from '../../desktop-shared/availability.js'
import { fail, requireId } from './slotsApi.js'

function requireTargetType(value) {
  const type = String(value ?? '').trim().toLowerCase()
  if (!AVAILABILITY_TARGETS.includes(type)) {
    fail('Availability target must be "teacher", "venue" or "section".')
  }
  return type
}

function requireTimetable(db, timetableId) {
  const id = requireId(timetableId, 'Timetable')
  if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(id)) {
    fail('That timetable no longer exists.')
  }
  return id
}

function requireTarget(db, timetableId, targetType, targetId) {
  const id = requireId(targetId, 'Target')
  if (targetType === 'teacher') {
    if (!db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)) {
      fail('That teacher no longer exists.')
    }
  } else if (targetType === 'venue') {
    if (!db.prepare('SELECT id FROM venues WHERE id = ?').get(id)) {
      fail('That venue no longer exists.')
    }
  } else if (
    !db.prepare('SELECT id FROM sections WHERE id = ? AND timetable_id = ?').get(id, timetableId)
  ) {
    fail('That section does not belong to the active timetable.')
  }
  return id
}

/** availability:get */
export function availabilityGet(db, timetableId, targetType, targetId) {
  const timetable = requireTimetable(db, timetableId)
  const type = requireTargetType(targetType)
  const target = requireTarget(db, timetable, type, targetId)
  return timetableCore.getAvailability(db, timetable, type, target)
}

/** availability:save */
export function availabilitySave(db, timetableId, targetType, targetId, cells = [], note = '') {
  const timetable = requireTimetable(db, timetableId)
  const type = requireTargetType(targetType)
  const target = requireTarget(db, timetable, type, targetId)
  if (!Array.isArray(cells)) fail('Availability cells must be sent as a list.')
  return timetableCore.saveAvailability(db, timetable, type, target, cells, note)
}

/** availability:matrix */
export function availabilityMatrix(db, timetableId, targetType, targetId) {
  const timetable = requireTimetable(db, timetableId)
  const type = requireTargetType(targetType)
  const target = requireTarget(db, timetable, type, targetId)
  return timetableCore.availabilityMatrix(db, timetable, type, target)
}

/** availability:summary — counts per target for the list badges. */
export function availabilitySummary(db, timetableId, targetType) {
  const timetable = requireTimetable(db, timetableId)
  const type = requireTargetType(targetType)
  return timetableCore.availabilitySummary(db, timetable, type)
}

/** availability:copy — same target type only. */
export function availabilityCopy(db, timetableId, fromType, fromId, toType, toId) {
  const timetable = requireTimetable(db, timetableId)
  const sourceType = requireTargetType(fromType)
  const destinationType = requireTargetType(toType)
  if (sourceType !== destinationType) {
    fail('Availability can only be copied between the same kind of target.')
  }
  const source = requireTarget(db, timetable, sourceType, fromId)
  const destination = requireTarget(db, timetable, destinationType, toId)
  if (source === destination) fail('Pick a different target to copy from.')
  return timetableCore.copyAvailability(db, timetable, sourceType, source, destinationType, destination)
}
