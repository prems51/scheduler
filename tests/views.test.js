import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import seedModule from '../scripts/seed-section-b.js'
import { buildGrid } from '../desktop-shared/gridLayout.js'

const { seedSectionB } = seedModule
const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  return db
}

function slotsKey(rows) {
  return rows.map((row) => [row.day, row.start_period, row.span, row.subject_code])
}

describe('generated views', () => {
  let db
  let ids

  beforeEach(() => {
    db = freshDb()
    ids = seedSectionB(db)
  })

  afterEach(() => {
    db.close()
  })

  const teacherId = (code) => db.prepare('SELECT id FROM teachers WHERE code = ?').get(code).id
  const venueId = (code) => db.prepare('SELECT id FROM venues WHERE code = ?').get(code).id

  it('KN sees exactly her Section B periods, in order', () => {
    const rows = timetableCore.facultyTimetable(db, ids.timetableId, teacherId('KN'))
    expect(slotsKey(rows)).toEqual([
      [1, 3, 2, 'BCS551'], // Mon P3-4 lab B1
      [1, 6, 1, 'BCS501'], // Mon P6 tutorial B2
      [2, 3, 1, 'BCS501'],
      [3, 3, 1, 'BCS501'],
      [4, 2, 1, 'BCS501'],
      [5, 4, 1, 'BCS501'], // Fri P4 tutorial B1
      [5, 5, 2, 'BCS551'] // Fri P5-6 lab B2
    ])
  })

  it('B-114 shows its two lab slots', () => {
    const rows = timetableCore.venueTimetable(db, ids.timetableId, venueId('B-114'))
    expect(slotsKey(rows)).toEqual([
      [1, 3, 2, 'BCS551'],
      [5, 5, 2, 'BCS551']
    ])
  })

  it('viewsSummary counts weekly periods per teacher and venue', () => {
    const summary = timetableCore.viewsSummary(db, ids.timetableId)
    const kn = summary.teachers.find((teacher) => teacher.code === 'KN')
    expect(kn.periods).toBe(9) // 2 + 1 + 1 + 1 + 1 + 1 + 2

    const b114 = summary.venues.find((venue) => venue.code === 'B-114')
    expect(b114.periods).toBe(4) // two double-period labs

    // Teachers with no bookings still appear, with zero periods.
    expect(summary.teachers.length).toBe(12)
  })

  it('freePeriods reports Mon-Fri P1-P8 minus booked periods', () => {
    const rows = timetableCore.facultyTimetable(db, ids.timetableId, teacherId('KN'))
    const free = timetableCore.freePeriods(rows)
    expect(free.length).toBe(31) // 5 days x 8 periods - 9 booked
    expect(free).toContainEqual({ day: 1, period: 5 })
    expect(free).not.toContainEqual({ day: 1, period: 3 })
  })

  it('stacks two overlapping slots into separate lanes instead of dropping one', () => {
    // A teacher covering two sections in the same period (imported data, or a
    // future engine change) must render both, stacked side by side.
    const overlapping = [
      {
        id: 1, day: 3, start_period: 3, span: 2, kind: 'L', batch: null,
        elective_group: null, subject_code: 'AA101', section_name: 'A', semester: 5,
        venue_code: 'X-1', teacher_codes: 'KN'
      },
      {
        id: 2, day: 3, start_period: 3, span: 2, kind: 'L', batch: null,
        elective_group: null, subject_code: 'BB101', section_name: 'B', semester: 5,
        venue_code: 'X-2', teacher_codes: 'KN'
      },
      {
        id: 3, day: 3, start_period: 6, span: 1, kind: 'L', batch: null,
        elective_group: null, subject_code: 'CC101', section_name: 'B', semester: 5,
        venue_code: 'X-2', teacher_codes: 'KN'
      }
    ]

    const grid = buildGrid(overlapping)
    expect(grid.collisions).toEqual([])
    const wed = grid.days.find((day) => day.day === 3)
    const anchors = wed.rows.flatMap((row) => row.filter((cell) => cell.type === 'slot'))
    expect(anchors.length).toBe(3)

    const anchoredAt3 = anchors.filter((cell) => cell.period === 3)
    expect(anchoredAt3.map((cell) => cell.slot.subject_code).sort()).toEqual(['AA101', 'BB101'])
    // The two concurrent classes sit stacked side by side, one lane each.
    const lanesAt3 = anchoredAt3.map((cell) => cell.lane)
    expect(new Set(lanesAt3).size).toBe(2)
    expect(anchoredAt3.every((cell) => cell.laneSpan === 1)).toBe(true)

    // The later class overlaps nothing and widens back across both lanes.
    const later = anchors.find((cell) => cell.period === 6)
    expect(later.lane).toBe(0)
    expect(later.laneSpan).toBe(2)
  })

  it('a lone whole-section slot still spans every lane like the master sheet', () => {
    const grid = buildGrid([
      {
        id: 9, day: 2, start_period: 2, span: 1, kind: 'L', batch: null,
        elective_group: null, subject_code: 'AA101', section_name: 'A', semester: 5,
        venue_code: 'X-1', teacher_codes: 'KN'
      }
    ])
    const tue = grid.days.find((day) => day.day === 2)
    const cell = tue.rows.flatMap((row) => row).find((c) => c.type === 'slot')
    expect(cell.laneSpan).toBe(2)
    expect(cell.lane).toBe(0)
  })
})
