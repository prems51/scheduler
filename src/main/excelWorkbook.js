// excelWorkbook.js — writes the department-format .xlsx workbooks with exceljs.
// Deliberately Electron-free so tests (and scripts) can use it in plain Node;
// src/main/exportExcel.js wraps it with dialogs and IPC.

import ExcelJS from 'exceljs'
import { LUNCH_AFTER } from '../../desktop-shared/gridLayout.js'
import { sheetNameFor } from '../../desktop-shared/sheetModel.js'
import { splitLegend } from '../../desktop-shared/legend.js'

const FONT = 'Calibri'
const GRID_COLUMNS = 10 // 1 day + P1..P4 + lunch + P5..P8
const MIN_FONT_SIZE = 8
const DEFAULT_ROW_HEIGHT = 15
// Round-4 Issue 4: 38 pt per day before scaling, split over the day's lanes —
// an empty day keeps the same height as a booked one.
const LANE_ROW_HEIGHT = 19

const THIN = { style: 'thin', color: { argb: 'FF404040' } }
const BORDER_ALL = { top: THIN, bottom: THIN, left: THIN, right: THIN }
const CENTERED = { vertical: 'middle', horizontal: 'center', wrapText: true }

const SHADES = {
  l: null, // lecture: white
  t: 'FFDDEBF7', // tutorial: light blue, like the app's grid
  p: 'FFE2EFDA', // practical: light green
  activity: 'FFFFF2CC', // activity: light yellow
  head: 'FFF2F2F2',
  lunch: 'FFF2F2F2'
}

/** 1 -> A, 10 -> J (the print area covers exactly the grid's 10 columns). */
function columnLetter(number) {
  let text = ''
  while (number > 0) {
    const remainder = (number - 1) % 26
    text = String.fromCharCode(65 + remainder) + text
    number = Math.floor((number - 1) / 26)
  }
  return text
}

function font(size, { bold = false, italic = false } = {}) {
  return { name: FONT, size, bold, italic, color: { argb: 'FF1F2327' } }
}

function wrappedLineCount(value, width, size) {
  const charsPerLine = Math.max(1, Math.floor((width * 11 * 1.08) / size))
  return String(value ?? '')
    .split('\n')
    .reduce((lineCount, textLine) => {
      const words = textLine.split(/\s+/).filter(Boolean)
      if (words.length === 0) return lineCount + 1

      let lines = 1
      let lineLength = 0
      for (const word of words) {
        if (word.length > charsPerLine) {
          if (lineLength > 0) {
            lines += 1
            lineLength = 0
          }
          const wordLines = Math.ceil(word.length / charsPerLine)
          lines += wordLines - 1
          lineLength = word.length % charsPerLine
          continue
        }
        if (lineLength === 0) {
          lineLength = word.length
        } else if (lineLength + word.length + 1 <= charsPerLine) {
          lineLength += word.length + 1
        } else {
          lines += 1
          lineLength = word.length
        }
      }
      return lineCount + lines
    }, 0)
}

function contentFontSize(value, width, size) {
  let adjustedSize = size
  while (adjustedSize > MIN_FONT_SIZE && wrappedLineCount(value, width, adjustedSize) > 5) {
    adjustedSize = Math.max(MIN_FONT_SIZE, adjustedSize - 0.5)
  }
  return adjustedSize
}

function requiredHeight(value, size, width) {
  const lines = wrappedLineCount(value, width, size)
  return Math.ceil(lines * size * 1.15 + 4)
}

function ensureRowHeight(ws, top, bottom, height, minimumHeight) {
  if (top === bottom) {
    const row = ws.getRow(top)
    row.height = Math.max(row.height ?? DEFAULT_ROW_HEIGHT, minimumHeight, height)
    return
  }

  const rows = []
  let totalHeight = 0
  for (let rowNumber = top; rowNumber <= bottom; rowNumber += 1) {
    const row = ws.getRow(rowNumber)
    rows.push(row)
    totalHeight += row.height ?? DEFAULT_ROW_HEIGHT
  }

  const targetHeight = Math.max(height, minimumHeight * rows.length)
  if (totalHeight >= targetHeight) return

  const extraPerRow = (targetHeight - totalHeight) / rows.length
  for (const row of rows) row.height = (row.height ?? DEFAULT_ROW_HEIGHT) + extraPerRow
}

/**
 * Writes one value into a (possibly merged) range and paints the whole range
 * with borders / fill / alignment. Value and alignment live on the master
 * cell; borders are painted per address so Excel draws the full outline.
 */
