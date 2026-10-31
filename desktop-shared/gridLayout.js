// Pure layout engine for the master timetable grid.
// It takes the rows returned by slots:listBySection and decides, for each day:
// how many lanes (sub-rows) that day needs, which lane every slot sits in, and
// the colSpan/rowSpan the table has to paint. No React and no database here.
//
// Round-2 rule: an activity that overlaps a class gets its OWN lane below the
// class lanes, so the class and the activity are both visible.

import { batchLabel, sectionCodeLabel } from './labels.js'

export const LUNCH_AFTER = 4

export const PERIODS = [
  { no: 1, start: '09:05', end: '10:00' },
  { no: 2, start: '10:00', end: '10:55' },
  { no: 3, start: '10:55', end: '11:50' },
  { no: 4, start: '11:50', end: '12:45' },
  { no: 5, start: '13:40', end: '14:35' },
  { no: 6, start: '14:35', end: '15:30' },
  { no: 7, start: '15:30', end: '16:25' },
  { no: 8, start: '16:25', end: '17:20' }
]

export const LUNCH = { start: '12:45', end: '13:40' }

export function formatTime12Hour(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value))
  if (!match) throw new RangeError(`Invalid time "${value}". Expected HH:MM.`)

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23) throw new RangeError(`Invalid time "${value}". Expected HH:MM.`)

  const suffix = hour < 12 ? 'AM' : 'PM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatTimeRange12Hour(start, end) {
  const formattedStart = formatTime12Hour(start)
  const formattedEnd = formatTime12Hour(end)
  const startSuffix = formattedStart.slice(-2)
  const endSuffix = formattedEnd.slice(-2)
  const startClock = formattedStart.slice(0, -3)
  const endClock = formattedEnd.slice(0, -3)

  return startSuffix === endSuffix
    ? `${startClock}–${endClock} ${endSuffix}`
    : `${formattedStart}–${formattedEnd}`
}

export const DAYS = [
  { value: 1, label: 'MON' },
  { value: 2, label: 'TUE' },
  { value: 3, label: 'WED' },
  { value: 4, label: 'THU' },
  { value: 5, label: 'FRI' },
  { value: 6, label: 'SAT' }
]

export const DAY_LABELS = Object.fromEntries(DAYS.map((day) => [day.value, day.label]))

// Every day shows at least two lanes so batch/elective groups can sit side by side.
export const MIN_LANES = 2

const PERIOD_COUNT = PERIODS.length

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function toWholeNumber(value, fallback) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? number : fallback
}

export function isActivitySlot(slot) {
  return String(slot?.kind ?? '').toUpperCase() === 'ACTIVITY'
}

export function hasBatch(slot) {
  return slot?.batch_no !== null && slot?.batch_no !== undefined && slot?.batch_no !== ''
}

/** A slot is parallel when it only covers a batch or a parallel elective. */
function isParallel(slot) {
  return hasBatch(slot) || Boolean(slot.elective_group)
}

/**
 * Period column of a slot, limited so it can never run into the lunch column
 * and never past P8. The backend rejects those slots; this keeps the table
 * valid if old data ever slips through.
 */
export function columnsFor(slot) {
  const start = clamp(toWholeNumber(slot.start_period, 1), 1, PERIOD_COUNT)
  const lastColumn = start <= LUNCH_AFTER ? LUNCH_AFTER : PERIOD_COUNT
  const span = clamp(toWholeNumber(slot.span, 1), 1, lastColumn - start + 1)
  return { start, span }
}

/** True when two slots share at least one period column of the same day. */
export function rangesOverlap(a, b) {
  const left = columnsFor(a)
  const right = columnsFor(b)
  return left.start < right.start + right.span && right.start < left.start + left.span
}

function preferredLane(slot) {
  return hasBatch(slot) ? toWholeNumber(slot.batch_no, 1) - 1 : null
}

function compareSlots(a, b) {
  const columnsA = columnsFor(a)
  const columnsB = columnsFor(b)
  if (columnsA.start !== columnsB.start) return columnsA.start - columnsB.start

  // Batch 1 before batch 2 before batch 3, so the preferred lane is claimed first.
  const laneA = preferredLane(a)
  const laneB = preferredLane(b)
  if (laneA !== null && laneB !== null && laneA !== laneB) return laneA - laneB

  // Electives in the same group keep their data order.
  return toWholeNumber(a.id, 0) - toWholeNumber(b.id, 0)
}

function isFree(occupied, lane, start, span) {
  for (let period = start; period < start + span; period += 1) {
    if (occupied[lane].has(period)) return false
  }
  return true
}

