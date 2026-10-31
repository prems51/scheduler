import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TimetableGrid from '../src/renderer/src/components/TimetableGrid.jsx'
import { buildGrid, slotLines } from '@shared/gridLayout'

// Round-3 Issue 2: until now the on-screen activity cell rendered only the
// label line, dropping the venue that slotLines already provides — so an
// activity with a venue was invisible in the Master Timetable grid while the
// Excel/PDF exports (which render every line) showed it.
const slot = {
  id: 1,
  day: 3,
  start_period: 7,
  span: 2,
  kind: 'ACTIVITY',
  label: 'SUPER - 30',
  batch_no: null,
  elective_group: null,
  venue_id: 9,
  venue_code: 'B-109',
  subject_code: null,
  subject_name: null,
  section_name: 'B',
  semester: 5,
  teacher_ids: [],
  teacher_codes: null,
  merge_group: null,
  merge_label: null
}

function gridWithActivity(extraRows = []) {
  return buildGrid([
    ...extraRows,
    { ...slot, section_id: 1 },
    // keep the grid valid: an ordinary lecture somewhere monotonous
    extraRows.length === 0
      ? {
          ...slot,
          id: 2,
          day: 1,
          start_period: 1,
          span: 1,
          kind: 'L',
          label: null,
          venue_id: 7,
          venue_code: 'B-321',
          subject_code: 'BCS501',
          subject_name: 'Software Engineering',
          teacher_ids: [4],
          teacher_codes: 'KN'
        }
      : null
  ].filter(Boolean))
}

describe('activity venue shown in the grid cell (Issue 2)', () => {
  it('shared slotLines puts the label first and the venue under it', () => {
    expect(slotLines(slot)).toEqual(['SUPER - 30', 'B-109'])
    expect(slotLines({ ...slot, venue_id: null, venue_code: null })).toEqual(['SUPER - 30'])
  })

  it('renders the venue line under the activity label in the real grid component', () => {
    const markup = renderToStaticMarkup(createElement(TimetableGrid, { grid: gridWithActivity() }))
    expect(markup).toContain('SUPER - 30')
    expect(markup).toContain('B-109')
    expect(markup).toContain('grid-activity-detail')
  })

  it('an activity without a venue shows only the label', () => {
    const grid = buildGrid([{ ...slot, id: 5, venue_id: null, venue_code: null }])
    const markup = renderToStaticMarkup(createElement(TimetableGrid, { grid }))
    expect(markup).toContain('SUPER - 30')
    expect(markup).not.toContain('B-109')
  })
})
