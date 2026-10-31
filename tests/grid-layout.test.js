import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import seedModule from '../scripts/seed-section-b.js'
import {
  buildGrid,
  columnsFor,
  formatTime12Hour,
  formatTimeRange12Hour,
  slotLines,
  PERIODS
} from '../desktop-shared/gridLayout.js'

const { seedSectionB } = seedModule
const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8')

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
  return db
}

function anchorsOf(day) {
  const anchors = []
  for (const row of day.rows) {
    for (const cell of row) {
      if (cell.type === 'slot') anchors.push(cell)
    }
  }
  return anchors
}

function dayOf(grid, dayNumber) {
  return grid.days.find((day) => day.day === dayNumber)
}

function cellAt(grid, dayNumber, period, subjectCode, batch = null) {
  return (
    anchorsOf(dayOf(grid, dayNumber)).find(
      (cell) =>
        cell.period === period &&
        cell.slot.subject_code === subjectCode &&
        (cell.slot.batch_no ?? null) === batch
    ) || null
  )
}

function activityAt(grid, dayNumber, period) {
  return (
    anchorsOf(dayOf(grid, dayNumber)).find(
      (cell) => cell.period === period && cell.slot.kind === 'ACTIVITY'
    ) || null
  )
}

// A hand-built row in the same shape slots:listBySection returns.
function fakeSlot(overrides = {}) {
  return {
    id: 1,
    day: 2,
    start_period: 1,
    span: 1,
    kind: 'L',
    subject_id: 1,
    batch_no: null,
    elective_group: null,
    label: null,
    subject_code: 'BCS501',
    subject_name: 'Database Management System',
    venue_code: 'B-321',
    semester: 5,
    section_name: 'B',
    teacher_ids: [1],
    teacher_codes: 'KN',
    ...overrides
  }
}