function occupy(occupied, lane, laneSpan, start, span) {
  for (let row = lane; row < lane + laneSpan; row += 1) {
    for (let period = start; period < start + span; period += 1) {
      occupied[row].add(period)
    }
  }
}

/** Busiest period of the class slots decides how many class lanes the day needs. */
function classLaneCountFor(classes, overlapped) {
  let busiest = 0
  for (let period = 1; period <= PERIOD_COUNT; period += 1) {
    let active = 0
    for (const slot of classes) {
      // A whole-section class that touches nothing renders across all lanes.
      if (!isParallel(slot) && !overlapped.get(slot)) continue
      const { start, span } = columnsFor(slot)
      if (period >= start && period < start + span) active += 1
    }
    if (active > busiest) busiest = active
  }
  return Math.max(1, busiest)
}

/**
 * Plans one day.
 *
 * 1. Class slots (L/T/P) are lane-partitioned as before; a whole-section
 *    class that nothing touches spans every lane of the day.
 * 2. An activity that overlaps no class and no other activity spans every lane
 *    (SUPER - 30 on Wednesday P7-P8).
 * 3. An activity that does overlap something gets its own lane BELOW the class
 *    lanes, so nothing is hidden; overlapping activities stack like classes.
 *
 * The returned placements guarantee rectangles that never overlap.
 */
function planDay(daySlots, minLanes) {
  const classes = daySlots.filter((slot) => !isActivitySlot(slot))
  const activities = daySlots.filter((slot) => isActivitySlot(slot))

  const classOverlapped = new Map()
  for (const slot of classes) {
    classOverlapped.set(
      slot,
      classes.some((other) => other !== slot && rangesOverlap(other, slot))
    )
  }
  const classLanes = Math.max(minLanes, classLaneCountFor(classes, classOverlapped))

  const isolated = activities.filter(
    (activity) =>
      !classes.some((slot) => rangesOverlap(slot, activity)) &&
      !activities.some((other) => other !== activity && rangesOverlap(other, activity))
  )
  const stacked = activities.filter((activity) => !isolated.includes(activity))

  // One lane per concurrent stacked activity, deepest lane last.
  const activityLanes = []
  const activityLaneOf = new Map()
  for (const activity of [...stacked].sort(compareSlots)) {
    const { start, span } = columnsFor(activity)
    let lane = activityLanes.findIndex((taken) => {
      for (let period = start; period < start + span; period += 1) {
        if (taken.has(period)) return false
      }
      return true
    })
    if (lane === -1) {
      activityLanes.push(new Set())
      lane = activityLanes.length - 1
    }
    for (let period = start; period < start + span; period += 1) {
      activityLanes[lane].add(period)
    }
    activityLaneOf.set(activity, lane)
  }

  const totalLanes = classLanes + activityLanes.length
  const occupied = Array.from({ length: classLanes }, () => new Set())
  const placements = new Map()

  for (const slot of [...classes].sort(compareSlots)) {
    const { start, span } = columnsFor(slot)
    const touchedByActivity = activities.some((activity) => rangesOverlap(activity, slot))

    if (!isParallel(slot) && !classOverlapped.get(slot)) {
      // Nothing touches it: the old full-height cell. Only an activity lane
      // below it keeps it inside the class block.
      placements.set(slot, { lane: 0, laneSpan: touchedByActivity ? classLanes : totalLanes })
      occupy(occupied, 0, classLanes, start, span)
      continue
    }

    const wanted = preferredLane(slot)
    let lane =
      wanted !== null && wanted < classLanes && isFree(occupied, wanted, start, span)
        ? wanted
        : -1
    if (lane === -1) {
      lane = occupied.findIndex((_, index) => isFree(occupied, index, start, span))
    }
    if (lane === -1) lane = classLanes - 1

    occupy(occupied, lane, 1, start, span)
    placements.set(slot, { lane, laneSpan: 1 })
  }

  for (const activity of isolated) placements.set(activity, { lane: 0, laneSpan: totalLanes })
  for (const activity of stacked) {
    placements.set(activity, { lane: classLanes + activityLaneOf.get(activity), laneSpan: 1 })
  }

  return { laneCount: totalLanes, placements }
}

/**
 * Builds the whole table matrix.
 *
 * Each day gets `laneCount` lane rows filled with:
 *   { type: 'slot', slot, lane, laneSpan, colSpan, period }
 *   { type: 'covered' }   -- painted by a rowSpan/colSpan above or at the left
 *   { type: 'empty' }
 */