function styled(ws, top, left, ...rest) {
  // Single cell: styled(ws, 3, 2, { value }); range: styled(ws, 3, 2, 5, 8, { value }).
  let bottom = top
  let right = left
  let options = {}
  if (rest.length && rest[0] && typeof rest[0] === 'object') {
    options = rest[0]
  } else {
    bottom = rest[0] ?? top
    right = rest[1] ?? bottom
    options = rest[2] ?? {}
  }

  const {
    value,
    size = 9,
    bold = false,
    italic = false,
    fill = null,
    align = CENTERED,
    noBorder = false,
    minimumHeight = DEFAULT_ROW_HEIGHT
  } = options
  const width = Array.from({ length: right - left + 1 }, (_, index) => ws.getColumn(left + index).width ?? 8.43)
    .reduce((total, columnWidth) => total + columnWidth, 0)
  const cellFontSize = contentFontSize(value, width, size)
  if (value !== undefined) ws.getCell(top, left).value = value
  if (bottom > top || right > left) ws.mergeCells(top, left, bottom, right)

  const base = { font: font(cellFontSize, { bold, italic }), alignment: align }
  if (fill) base.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill }, bgColor: { argb: fill } }
  if (!noBorder) base.border = BORDER_ALL

  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) {
      const cell = ws.getCell(r, c)
      Object.assign(cell, base)
    }
  }

  if (value !== undefined) {
    ensureRowHeight(ws, top, bottom, requiredHeight(value, cellFontSize, width), minimumHeight)
  }
}

function kindFill(shade) {
  const key = String(shade || 'l').toLowerCase()
  if (key === 'act') return SHADES.activity
  return SHADES[key] ?? null
}

/** Column letter helpers for nothing — exceljs takes (row, col) numbers. */
function lunchColumn() {
  return LUNCH_AFTER + 2 // P1..P4 -> columns 2..5, lunch -> 6
}

function periodColumn(periodNo) {
  // P5..P8 shift right of the lunch column.
  return periodNo <= LUNCH_AFTER ? periodNo + 1 : periodNo + 2
}

/** Title block: college, department, sheet title, w.e.f. and the meta lines. */
function writeHeader(ws, model) {
  const { college, department, title, effective, metaLeft, metaRight, counselors } = model.header

  styled(ws, 1, 1, 1, GRID_COLUMNS, {
    value: college,
    size: 14,
    bold: true,
    noBorder: true,
    minimumHeight: 20
  })
  styled(ws, 2, 1, 2, GRID_COLUMNS, { value: department, size: 11, noBorder: true, minimumHeight: 16 })
  styled(ws, 3, 1, 3, GRID_COLUMNS, { value: title, size: 11, bold: true, noBorder: true, minimumHeight: 16 })

  let r = 4
  if (effective) {
    styled(ws, r, 1, r, GRID_COLUMNS, {
      value: effective,
      size: 10,
      italic: true,
      noBorder: true,
      minimumHeight: 16
    })
    r += 1
  }
  // Round-4 Issue 3: Semester / Class O.C. / Counselors on ONE bordered row,
  // split 20% / 30% / 50% like the printed sheet.
  if (metaLeft || metaRight || counselors) {
    styled(ws, r, 1, r, 2, { value: metaLeft, size: 10, minimumHeight: 16 })
    styled(ws, r, 3, r, 5, { value: metaRight, size: 10, minimumHeight: 16 })
    styled(ws, r, 6, r, GRID_COLUMNS, { value: counselors, size: 10, minimumHeight: 16 })
    r += 1
  }
  return r // first free row (no blank row yet)
}

/** Period header row: keep each full time on its own line to fit period columns. */
function writePeriodHeader(ws, model, row) {
  ws.getRow(row).height = 36
  styled(ws, row, 1, { value: 'DAY', size: 9, bold: true, fill: SHADES.head })
  for (const period of model.periodHeader) {
    styled(ws, row, periodColumn(period.no), {
      value: `${period.label}\n${period.startTime}\n${period.endTime}`,
      size: 9,
      bold: true,
      fill: SHADES.head
    })
  }
  styled(ws, row, lunchColumn(), {
    value: `${model.lunch.startTime}\n${model.lunch.endTime}`,
    size: 8,
    bold: true,
    fill: SHADES.lunch
  })
  return row + 1
}

/**
 * The grid: one lane row per day sub-row, with the exact merges of the
 * on-screen grid (colSpan for labs, laneSpan for whole-section slots).
 * Cells keep the same kind shading as the app.
 */