describe('grid layout — Section B (2026-27, odd semester)', () => {
  let db
  let ids
  let slots
  let grid

  beforeAll(() => {
    db = freshDb()
    ids = seedSectionB(db)
    // The exact rows the renderer gets from slots:listBySection.
    slots = timetableCore.sectionSlots(db, ids.sectionId)
    grid = buildGrid(slots)
  })

  afterAll(() => {
    db.close()
  })

  it('receives every slot through the real IPC row shape', () => {
    expect(slots).toHaveLength(43)
    expect(slots[0]).toMatchObject({
      day: expect.any(Number),
      start_period: expect.any(Number),
      span: expect.any(Number),
      subject_code: expect.any(String),
      teacher_ids: expect.any(Array),
      teacher_codes: expect.any(String)
    })

    const bcs554 = slots.find((slot) => slot.subject_code === 'BCS554')
    expect(bcs554.teacher_codes).toBe('RUG/VB')
    expect(bcs554.teacher_ids).toHaveLength(2)
  })

  it('places every slot exactly once and reports no collisions', () => {
    const anchors = grid.days.flatMap(anchorsOf)
    expect(anchors).toHaveLength(43)
    expect(new Set(anchors.map((cell) => cell.slot.id)).size).toBe(43)
    expect(grid.collisions).toEqual([])
  })

  it('always renders Mon–Sat with at least two lanes per day', () => {
    expect(grid.days.map((day) => day.label)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])
    expect(grid.days.map((day) => day.laneCount)).toEqual([2, 2, 2, 2, 2, 2])
    expect(grid.totalLaneRows).toBe(12)
  })

  it('merges a whole-section lecture vertically over all lanes', () => {
    const lecture = cellAt(grid, 1, 1, 'BCS502')
    expect(lecture).toMatchObject({ lane: 0, laneSpan: 2, colSpan: 1, period: 1 })
    expect(slotLines(lecture.slot)).toEqual(['BCS502 (L)', 'PAG', 'B-321'])
  })

  it('stacks B1 and B2 two-period labs side by side (Mon P3–P4)', () => {
    const b1 = cellAt(grid, 1, 3, 'BCS551', 1)
    const b2 = cellAt(grid, 1, 3, 'BCS553', 2)

    expect(b1).toMatchObject({ lane: 0, laneSpan: 1, colSpan: 2 })
    expect(b2).toMatchObject({ lane: 1, laneSpan: 1, colSpan: 2 })
    expect(slotLines(b1.slot)).toEqual(['BCS551 (P) B1', 'KN B-114'])
    expect(slotLines(b2.slot)).toEqual(['BCS553 (P) B2', 'DUA B-113'])
  })

  it('stacks the Monday tutorials and electives without extra lanes', () => {
    expect(cellAt(grid, 1, 6, 'BCS502', 1)).toMatchObject({ lane: 0, colSpan: 1 })
    expect(cellAt(grid, 1, 6, 'BCS501', 2)).toMatchObject({ lane: 1, colSpan: 1 })
    expect(cellAt(grid, 1, 7, 'BCS503', 1)).toMatchObject({ lane: 0 })
    expect(cellAt(grid, 1, 7, 'BCS502', 2)).toMatchObject({ lane: 1 })

    const mnpm = cellAt(grid, 1, 8, 'MNPM501')
    const htcs = cellAt(grid, 1, 8, 'HTCS501')
    expect(mnpm).toMatchObject({ lane: 0, laneSpan: 1, colSpan: 1 })
    expect(htcs).toMatchObject({ lane: 1, laneSpan: 1, colSpan: 1 })
  })

  it('merges the Tuesday mini-project practical across two periods and lanes', () => {
    const miniProject = cellAt(grid, 2, 6, 'BCS554')
    expect(miniProject).toMatchObject({ lane: 0, laneSpan: 2, colSpan: 2, period: 6 })
    expect(slotLines(miniProject.slot)).toEqual(['BCS554 (P)', 'RUG/VB', 'B-321'])
  })

  it('merges SUPER - 30 on Wed and Fri across P7–P8', () => {
    const wednesday = activityAt(grid, 3, 7)
    const friday = activityAt(grid, 5, 7)

    expect(wednesday).toMatchObject({ lane: 0, laneSpan: 2, colSpan: 2 })
    expect(slotLines(wednesday.slot)).toEqual(['SUPER - 30'])
    expect(friday).toMatchObject({ lane: 0, laneSpan: 2, colSpan: 2 })
  })

  it('renders the Saturday activity blocks as merged cells', () => {
    const hobbies = activityAt(grid, 6, 1)
    const sports = activityAt(grid, 6, 3)
    const societies = activityAt(grid, 6, 5)

    expect(hobbies).toMatchObject({ laneSpan: 2, colSpan: 2 })
    expect(slotLines(hobbies.slot)).toEqual(['Hobbies Club / Literacy Society Activities'])
    expect(sports).toMatchObject({ laneSpan: 2, colSpan: 2 })
    expect(slotLines(sports.slot)).toEqual(['Sports'])
    expect(societies).toMatchObject({ laneSpan: 2, colSpan: 4 })
    expect(slotLines(societies.slot)).toEqual(['Department Societies Activities'])
  })

  it('keeps the Friday labs and tutorials on their own lanes', () => {
    expect(cellAt(grid, 5, 4, 'BCS501', 1)).toMatchObject({ lane: 0, colSpan: 1 })
    expect(cellAt(grid, 5, 4, 'BCS503', 2)).toMatchObject({ lane: 1, colSpan: 1 })
    expect(cellAt(grid, 5, 5, 'BCS552', 1)).toMatchObject({ lane: 0, colSpan: 2 })
    expect(cellAt(grid, 5, 5, 'BCS551', 2)).toMatchObject({ lane: 1, colSpan: 2 })
  })

  it('covers every period of every lane exactly once', () => {
    for (const day of grid.days) {
      const coverage = Array.from({ length: day.laneCount }, () =>
        Array.from({ length: PERIODS.length }, () => 0)
      )

      for (let lane = 0; lane < day.laneCount; lane += 1) {
        for (let column = 0; column < PERIODS.length; column += 1) {
          const cell = day.rows[lane][column]
          if (cell.type === 'slot') {
            for (let row = cell.lane; row < cell.lane + cell.laneSpan; row += 1) {
              for (let col = cell.period - 1; col < cell.period - 1 + cell.colSpan; col += 1) {
                coverage[row][col] += 1
              }
            }
          } else if (cell.type === 'empty') {
            coverage[lane][column] += 1
          }
        }
      }

      for (const laneCoverage of coverage) {
        expect(laneCoverage).toEqual(Array(PERIODS.length).fill(1))
      }
    }
  })
})

