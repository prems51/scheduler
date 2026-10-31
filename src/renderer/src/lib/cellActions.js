// cellActions.js — the click/context-menu/keyboard entry points of the master
// timetable, as pure functions. An occupied cell used to be a dead end for
// activities: the only clickable targets were empty cells and the slot's own
// editor, so an activity could only be created after a lane already existed
// (the "tick Parallel elective" workaround). These helpers turn any cell —
// empty or occupied — into editor drafts. See tests/cell-actions.test.js.

import { LUNCH_AFTER, PERIODS, slotCellAt } from '@shared/gridLayout'

/** How many periods a slot starting at startPeriod may cover. */
export function maxSpanFrom(startPeriod) {
  return startPeriod <= LUNCH_AFTER
    ? LUNCH_AFTER + 1 - startPeriod
    : PERIODS.length + 1 - startPeriod
}

/**
 * The draft slot for the "add an activity here" entry points.
 *
 * Opens with kind Activity, the clicked cell's day/start period, the span of
 * the slot under the cursor (limited by lunch and end of day), batch = whole
 * section, venue = None, no teachers, and no id — so the editor treats it as a
 * NEW slot and saving it leaves the occupying lecture untouched.
 */
export function activityDraftFor(day, period, cellSlot) {
  const startPeriod = cellSlot?.start_period ?? period
  const limit = maxSpanFrom(startPeriod)
  const span = Math.max(1, Math.min(Number(cellSlot?.span) || 1, limit))
  return {
    draft: true,
    id: null,
    day,
    start_period: startPeriod,
    span,
    kind: 'ACTIVITY',
    subject_id: null,
    batch_no: null,
    elective_group: null,
    venue_id: null,
    label: '',
    merge_group: null,
    teacher_ids: []
  }
}

/** The draft slot for "add a lecture here" on an empty cell. */
export function lectureDraftFor(day, period) {
  return {
    draft: true,
    id: null,
    day,
    start_period: period,
    span: 1,
    kind: 'L',
    subject_id: null,
    batch_no: null,
    elective_group: null,
    venue_id: null,
    label: null,
    merge_group: null,
    teacher_ids: []
  }
}

/**
 * The right-click menu of one cell, in display order. An empty cell has
 * nothing to edit; an occupied one edits the slot. "Add lecture here" is
 * always offered — if it cannot fit, the editor's own conflict panel says so
 * (the "no free lane" case shows the normal conflict message there).
 */
export function contextMenuItems(cellSlot) {
  const items = []
  if (cellSlot) items.push({ id: 'edit-slot', label: 'Edit slot' })
  items.push({ id: 'add-activity', label: 'Add activity here' })
  items.push({ id: 'add-lecture', label: 'Add lecture here' })
  return items
}

/**
 * Which cell a UI event pointed at: the slot anchor covering day/period (the
 * same lookup the editor uses), plus where to anchor an editor popover.
 */
export function cellAnchorOf(grid, day, period) {
  const anchor = slotCellAt(grid, day, period)
  return {
    slot: anchor?.slot ?? null,
    period: anchor?.period ?? period
  }
}
