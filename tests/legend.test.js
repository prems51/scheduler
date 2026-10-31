import { describe, expect, it } from 'vitest'
import { buildLegend, splitLegend } from '../desktop-shared/legend.js'

const teachers = [
  { id: 1, code: 'KN', name: 'Ms. Kanchan' },
  { id: 2, code: 'VB', name: 'Mr. Vikas Bhatnagar' },
  { id: 3, code: 'VBR', name: 'Dr. Vibhor K. Vishnoi' },
  { id: 4, code: 'DUA', name: 'Unknown (DUA)' }
]

const slot = (overrides = {}) => ({
  kind: 'L',
  subject_code: 'BCS501',
  subject_name: 'Database Management System',
  teacher_ids: [1],
  teacher_codes: 'KN',
  ...overrides
})

describe('buildLegend', () => {
  it('shows the code, the subject name and the faculty name', () => {
    expect(buildLegend([slot()], { teachers })).toEqual([
      {
        code: 'BCS501',
        name: 'Database Management System',
        teachers: 'KN',
        teacherNames: 'Ms. Kanchan'
      }
    ])
  })

  it('joins several teachers with / and their names with a comma', () => {
    const legend = buildLegend(
      [
        slot({
          subject_code: 'BCS554',
          subject_name: 'Mini Project or Internship Assessment',
          kind: 'P',
          teacher_ids: [2, 3],
          teacher_codes: ['VB', 'VBR']
        })
      ],
      { teachers }
    )

    expect(legend[0]).toMatchObject({
      code: 'BCS554',
      teachers: 'VB/VBR',
      teacherNames: 'Mr. Vikas Bhatnagar, Dr. Vibhor K. Vishnoi'
    })
  })

  it('keeps a lab instructor that differs from the allocation (DUA)', () => {
    const legend = buildLegend(
      [
        slot({ subject_code: 'BCS551', subject_name: 'DBMS Lab', kind: 'P' }),
        slot({
          subject_code: 'BCS551',
          subject_name: 'DBMS Lab',
          kind: 'P',
          teacher_ids: [4],
          teacher_codes: 'DUA'
        })
      ],
      { teachers }
    )

    expect(legend.map((entry) => entry.teachers)).toEqual(['DUA', 'KN'])
    expect(legend.map((entry) => entry.teacherNames)).toEqual(['Unknown (DUA)', 'Ms. Kanchan'])
  })

  it('deduplicates the same subject and teacher set', () => {
    const legend = buildLegend(
      [
        slot({ kind: 'L' }),
        slot({ kind: 'T' }),
        slot({ subject_code: 'BCS502', subject_name: 'Web Technology', teacher_ids: [1], teacher_codes: 'KN' })
      ],
      { teachers }
    )

    expect(legend).toHaveLength(2)
    expect(legend.map((entry) => entry.code)).toEqual(['BCS501', 'BCS502'])
  })

  it('never adds a row for an activity', () => {
    expect(
      buildLegend(
        [slot({ kind: 'ACTIVITY', subject_code: null, subject_name: null, teacher_ids: [], teacher_codes: '' })],
        { teachers }
      )
    ).toEqual([])
  })

  it('splits into two column groups like the department sheet', () => {
    const entries = ['A', 'B', 'C', 'D', 'E'].map((code) => ({ code }))
    const { rowCount, left, right, hasTeacherNames } = splitLegend([
      { code: 'A', teacherNames: 'Ms. Kanchan' },
      { code: 'B' },
      { code: 'C' },
      { code: 'D' },
      { code: 'E' }
    ])

    expect(entries).toHaveLength(5)
    expect(rowCount).toBe(3)
    expect(left.map((entry) => entry.code)).toEqual(['A', 'B', 'C'])
    expect(right.map((entry) => entry.code)).toEqual(['D', 'E'])
    expect(hasTeacherNames).toBe(true)
  })
})