describe('12-hour timetable time formatting', () => {
  it('formats morning, noon, afternoon, and overnight clock hours', () => {
    expect(formatTime12Hour('00:05')).toBe('12:05 AM')
    expect(formatTime12Hour('09:05')).toBe('9:05 AM')
    expect(formatTime12Hour('12:00')).toBe('12:00 PM')
    expect(formatTime12Hour('17:20')).toBe('5:20 PM')
  })

  it('keeps matching meridiems compact and marks ranges crossing noon explicitly', () => {
    expect(formatTimeRange12Hour('09:05', '10:00')).toBe('9:05–10:00 AM')
    expect(formatTimeRange12Hour('11:50', '12:45')).toBe('11:50 AM–12:45 PM')
    expect(formatTimeRange12Hour('12:45', '13:40')).toBe('12:45–1:40 PM')
  })

  it('rejects malformed times rather than displaying a misleading value', () => {
    expect(() => formatTime12Hour('24:00')).toThrow(RangeError)
    expect(() => formatTime12Hour('9am')).toThrow(RangeError)
  })
})

describe('grid layout — lane and span rules', () => {
  it('adds a third lane when three parallel electives share a period', () => {
    const custom = buildGrid([
      fakeSlot({ id: 1, day: 2, start_period: 5, subject_code: 'MNPM501', elective_group: 'E1' }),
      fakeSlot({ id: 2, day: 2, start_period: 5, subject_code: 'HTCS501', elective_group: 'E1' }),
      fakeSlot({ id: 3, day: 2, start_period: 5, subject_code: 'BNC502', elective_group: 'E1' }),
      fakeSlot({ id: 4, day: 2, start_period: 1, subject_code: 'BCS502', teacher_codes: 'PAG' })
    ])

    const tuesday = dayOf(custom, 2)
    expect(tuesday.laneCount).toBe(3)
    expect(cellAt(custom, 2, 1, 'BCS502')).toMatchObject({ lane: 0, laneSpan: 3 })

    const elected = anchorsOf(tuesday)
      .filter((cell) => cell.period === 5)
      .map((cell) => cell.lane)
    expect(elected).toEqual([0, 1, 2])
  })

  it('puts B1 in lane 1 and B2 in lane 2 even when B2 is stored first', () => {
    const custom = buildGrid([
      fakeSlot({ id: 1, day: 3, start_period: 2, subject_code: 'BCS553', kind: 'P', batch_no: 2 }),
      fakeSlot({ id: 2, day: 3, start_period: 2, subject_code: 'BCS552', kind: 'P', batch_no: 1 })
    ])

    expect(cellAt(custom, 3, 2, 'BCS552', 1)).toMatchObject({ lane: 0 })
    expect(cellAt(custom, 3, 2, 'BCS553', 2)).toMatchObject({ lane: 1 })
  })

  it('never lets a span run across lunch or past P8', () => {
    expect(columnsFor({ start_period: 4, span: 2 })).toEqual({ start: 4, span: 1 })
    expect(columnsFor({ start_period: 3, span: 4 })).toEqual({ start: 3, span: 2 })
    expect(columnsFor({ start_period: 7, span: 4 })).toEqual({ start: 7, span: 2 })
    expect(columnsFor({ start_period: 9, span: 1 })).toEqual({ start: 8, span: 1 })
    expect(columnsFor({ start_period: 0, span: 1 })).toEqual({ start: 1, span: 1 })

    const guarded = buildGrid([
      fakeSlot({ day: 4, start_period: 4, span: 2, subject_code: 'BCS551', kind: 'P' })
    ])
    expect(cellAt(guarded, 4, 4, 'BCS551')).toMatchObject({ colSpan: 1 })
  })

  it('formats the three cell shapes the PDF uses', () => {
    expect(slotLines(fakeSlot({ kind: 'L', teacher_codes: 'VB/RUG', venue_code: 'B-321' }))).toEqual([
      'BCS501 (L)',
      'VB/RUG',
      'B-321'
    ])
    expect(
      slotLines(fakeSlot({ kind: 'T', batch_no: 2, teacher_codes: 'KN', venue_code: 'B-317' }))
    ).toEqual(['BCS501 (T) B2', 'KN B-317'])
    expect(
      slotLines(fakeSlot({ kind: 'ACTIVITY', label: 'SUPER - 30', venue_code: null }))
    ).toEqual(['SUPER - 30'])
    // An activity with a venue shows it under the label.
    expect(slotLines(fakeSlot({ kind: 'ACTIVITY', label: 'Sports', venue_code: 'B-321' }))).toEqual([
      'Sports',
      'B-321'
    ])
  })
})

