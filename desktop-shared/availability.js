// availability.js — pure helpers for timing requests (availability).
// No database and no React here: the engine uses the period/list helpers and
// the Constraints page uses the brush, presets and "request by time" logic.
// Unit-tested in tests/availability-pure.test.js.

export const AVAILABILITY_TARGETS = ['teacher', 'venue', 'section']
export const AVAILABILITY_LEVELS = ['cannot', 'avoid']

export const AVAILABILITY_DAY_LABELS = [
  '',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat'
]

export const DAY_NUMBERS = [1, 2, 3, 4, 5, 6]
export const PERIOD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8]

/** Presets offered by the toolbar. They paint with the active brush. */
export const AVAILABILITY_PRESETS = [
  { id: 'mornings', label: 'All mornings (P1–P4)' },
  { id: 'afternoons', label: 'All afternoons (P5–P8)' },
  { id: 'first', label: 'First period every day' },
  { id: 'last', label: 'Last period every day' },
  { id: 'saturday', label: 'Saturday' },
  { id: 'friday-afternoon', label: 'Friday afternoon' }
]

export function cellKey(day, period) {
  return `${Number(day)}-${Number(period)}`
}

function validCell(day, period) {
  return (
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 6 &&
    Number.isInteger(period) &&
    period >= 1 &&
    period <= 8
  )
}

/** Sorts, de-duplicates and drops invalid cells. */
export function normalizeCells(cells = []) {
  const map = new Map()
  for (const cell of cells ?? []) {
    const day = Number(cell?.day)
    const period = Number(cell?.period)
    const level = cell?.level
    if (!validCell(day, period)) continue
    if (!AVAILABILITY_LEVELS.includes(level)) continue
    map.set(cellKey(day, period), { day, period, level })
  }
  return [...map.values()].sort(
    (left, right) => left.day - right.day || left.period - right.period
  )
}

/** A Map of "day-period" -> level, handy for the grid. */
export function cellsToLevelMap(cells = []) {
  return new Map(normalizeCells(cells).map((cell) => [cellKey(cell.day, cell.period), cell.level]))
}

/**
 * Paints every point with `level`. A null/undefined level erases (Free brush).
 * Returns a new sorted cell list; the input is never mutated.
 */
export function paintCells(cells = [], points = [], level = null) {
  const map = new Map(normalizeCells(cells).map((cell) => [cellKey(cell.day, cell.period), cell]))
  for (const point of points ?? []) {
    const day = Number(point?.day)
    const period = Number(point?.period)
    if (!validCell(day, period)) continue
    if (level === null || level === undefined || level === 'free') {
      map.delete(cellKey(day, period))
    } else if (AVAILABILITY_LEVELS.includes(level)) {
      map.set(cellKey(day, period), { day, period, level })
    }
  }
  return normalizeCells([...map.values()])
}

/** Every cell between two corners (inclusive), for click-and-drag painting. */
export function rectangleCells(from, to) {
  const fromDay = Number(from?.day)
  const fromPeriod = Number(from?.period)
  const toDay = Number(to?.day)
  const toPeriod = Number(to?.period)
  if (!validCell(fromDay, fromPeriod) || !validCell(toDay, toPeriod)) return []

  const dayStart = Math.min(fromDay, toDay)
  const dayEnd = Math.max(fromDay, toDay)
  const periodStart = Math.min(fromPeriod, toPeriod)
  const periodEnd = Math.max(fromPeriod, toPeriod)
  const points = []
  for (let day = dayStart; day <= dayEnd; day += 1) {
    for (let period = periodStart; period <= periodEnd; period += 1) points.push({ day, period })
  }
  return points
}

export function dayCells(day) {
  return PERIOD_NUMBERS.map((period) => ({ day: Number(day), period }))
}

export function periodCells(period) {
  return DAY_NUMBERS.map((day) => ({ day, period: Number(period) }))
}

