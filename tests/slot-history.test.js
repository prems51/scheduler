import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  commitRedo,
  commitUndo,
  emptyHistory,
  peekRedo,
  peekUndo,
  pushChange,
  snapshotFromRow,
  withSlotId
} from '../src/renderer/src/lib/slotHistory.js'

const change = (id, label = 'edit') => ({
  label,
  before: { id, payload: { section_id: 1 }, teacherIds: [], code: 'BCS501' },
  after: { id, payload: { section_id: 1 }, teacherIds: [], code: 'BCS501' }
})

describe('slot snapshot', () => {
  it('copies only the fields slots:save accepts, plus teacher ids', () => {
    const row = {
      id: 7,
      section_id: 2,
      day: 3,
      start_period: 5,
      span: 1,
      kind: 'P',
      subject_id: 9,
      batch_no: 1,
      elective_group: null,
      venue_id: 4,
      label: null,
      merge_group: null,
      subject_code: 'BCS501',
      teacher_ids: [11, 12],
      teacher_codes: 'VB/RUG',
      section_name: 'B',
      semester: 5
    }

    expect(snapshotFromRow(row)).toEqual({
      id: 7,
      payload: {
        section_id: 2,
        day: 3,
        start_period: 5,
        span: 1,
        kind: 'P',
        subject_id: 9,
        batch_no: 1,
        elective_group: null,
        venue_id: 4,
        label: null,
        merge_group: null
      },
      teacherIds: [11, 12],
      code: 'BCS501'
    })
  })

  it('falls back to the activity label as its display code', () => {
    expect(snapshotFromRow({ id: 3, kind: 'ACTIVITY', label: 'Sports', teacher_ids: [] }).code).toBe(
      'Sports'
    )
  })
})

describe('undo history', () => {
  it('starts empty and has nothing to undo or redo', () => {
    expect(peekUndo(emptyHistory())).toBeNull()
    expect(peekRedo(emptyHistory())).toBeNull()
  })

  it('keeps only the last 30 changes', () => {
    let history = emptyHistory()
    for (let id = 1; id <= HISTORY_LIMIT + 5; id += 1) {
      history = pushChange(history, change(id))
    }

    expect(history.undo).toHaveLength(HISTORY_LIMIT)
    expect(history.undo[0].before.id).toBe(6)
    expect(peekUndo(history).before.id).toBe(35)
  })

  it('clears the redo stack when a new change is recorded', () => {
    let history = pushChange(emptyHistory(), change(1))
    history = commitUndo(history, history.undo[0])
    expect(history.redo).toHaveLength(1)

    history = pushChange(history, change(2))
    expect(history.redo).toEqual([])
    expect(history.undo).toHaveLength(1)
  })

  it('moves an entry between undo and redo as it is applied', () => {
    let history = pushChange(emptyHistory(), change(1))
    history = pushChange(history, change(2))

    const applied = peekUndo(history)
    history = commitUndo(history, applied)
    expect(history.undo).toHaveLength(1)
    expect(peekRedo(history).before.id).toBe(2)

    const redone = peekRedo(history)
    history = commitRedo(history, redone)
    expect(history.redo).toEqual([])
    expect(peekUndo(history).before.id).toBe(2)
  })
})

describe('withSlotId', () => {
  const entry = {
    before: { id: 4, payload: {}, teacherIds: [] },
    after: { id: 4, payload: {}, teacherIds: [] }
  }

  it('points both sides at the recreated slot after a delete is undone', () => {
    expect(withSlotId(entry, 12, false).before.id).toBe(12)
    expect(withSlotId(entry, 12, false).after.id).toBe(12)
  })

  it('forgets the id after a slot is removed so the next redo creates a new one', () => {
    const patched = withSlotId(entry, null, true)
    expect(patched.before.id).toBeNull()
    expect(patched.after.id).toBeNull()
  })

  it('leaves a side that does not exist alone', () => {
    const created = { before: null, after: { id: 9, payload: {}, teacherIds: [] } }
    const patched = withSlotId(created, null, true)
    expect(patched.before).toBeNull()
    expect(patched.after.id).toBeNull()
  })
})
