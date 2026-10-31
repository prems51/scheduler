// sheetModel.js — pure description of the printed department sheet, shared by
// the main process (Excel export) and the renderer (Export page labels).
// No React, no Electron, no database: callers hand in the slot rows that the
// IPC channels already return (slots:listBySection / views:faculty / views:venue).

import {
  PERIODS,
  LUNCH,
  buildGrid,
  formatTime12Hour,
  formatTimeRange12Hour,
  slotLines,
  viewLines
} from './gridLayout.js'
import { buildLegend } from './legend.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

/** 2026-07-14 -> 14-07-2026, the way the department sheet writes w.e.f. */
function formatDate(value) {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text
}

/** "Students Timetable 2026-27 (Odd Semester)" -> "2026-27 (Odd Semester)" */
function titleQualifier(timetable) {
  return String(timetable?.title ?? '')
    .replace(/^students\s+timetable\s*/i, '')
    .trim()
}

/** Cell lines the section sheet shows on a slot, exactly like the master grid. */
function masterLines(slot) {
  return slotLines(slot)
}

/**
 * Builds everything both the page and the workbook need:
 *   labels { short, long, fileBase }  — side label, heading and filename stem
 *   header { lines }                  — college / department / title / w.e.f. / meta
 *   grid { days, totalLaneRows }      — lane layout, each slot cell pre-rendered
 *   legend [ { code, name, teachers, teacherNames } ]
 *   footer { coordinator, convener }
 */
export function buildSheetModel(
  kind,
  { rows = [], timetable = null, section = null, entity = null, teachers = [] } = {}
) {
  const linesFor =
    kind === 'section'
      ? masterLines
      : (slot) => viewLines(slot, kind === 'faculty' ? 'faculty' : 'venue')

  const grid = buildGrid(rows)
  const gridDays = grid.days.map((day) => ({
    day: day.day,
    label: day.label,
    laneCount: day.laneCount,
    lanes: day.rows.map((row) =>
      row.map((cell) => {
        if (cell.type !== 'slot') return cell
        return {
          type: 'slot',
          slot: cell.slot,
          lane: cell.lane,
          laneSpan: cell.laneSpan,
          colSpan: cell.colSpan,
          period: cell.period,
          lines: linesFor(cell.slot),
          shade: String(cell.slot.kind || 'l').toLowerCase()
        }
      })
    )
  }))

  const qualifier = titleQualifier(timetable)
  const effective = timetable?.effective_from ? `w.e.f. ${formatDate(timetable.effective_from)}` : ''

  let header
  let labels
  if (kind === 'section') {
    const semesterRoman = ROMAN[section?.semester] ?? String(section?.semester ?? '')
    header = {
      college: 'MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD',
      department: 'Department of Computer Science & Engineering',
      title: String(timetable?.title ?? '').toUpperCase(),
      effective,
      metaLeft: section ? `Semester: ${semesterRoman} - ${section.name}` : '',
      metaRight: section ? `Class O.C.: ${section.class_oc || '—'}` : '',
      counselors: section?.counselors ? `Counselors: ${section.counselors}` : ''
    }
    const short = section ? `Semester ${semesterRoman} - ${section.name}` : 'Section'
    labels = {
      short,
      fileBase: `Section ${semesterRoman}-${section?.name ?? ''} timetable`,
      sheet: `Section ${semesterRoman}-${section?.name ?? ''}`
    }
  } else if (kind === 'faculty') {
    const name = String(entity?.name ?? '').trim()
    const code = String(entity?.code ?? '').trim()
    header = {
      college: 'MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD',
      department: 'Department of Computer Science & Engineering',
      title: `FACULTY TIMETABLE: ${name}${code ? ` (${code})` : ''} ${qualifier}`.replace(/\s+/g, ' ').trim(),
      effective,
      metaLeft: '',
      metaRight: '',
      counselors: ''
    }
    labels = {
      short: `${code} ${name}`.trim(),
      fileBase: `Faculty ${code} timetable`,
      sheet: `Faculty ${code}`
    }
  } else {
    const name = String(entity?.name ?? '').trim()
    const code = String(entity?.code ?? '').trim()
    header = {
      college: 'MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD',
      department: 'Department of Computer Science & Engineering',
      title: `VENUE TIMETABLE: ${code}${name ? ` (${name})` : ''} ${qualifier}`.replace(/\s+/g, ' ').trim(),
      effective,
      metaLeft: '',
      metaRight: '',
      counselors: ''
    }
    labels = { short: code, fileBase: `Venue ${code} timetable`, sheet: `Venue ${code}` }
  }

  return {
    kind,
    labels,
    header,
    periodHeader: PERIODS.map((period) => ({
      no: period.no,
      label: `P${period.no}`,
      startTime: formatTime12Hour(period.start),
      endTime: formatTime12Hour(period.end),
      time: formatTimeRange12Hour(period.start, period.end)
    })),
    lunch: {
      label: 'LUNCH',
      startTime: formatTime12Hour(LUNCH.start),
      endTime: formatTime12Hour(LUNCH.end),
      time: formatTimeRange12Hour(LUNCH.start, LUNCH.end)
    },
    grid: { days: gridDays, totalLaneRows: grid.totalLaneRows, collisions: grid.collisions },
    legend: buildLegend(rows, { teachers }),
    footer: {
      coordinator: timetable?.coordinator || '',
      convener: timetable?.convener || ''
    }
  }
}

/** One workbook sheet name: sanitized, deduped, at most 31 Excel-safe characters. */
export function sheetNameFor(sheetModel, taken = new Set()) {
  const base =
    String(sheetModel.labels?.sheet ?? 'Sheet')
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim() || 'Sheet'
  let name = base.slice(0, 31).trim() || 'Sheet'
  if (taken.has(name.toLowerCase())) {
    let serial = 2
    let candidate = ''
    const stem = name.slice(0, 28)
    do {
      candidate = `${stem} (${serial})`.slice(0, 31)
      serial += 1
    } while (taken.has(candidate.toLowerCase()))
    name = candidate
  }
  taken.add(name.toLowerCase())
  return name
}
