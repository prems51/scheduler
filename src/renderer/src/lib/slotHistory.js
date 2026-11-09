export const HISTORY_LIMIT = 30

export const SLOT_FIELDS = [
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

export function emptyHistory() {
  return { undo: [], redo: [] }
}

/** The payload slots:save expects, copied out of a slot row or another snapshot. */
export function payloadFromRow(row) {
  const payload = {}
  for (const field of SLOT_FIELDS) payload[field] = row?.[field] ?? null
  return payload
}

/**
 * { id, payload, teacherIds, code, constraintOverride } — everything needed to
 * re-save or delete, including whether the row was saved against a request.
 */
export function snapshotFromRow(row) {
  return {
    id: row?.id ?? null,
    payload: payloadFromRow(row),
    teacherIds: [...(row?.teacher_ids ?? [])],
    code: row?.subject_code || row?.label || '',
    constraintOverride: Number(row?.constraint_override ?? 0)
  }
}

export function snapshotFromPayload(
  payload,
  teacherIds,
  id = null,
  code = '',
  constraintOverride = 0
) {
  return {
    id,
    payload: payloadFromRow(payload),
    teacherIds: [...(teacherIds ?? [])],
    code: code || '',
    constraintOverride: Number(constraintOverride ?? 0)
  }
}

export function pushChange(history, change) {
  const undo = [...history.undo, change]
  return {
    undo: undo.slice(Math.max(0, undo.length - HISTORY_LIMIT)),
    redo: []
  }
}

export function peekUndo(history) {
  return history.undo.length ? history.undo[history.undo.length - 1] : null
}

export function peekRedo(history) {
  return history.redo.length ? history.redo[history.redo.length - 1] : null
}

export function commitUndo(history, applied) {
  return {
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, applied]
  }
}

export function commitRedo(history, applied) {
  return {
    undo: [...history.undo, applied],
    redo: history.redo.slice(0, -1)
  }
}

/**
 * After undo/redo the slot has a fresh id (or none when it was just removed).
 * Both sides of the entry need it so the next inverse call targets the right row.
 */
export function withSlotId(entry, nextId, removed) {
  const patch = (snapshot) =>
    snapshot ? { ...snapshot, id: removed ? null : nextId } : null
  return {
    ...entry,
    before: patch(entry.before),
    after: patch(entry.after)
  }
}