/** Points for one of AVAILABILITY_PRESETS (invalid ids return []). */
export function presetPoints(presetId) {
  const id = String(presetId ?? '')
  if (id === 'mornings') {
    return DAY_NUMBERS.flatMap((day) => [1, 2, 3, 4].map((period) => ({ day, period })))
  }
  if (id === 'afternoons') {
    return DAY_NUMBERS.flatMap((day) => [5, 6, 7, 8].map((period) => ({ day, period })))
  }
  if (id === 'first') return DAY_NUMBERS.map((day) => ({ day, period: 1 }))
  if (id === 'last') return DAY_NUMBERS.map((day) => ({ day, period: 8 }))
  if (id === 'saturday') return dayCells(6)
  if (id === 'friday-afternoon') return [5, 6, 7, 8].map((period) => ({ day: 5, period }))
  return []
}

/** [1,2,3,5] -> "P1–P3, P5"; [] -> "" */
export function formatPeriodList(periods = []) {
  const numbers = [...new Set((periods ?? []).map(Number).filter(Number.isFinite))].sort(
    (left, right) => left - right
  )
  if (!numbers.length) return ''

  const runs = []
  let start = numbers[0]
  let previous = numbers[0]
  for (const number of numbers.slice(1)) {
    if (number === previous + 1) {
      previous = number
      continue
    }
    runs.push([start, previous])
    start = number
    previous = number
  }
  runs.push([start, previous])

  return runs
    .map(([from, to]) => (from === to ? `P${from}` : `P${from}–P${to}`))
    .join(', ')
}

/** 545 or '09:05' -> 545 minutes past midnight. */
export function timeToMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  if (hour > 23) return null
  return hour * 60 + Number(match[2])
}

function minutesToTime(minutes) {
  const total = Math.max(0, Math.trunc(Number(minutes) || 0))
  const hour = Math.floor(total / 60)
  const minute = total % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Periods whose overlap with [fromMinutes, toMinutes] is at least 50% of the
 * period's own length. `periodRows` may be the periods table ({no,start_time,
 * end_time}) or gridLayout's PERIODS ({no,start,end}).
 */
export function selectPeriodsForRange(periodRows = [], fromMinutes, toMinutes) {
  const from = Number(fromMinutes)
  const to = Number(toMinutes)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []

  return (periodRows ?? [])
    .filter((row) => {
      const start = timeToMinutes(row.start_time ?? row.start)
      const end = timeToMinutes(row.end_time ?? row.end)
      if (start === null || end === null || end <= start) return false
      const overlap = Math.min(end, to) - Math.max(start, from)
      return overlap > 0 && overlap * 2 >= end - start
    })
    .map((row) => Number(row.no))
}

/**
 * The "Add a request by time" form: days x periods, plus the sentence the page
 * shows back to the professor (e.g. "Mon, Tue: P1, P2 (09:05–10:55)").
 */
export function applyRequestByTime({ days = [], from = null, to = null, periodRows = [] } = {}) {
  const dayNumbers = [...new Set((days ?? []).map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 6)
    .sort((left, right) => left - right)

  const fromMinutes = timeToMinutes(from)
  const toMinutes = timeToMinutes(to)
  const periods = selectPeriodsForRange(periodRows, fromMinutes, toMinutes)
  const points = dayNumbers.flatMap((day) => periods.map((period) => ({ day, period })))

  let summary
  if (!fromMinutes && fromMinutes !== 0) {
    summary = 'Enter a start time.'
  } else if (!toMinutes && toMinutes !== 0) {
    summary = 'Enter an end time.'
  } else if (toMinutes <= fromMinutes) {
    summary = 'The end time must be after the start time.'
  } else if (!dayNumbers.length) {
    summary = 'Pick at least one day.'
  } else if (!periods.length) {
    summary = `No period overlaps ${minutesToTime(fromMinutes)}–${minutesToTime(toMinutes)}.`
  } else {
    const selected = (periodRows ?? []).filter((row) => periods.includes(Number(row.no)))
    const first = selected[0]
    const last = selected[selected.length - 1]
    const startLabel = String(first.start_time ?? first.start)
    const endLabel = String(last.end_time ?? last.end)
    const dayLabel = dayNumbers.map((day) => AVAILABILITY_DAY_LABELS[day]).join(', ')
    // The form lists the periods it picked ("P1, P2") so she can verify the
    // range; the compact "P1–P2" form is for the constraint messages.
    const picked = periods.map((period) => `P${period}`).join(', ')
    summary = `${dayLabel}: ${picked} (${startLabel}–${endLabel})`
  }

  return { days: dayNumbers, periods, points, summary }
}
