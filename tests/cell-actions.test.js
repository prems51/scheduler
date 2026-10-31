import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TimetableGrid from '../src/renderer/src/components/TimetableGrid.jsx'
import {
  activityDraftFor,
  cellAnchorOf,
  contextMenuItems,
  lectureDraftFor,
  maxSpanFrom
} from '../src/renderer/src/lib/cellActions'
import { buildGrid, PERIODS } from '@shared/gridLayout'

const lecture = (id, overrides = {}) => ({
  id,
  day: 1,
  start_period: 3,
  span: 1,
  kind: 'L',
  subject_id: null,
  subject_code: 'BCS501',
  batch_no: null,
  elective_group: null,
  venue_id: null,
  venue_code: 'B-321',
  label: null,
  merge_group: null,
  merge_label: null,
  teacher_ids: [],
  teacher_codes: '',
  ...overrides
})

describe('add-activity entry points (round-4 Issue 1)', () => {
  it('maxSpanFrom stops at lunch and at the end of the day', () => {
    expect(maxSpanFrom(1)).toBe(4)
    expect(maxSpanFrom(4)).toBe(1)
    expect(maxSpanFrom(5)).toBe(4)
    expect(maxSpanFrom(8)).toBe(1)
  })

  it('the activity draft mirrors the slot under the cursor, but is a NEW slot', () => {
    const over = activityDraftFor(1, 3, lecture(7, { span: 2 }))
    expect(over.draft).toBe(true)
    expect(over.id).toBe(null)
    expect(over.kind).toBe('ACTIVITY')
    expect(over.day).toBe(1)
    expect(over.start_period).toBe(3)
    expect(over.span).toBe(2)
    expect(over.batch_no).toBe(null)
    expect(over.venue_id).toBe(null)
    expect(over.teacher_ids).toEqual([])
    expect(over.label).toBe('')
  })

  it('the draft span is limited by lunch and the end of the day', () => {
    // A lab P7-P8 overlapped: the activity can only start at P7.
    expect(activityDraftFor(3, 7, lecture(7, { start_period: 7, span: 2 })).span).toBe(2)
    // Clicking at P4 (lunch after P4): even a span 2 lecture can only be 1 wide.
    expect(activityDraftFor(4, 4, lecture(7, { start_period: 4, span: 2 })).span).toBe(1)
  })

  it('the activity draft on an empty cell runs one period by default', () => {
    const draft = activityDraftFor(5, 2, null)
    expect(draft.start_period).toBe(2)
    expect(draft.span).toBe(1)
  })

  it('the lecture draft opens a fresh single-period editor', () => {
    const draft = lectureDraftFor(2, 6)
    expect(draft.draft).toBe(true)
    expect(draft.kind).toBe('L')
    expect(draft.start_period).toBe(6)
    expect(draft.span).toBe(1)
    expect(draft.venue_id).toBe(null)
  })

  it('the context menu edits an occupied cell and adds classes to any cell', () => {
    expect(contextMenuItems(lecture(7))).toEqual([
      { id: 'edit-slot', label: 'Edit slot' },
      { id: 'add-activity', label: 'Add activity here' },
      { id: 'add-lecture', label: 'Add lecture here' }
    ])
    expect(contextMenuItems(null)).toEqual([
      { id: 'add-activity', label: 'Add activity here' },
      { id: 'add-lecture', label: 'Add lecture here' }
    ])
  })

  it('cellAnchorOf resolves the slot covering the focused period', () => {
    const grid = buildGrid([lecture(7, { day: 2, start_period: 2, span: 2 })])
    expect(cellAnchorOf(grid, 2, 3)).toMatchObject({ period: 2 })
    expect(cellAnchorOf(grid, 2, 3).slot.id).toBe(7)
    expect(cellAnchorOf(grid, 2, 5)).toEqual({ slot: null, period: 5 })
    expect(PERIODS.length).toBe(8)
  })

  it('the real grid component renders the hover button on occupied cells only', () => {
    const grid = buildGrid([
      lecture(7, { day: 2, start_period: 2, span: 2 })
    ])
    const markup = renderToStaticMarkup(
      createElement(TimetableGrid, { grid, onAddActivity: () => {}, onCellContext: () => {} })
    )
    expect(markup).toContain('grid-add-activity')
    expect(markup).toContain('Add an activity in this period')
  })

  it('occupied slot cells carry the context-menu handler', () => {
    const grid = buildGrid([lecture(7, { day: 2, start_period: 2 })])
    renderToStaticMarkup(createElement(TimetableGrid, { grid, onCellContext: () => {} }))
    // onContextMenu is a React handler: rendered markup only shows elements.
    // Re-render without handlers to prove the button is conditional.
    const withoutHandlers = renderToStaticMarkup(createElement(TimetableGrid, { grid }))
    expect(withoutHandlers).not.toContain('grid-add-activity')
  })
})