function writeGrid(ws, model, startRow) {
  const totalLaneRows = model.grid.totalLaneRows
  const endRow = startRow + totalLaneRows - 1

  for (let row = startRow; row <= endRow; row += 1) ws.getRow(row).height = LANE_ROW_HEIGHT

  // LUNCH spans every lane row of the sheet in one merged column.
  styled(ws, startRow, lunchColumn(), endRow, lunchColumn(), {
    value: model.lunch.label,
    size: 8,
    italic: true,
    fill: SHADES.lunch,
    align: { ...CENTERED, textRotation: 'vertical' }
  })

  let r = startRow
  for (const day of model.grid.days) {
    styled(ws, r, 1, r + day.laneCount - 1, 1, { value: day.label, size: 9, bold: true, fill: SHADES.head })

    day.lanes.forEach((lane, laneIndex) => {
      for (const cell of lane) {
        if (cell.type !== 'slot') continue
        const column = periodColumn(cell.period)
        const bottom = r + laneIndex + cell.laneSpan - 1
        const right = column + cell.colSpan - 1
        const isActivity = String(cell.slot.kind || '').toUpperCase() === 'ACTIVITY'
        styled(ws, r + laneIndex, column, bottom, right, {
          value: cell.lines.join('\n'),
          size: 9,
          bold: isActivity,
          fill: kindFill(cell.shade),
          minimumHeight: LANE_ROW_HEIGHT
        })
      }
    })

    r += day.laneCount
  }

  return endRow
}

/**
 * Legend below the grid, in the department sheet's two column groups:
 * code | subject name | faculty code | faculty name, twice side by side.
 * The ten grid columns split into 5 + 5.
 */
function writeLegend(ws, model, startRow) {
  const entries = model.legend
  styled(ws, startRow, 1, startRow, GRID_COLUMNS, {
    value: 'Legend',
    size: 10,
    bold: true,
    noBorder: true,
    align: { vertical: 'middle', horizontal: 'left' }
  })

  const headRow = startRow + 1
  const fields = [
    { from: 1, to: 1, label: 'Subject Code' },
    { from: 2, to: 3, label: 'Subject Name' },
    { from: 4, to: 4, label: 'Faculty Code' },
    { from: 5, to: 5, label: 'Faculty Name' }
  ]

  for (const offset of [0, 5]) {
    for (const field of fields) {
      styled(ws, headRow, field.from + offset, headRow, field.to + offset, {
        value: field.label,
        size: 9,
        bold: true,
        fill: SHADES.head
      })
    }
  }

  const { rowCount, left, right } = splitLegend(entries)
  let r = headRow + 1

  for (let index = 0; index < rowCount; index += 1) {
    for (const [offset, entry] of [
      [0, left[index]],
      [5, right[index]]
    ]) {
      if (!entry) continue
      styled(ws, r, 1 + offset, { value: entry.code, size: 9, bold: true })
      styled(ws, r, 2 + offset, r, 3 + offset, { value: entry.name, size: 9 })
      styled(ws, r, 4 + offset, { value: entry.teachers || '—', size: 9 })
      styled(ws, r, 5 + offset, { value: entry.teacherNames || '—', size: 8 })
    }
    r += 1
  }
  return r
}

/** Coordinator — convener signature line. */
function writeFooter(ws, model, row) {
  styled(ws, row, 1, row, 5, {
    value: `Coordinator: ${model.footer.coordinator || '—'}`,
    size: 10,
    bold: true,
    noBorder: true
  })
  styled(ws, row, 6, row, GRID_COLUMNS, {
    value: `Convener: ${model.footer.convener || '—'}`,
    size: 10,
    bold: true,
    noBorder: true
  })
  return row + 1
}

/** One sheet model -> one worksheet laid out like the department PDF. */
function writeSheet(wb, model, sheetName) {
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] })

  const COLUMN_WIDTHS = [12, 11, 11, 11, 11, 4, 11, 11, 11, 11]
  COLUMN_WIDTHS.forEach((width, index) => {
    ws.getColumn(index + 1).width = width
  })

  // Same one-page contract as the PDF export (round-3 Issue 5): landscape A4,
  // fit to exactly one page wide and tall, centred, narrow margins, and a
  // print area covering header + grid + legend + signature line.
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    horizontalCentered: true,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  }

  let r = writeHeader(ws, model)
  r += 1 // blank spacer row
  r = writePeriodHeader(ws, model, r)
  r = writeGrid(ws, model, r)

  r += 2 // blank spacer before the legend
  r = writeLegend(ws, model, r)
  r += 1
  const lastRow = writeFooter(ws, model, r)
  ws.pageSetup.printArea = `A1:${columnLetter(GRID_COLUMNS)}${lastRow - 1}`
}

/**
 * models: array of sheet models -> one workbook.
 * Empty entries must be filtered out by the caller; every model gets a sheet.
 */
export async function buildWorkbook(models) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Timetable Manager — CSE Department, MIT Moradabad'
  wb.created = new Date()

  const taken = new Set()
  for (const model of models) writeSheet(wb, model, sheetNameFor(model, taken))
  return wb
}

export async function saveWorkbook(models, filePath) {
  const wb = await buildWorkbook(models)
  await wb.xlsx.writeFile(filePath)
  return filePath
}