describe('grid layout — activity lanes (issue 6)', () => {
  const tutorialA1 = fakeSlot({
    id: 1,
    day: 2,
    start_period: 7,
    subject_code: 'BCS551',
    kind: 'T',
    batch_no: 1,
    section_name: 'A'
  })
  const tutorialA2 = fakeSlot({
    id: 2,
    day: 2,
    start_period: 7,
    subject_code: 'BCS551',
    kind: 'T',
    batch_no: 2,
    section_name: 'A'
  })
  const sports = {
    id: 3,
    day: 2,
    start_period: 7,
    span: 2,
    kind: 'ACTIVITY',
    batch_no: null,
    elective_group: null,
    label: 'Sports',
    subject_code: null,
    section_name: 'A'
  }

  function rectanglesOf(grid) {
    const rectangles = []
    for (const day of grid.days) {
      for (const anchor of anchorsOf(day)) {
        rectangles.push({ day: day.day, anchor })
      }
    }
    return rectangles
  }

  function expectNoOverlap(grid) {
    const cells = new Map()
    for (const day of grid.days) {
      for (const anchor of anchorsOf(day)) {
        for (let row = anchor.lane; row < anchor.lane + anchor.laneSpan; row += 1) {
          for (let column = anchor.period - 1; column < anchor.period - 1 + anchor.colSpan; column += 1) {
            const key = `${day.day}-${row}-${column}`
            expect(cells.has(key), `overlap at ${key}`).toBe(false)
            cells.set(key, anchor.slot.id)
          }
        }
      }
    }
  }

  it('puts the activity in its own third lane below both tutorials', () => {
    const grid = buildGrid([tutorialA1, tutorialA2, sports])
    const tuesday = dayOf(grid, 2)
    const anchors = anchorsOf(tuesday)

    expect(tuesday.laneCount).toBe(3)
    expect(anchors.find((cell) => cell.slot.id === 1)).toMatchObject({ lane: 0, laneSpan: 1 })
    expect(anchors.find((cell) => cell.slot.id === 2)).toMatchObject({ lane: 1, laneSpan: 1 })
    expect(anchors.find((cell) => cell.slot.id === 3)).toMatchObject({
      lane: 2,
      laneSpan: 1,
      colSpan: 2
    })
    expect(grid.collisions).toEqual([])
    expectNoOverlap(grid)
  })

  it('keeps a whole-section class in the class lanes, above the activity lane', () => {
    const lecture = fakeSlot({
      id: 4,
      day: 2,
      start_period: 7,
      subject_code: 'BCS501',
      kind: 'L'
    })
    const grid = buildGrid([lecture, sports])
    const tuesday = dayOf(grid, 2)
    const anchors = anchorsOf(tuesday)

    expect(tuesday.laneCount).toBe(3) // two class lanes + one activity lane
    expect(anchors.find((cell) => cell.slot.id === 4)).toMatchObject({ lane: 0, laneSpan: 2 })
    expect(anchors.find((cell) => cell.slot.id === 3)).toMatchObject({ lane: 2, laneSpan: 1 })
    expectNoOverlap(grid)
  })

  it('still spans every lane when the activity overlaps no class', () => {
    const lecture = fakeSlot({ id: 5, day: 2, start_period: 1, subject_code: 'BCS502' })
    const grid = buildGrid([lecture, sports])
    const tuesday = dayOf(grid, 2)

    expect(tuesday.laneCount).toBe(2)
    expect(anchorsOf(tuesday).find((cell) => cell.slot.id === 3)).toMatchObject({
      lane: 0,
      laneSpan: 2
    })
    expectNoOverlap(grid)
  })

  it('never overlaps a rectangle in the seeded Section B sheet', () => {
    const db = freshDb()
    const ids = seedSectionB(db)
    const grid = buildGrid(timetableCore.sectionSlots(db, ids.sectionId))
    db.close()

    expect(grid.collisions).toEqual([])
    expectNoOverlap(grid)
    expect(rectanglesOf(grid).length).toBe(43)
  })
})
