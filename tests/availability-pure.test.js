import { describe, expect, it } from 'vitest'
import {
  applyRequestByTime,
  cellsToLevelMap,
  cellKey,
  formatPeriodList,
  paintCells,
  presetPoints,
  rectangleCells,
  selectPeriodsForRange,
  timeToMinutes
} from '../desktop-shared/availability.js'
import { PERIODS } from '../desktop-shared/gridLayout.js'

// The real period grid, in the shape the periods table returns.
const PERIOD_ROWS = PERIODS.map((period) => ({
  no: period.no,
  start_time: period.start,
  end_time: period.end
}))

describe('compact period list', () => {
  it('joins consecutive periods into a range and keeps gaps apart', () => {
    expect(formatPeriodList([1, 2])).toBe('P1–P2')
    expect(formatPeriodList([2, 1])).toBe('P1–P2')
    expect(formatPeriodList([1, 2, 4, 5, 6])).toBe('P1–P2, P4–P6')
    expect(formatPeriodList([3])).toBe('P3')
    expect(formatPeriodList([])).toBe('')
  })
})

describe('brush painting', () => {
  const base = [
    { day: 1, period: 1, level: 'cannot' },
    { day: 2, period: 8, level: 'avoid' }
  ]

  it('paints points with the active level without mutating the input', () => {
    const painted = paintCells(base, [{ day: 1, period: 2 }, { day: 1, period: 3 }], 'avoid')
    const map = cellsToLevelMap(painted)
    expect(map.get('1-1')).toBe('cannot')
    expect(map.get('1-2')).toBe('avoid')
    expect(map.get('1-3')).toBe('avoid')
    expect(map.get('2-8')).toBe('avoid')
    expect(painted).toHaveLength(4)
    expect(base).toHaveLength(2)
  })

  it('the Free brush erases cells', () => {
    const cleared = paintCells(base, [{ day: 1, period: 1 }], null)
    expect(cellsToLevelMap(cleared).has('1-1')).toBe(false)
    expect(cleared).toHaveLength(1)
  })

  it('a drag paints the whole rectangle between its corners', () => {
    const rectangle = rectangleCells({ day: 1, period: 2 }, { day: 2, period: 3 })
    expect(rectangle).toEqual([
      { day: 1, period: 2 },
      { day: 1, period: 3 },
      { day: 2, period: 2 },
      { day: 2, period: 3 }
    ])
    expect(cellKey(3, 4)).toBe('3-4')
  })

  it('the presets cover the periods their labels promise', () => {
    expect(presetPoints('mornings')).toHaveLength(6 * 4)
    expect(presetPoints('afternoons')).toHaveLength(6 * 4)
    expect(presetPoints('first')).toEqual([
      { day: 1, period: 1 },
      { day: 2, period: 1 },
      { day: 3, period: 1 },
      { day: 4, period: 1 },
      { day: 5, period: 1 },
      { day: 6, period: 1 }
    ])
    expect(presetPoints('last')).toHaveLength(6)
    expect(presetPoints('saturday')).toHaveLength(8)
    expect(presetPoints('friday-afternoon')).toEqual([
      { day: 5, period: 5 },
      { day: 5, period: 6 },
      { day: 5, period: 7 },
      { day: 5, period: 8 }
    ])
  })
})

describe('periodsInRange / applyRequestByTime', () => {
  it('keeps a period whose overlap with the range is at least 50%', () => {
    expect(timeToMinutes('09:05')).toBe(545)
    expect(selectPeriodsForRange(PERIOD_ROWS, 540, 660)).toEqual([1, 2])
    expect(selectPeriodsForRange(PERIOD_ROWS, 840, 1040)).toEqual([5, 6, 7, 8])
    expect(selectPeriodsForRange(PERIOD_ROWS, 765, 820)).toEqual([])
    // 10:00-10:30 overlaps P2 by 30 of 55 minutes = 54.5% -> included.
    expect(selectPeriodsForRange(PERIOD_ROWS, 600, 630)).toEqual([2])
    expect(selectPeriodsForRange(PERIOD_ROWS, 700, 700)).toEqual([])
  })

  it('turns 9:00-11:00 into P1 and P2 with a readable sentence', () => {
    const result = applyRequestByTime({
      days: [1, 2],
      from: '09:00',
      to: '11:00',
      periodRows: PERIOD_ROWS
    })
    expect(result.periods).toEqual([1, 2])
    expect(result.points).toEqual([
      { day: 1, period: 1 },
      { day: 1, period: 2 },
      { day: 2, period: 1 },
      { day: 2, period: 2 }
    ])
    expect(result.summary).toBe('Mon, Tue: P1, P2 (09:05–10:55)')
  })

  it('explains an empty result instead of painting nothing silently', () => {
    const result = applyRequestByTime({
      days: [1],
      from: '12:45',
      to: '13:40',
      periodRows: PERIOD_ROWS
    })
    expect(result.periods).toEqual([])
    expect(result.summary).toBe('No period overlaps 12:45–13:40.')
  })
})