export function buildGrid(slots = [], options = {}) {
  const minLanes = Math.max(1, toWholeNumber(options.minLanes, MIN_LANES))
  const collisions = []
  const days = []
  let totalLaneRows = 0

  for (const day of DAYS) {
    const daySlots = slots.filter((slot) => toWholeNumber(slot.day, 0) === day.value)
    const { laneCount, placements } = planDay(daySlots, minLanes)
    const rows = Array.from({ length: laneCount }, () => Array(PERIOD_COUNT).fill(null))

    for (const slot of [...daySlots].sort(compareSlots)) {
      const { start, span } = columnsFor(slot)
      const placement = placements.get(slot) || { lane: 0, laneSpan: laneCount }
      const lane = clamp(placement.lane, 0, laneCount - 1)
      const laneSpan = clamp(placement.laneSpan, 1, laneCount - lane)

      let blocked = false
      for (let row = lane; row < lane + laneSpan && !blocked; row += 1) {
        for (let column = start - 1; column < start - 1 + span; column += 1) {
          if (rows[row][column]) {
            blocked = true
            break
          }
        }
      }
      if (blocked) {
        collisions.push(slot)
        continue
      }

      rows[lane][start - 1] = { type: 'slot', slot, lane, laneSpan, colSpan: span, period: start }
      for (let row = lane; row < lane + laneSpan; row += 1) {
        for (let column = start - 1; column < start - 1 + span; column += 1) {
          if (row === lane && column === start - 1) continue
          rows[row][column] = { type: 'covered' }
        }
      }
    }

    for (let row = 0; row < laneCount; row += 1) {
      for (let column = 0; column < PERIOD_COUNT; column += 1) {
        if (!rows[row][column]) rows[row][column] = { type: 'empty' }
      }
    }

    totalLaneRows += laneCount
    days.push({ day: day.value, label: day.label, laneCount, rows })
  }

  return { days, totalLaneRows, collisions }
}

/** The slot anchor covering one day/period, or null for an empty cell. */
export function slotCellAt(grid, day, period) {
  const dayData = grid?.days?.find((entry) => entry.day === day)
  if (!dayData) return null
  for (const row of dayData.rows) {
    for (const cell of row) {
      if (cell.type === 'slot' && period >= cell.period && period < cell.period + cell.colSpan) {
        return cell
      }
    }
  }
  return null
}

function teacherText(slot) {
  if (Array.isArray(slot.teacher_codes)) {
    return slot.teacher_codes.map((code) => String(code).trim()).filter(Boolean).join('/')
  }
  return String(slot.teacher_codes ?? '')
    .split('/')
    .map((code) => code.trim())
    .filter(Boolean)
    .join('/')
}

/**
 * The centred lines printed inside one cell of the section grid:
 *   whole-section lecture -> subject (kind) / teachers / venue
 *   batch practical       -> subject (kind) A1 / teachers venue
 *   merged lecture        -> …plus a small "Merged: 5-A, 5-C" line
 *   activity              -> its label, and the venue when it has one
 */
export function slotLines(slot) {
  const kind = String(slot.kind || 'L').toUpperCase()
  const venue = String(slot.venue_code ?? '').trim()

  if (kind === 'ACTIVITY') {
    return [String(slot.label ?? '').trim() || 'ACTIVITY', venue].filter(Boolean)
  }

  const code = String(slot.subject_code ?? '').trim() || 'Subject'
  const teachers = teacherText(slot)
  const merged = slot.merge_label ? String(slot.merge_label).trim() : ''

  if (hasBatch(slot)) {
    const head = `${code} (${kind}) ${batchLabel(slot.section_name, slot.batch_no)}`
    const detail = [teachers, venue].filter(Boolean).join(' ')
    return [...(detail ? [head, detail] : [head]), merged].filter(Boolean)
  }

  return [`${code} (${kind})`, teachers, venue, merged].filter(Boolean)
}

/**
 * The centred lines printed inside one cell of a generated view:
 *   faculty view: subject (kind) / section(+batch or merged sections) / venue
 *   venue view:   subject (kind) / section(+batch or merged sections) / teachers
 */
export function viewLines(slot, mode) {
  const kind = String(slot.kind || 'L').toUpperCase()
  const venue = String(slot.venue_code ?? '').trim()

  if (kind === 'ACTIVITY') {
    return [String(slot.label ?? '').trim() || 'ACTIVITY', venue].filter(Boolean)
  }

  const code = String(slot.subject_code ?? '').trim() || 'Subject'
  const where =
    String(slot.merged_label ?? '').trim() ||
    sectionCodeLabel(slot.semester, slot.section_name, slot.batch_no)

  if (mode === 'faculty') {
    return [`${code} (${kind})`, where, venue].filter(Boolean)
  }

  const teachers = teacherText(slot)
  return [`${code} (${kind})`, where, teachers].filter(Boolean)
}
