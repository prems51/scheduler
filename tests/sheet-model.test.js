import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import timetableCore from '../timetable-core.js'
import seedModule from '../scripts/seed-section-b.js'
import { buildSheetModel, sheetNameFor } from '../desktop-shared/sheetModel.js'
import { saveWorkbook } from '../src/main/excelWorkbook'

const { seedSectionB } = seedModule
const { SECTION } = seedModule
const here = dirname(fileURLToPath(import.meta.url))

let db
let seeded
let tempDir
let sectionModelCache

beforeAll(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'))
  seeded = seedSectionB(db)
  tempDir = mkdtempSync(join(tmpdir(), 'sheet-model-'))
})

afterAll(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

function sectionRows() {
  return timetableCore.sectionSlots(db, seeded.sectionId)
}

function sectionMeta() {
  return {
    timetable: db.prepare('SELECT * FROM timetables WHERE id = ?').get(seeded.timetableId),
    section: db.prepare('SELECT * FROM sections WHERE id = ?').get(seeded.sectionId),
    teachers: db.prepare('SELECT id, code, name FROM teachers').all()
  }
}

export function modelOf(kind) {
  if (kind === 'section') {
    if (!sectionModelCache) {
      const { timetable, section, teachers } = sectionMeta()
      sectionModelCache = buildSheetModel('section', { rows: sectionRows(), timetable, section, teachers })
    }
    return sectionModelCache
  }
  const timetable = db.prepare('SELECT * FROM timetables WHERE id = ?').get(seeded.timetableId)
  if (kind === 'faculty') {
    const rows = timetableCore.facultyTimetable(db, seeded.timetableId, seeded.teacherIds.KN)
    const teacher = db.prepare('SELECT id, code, name FROM teachers WHERE id = ?').get(seeded.teacherIds.KN)
    return buildSheetModel('faculty', { rows, timetable, entity: teacher })
  }
  const rows = timetableCore.venueTimetable(db, seeded.timetableId, seeded.venueIds['B-114'])
  const venue = db.prepare('SELECT id, code, name FROM venues WHERE code = ?').get('B-114')
  return buildSheetModel('venue', { rows, timetable, entity: venue })
}

describe('buildSheetModel — section', () => {
  it('writes the department header exactly like her PDF', () => {
    const model = modelOf('section')
    expect(model.header.college).toBe('MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD')
    expect(model.header.department).toBe('Department of Computer Science & Engineering')
    expect(model.header.title).toBe('STUDENTS TIMETABLE 2026-27 (ODD SEMESTER)')
    expect(model.header.effective).toBe('w.e.f. 14-07-2026')
    expect(model.header.metaLeft).toBe('Semester: V - B')
    expect(model.header.metaRight).toBe(`Class O.C.: ${SECTION.class_oc}`)
    expect(model.header.counselors).toContain('Counselors:')
    expect(model.labels.fileBase).toBe('Section V-B timetable')
  })

  it('lays the grid out with two lanes per day, all six days', () => {
    const { grid } = modelOf('section')
    expect(grid.totalLaneRows).toBe(12)
    expect(grid.days).toHaveLength(6)
    for (const day of grid.days) expect(day.laneCount).toBe(2)
  })

  it('stacks batch lessons on their batch lanes and keeps the lab spanning P3-4', () => {
    const monday = modelOf('section').grid.days.find((day) => day.day === 1)
    const anchors = monday.lanes
      .flatMap((lane, laneIndex) => lane.map((cell) => ({ cell, laneIndex })))
      .filter(({ cell }) => cell.type === 'slot')

    const lab = anchors.find(({ cell }) => cell.slot.subject_code === 'BCS551')
    expect(lab).toBeTruthy()
    if (lab) {
      expect(lab.laneIndex).toBe(0) // B1 -> lane 0
      expect(lab.cell.colSpan).toBe(2) // P3-4
      expect(lab.cell.lines.join(' / ')).toContain('(P) B1')
      expect(lab.cell.lines.join(' / ')).toContain('B-114')
    }

    const whole = anchors.find(({ cell }) => cell.slot.subject_code === 'BCS503' && cell.colSpan === 1 && cell.period === 5)
    expect(whole).toBeTruthy()
    if (whole) expect(whole.cell.laneSpan).toBe(monday.laneCount) // merged across both lanes
  })

  it('builds the legend from the subjects that appear, with teacher names', () => {
    const { legend } = modelOf('section')
    expect(legend[0].code).toBe('BCS052')
    expect(legend.map((entry) => entry.code)).toContain('BCS501')
    const dbms = legend.find((entry) => entry.code === 'BCS501')
    expect(dbms.name).toBe('Database Management System')
    expect(dbms.teachers).toBe('KN')
    expect(dbms.teacherNames).toBe('Ms. Kanchan')
    const miniProject = legend.find((entry) => entry.code === 'BCS554')
    expect(miniProject.teachers).toBe('RUG/VB')
  })

  it('carries the footer signatures', () => {
    const { footer } = modelOf('section')
    expect(footer.coordinator).toBe('Ms. Kanchan')
    expect(footer.convener).toBe('Dr. Lalit Mohan Trivedi')
  })

  it('formats period and lunch times in 12-hour format for display', () => {
    const model = modelOf('section')
    expect(model.periodHeader[0].time).toBe('9:05–10:00 AM')
    expect(model.periodHeader[3].time).toBe('11:50 AM–12:45 PM')
    expect(model.periodHeader[4].time).toBe('1:40–2:35 PM')
    expect(model.periodHeader[7].time).toBe('4:25–5:20 PM')
    expect(model.lunch.time).toBe('12:45–1:40 PM')
  })
})

describe('buildSheetModel — generated views', () => {
  it('formats the faculty heading and cell lines', () => {
    const model = modelOf('faculty')
    expect(model.header.title).toBe('FACULTY TIMETABLE: Ms. Kanchan (KN) 2026-27 (Odd Semester)')
    expect(model.labels.sheet).toBe('Faculty KN')
    const cell = model.grid.days
      .flatMap((day) => day.lanes)
      .flat()
      .find((item) => item.type === 'slot' && item.slot.subject_code === 'BCS551')
    expect(cell.lines).toEqual(['BCS551 (P)', '5-B1', 'B-114'])
  })

  it('formats the venue heading and puts teachers into the cells', () => {
    const model = modelOf('venue')
    expect(model.header.title).toBe('VENUE TIMETABLE: B-114 2026-27 (Odd Semester)')
    expect(model.labels.sheet).toBe('Venue B-114')
    expect(model.legend[0].code).toBe('BCS551')
    const cell = model.grid.days
      .flatMap((day) => day.lanes)
      .flat()
      .find((item) => item.type === 'slot')
    expect(cell.lines).toEqual(['BCS551 (P)', '5-B1', 'KN'])
  })
})

describe('sheetNameFor', () => {
  it('sanitizes Excel-forbidden characters and caps at 31 chars', () => {
    const name = sheetNameFor({ labels: { sheet: 'Venue: B-114 (?)' } })
    expect(name).not.toMatch(/[\\/?*[\]:]/)
    expect(name.length).toBeLessThanOrEqual(31)
  })

  it('dedupes identical names with a serial suffix', () => {
    const taken = new Set()
    expect(sheetNameFor({ labels: { sheet: 'Faculty KN' } }, taken)).toBe('Faculty KN')
    expect(sheetNameFor({ labels: { sheet: 'Faculty KN' } }, taken)).toBe('Faculty KN (2)')
  })
})

describe('excelWorkbook.saveWorkbook — the section B workbook', () => {
  // 5 header rows (college, dept, title, w.e.f., ONE meta strip), blank
  // spacer, period head -> the grid starts at row 8.
  // Mon 8-9, Tue 10-11, Wed 12-13, Thu 14-15, Fri 16-17, Sat 18-19.

  it('merges cells exactly like the grid and keeps the layout', async () => {
    const model = modelOf('section')
    const filePath = join(tempDir, 'Section V-B timetable.xlsx')
    await saveWorkbook([model], filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(filePath))
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('Section V-B')

    // Landscape A4, fitted to one page wide, nothing repeated.
    expect(ws.pageSetup.orientation).toBe('landscape')
    expect(ws.pageSetup.paperSize).toBe(9)
    expect(ws.pageSetup.fitToWidth).toBe(1)
    expect(ws.getCell(7, 2).value).toBe('P1\n9:05 AM\n10:00 AM')
    expect(ws.getCell(7, 5).value).toBe('P4\n11:50 AM\n12:45 PM')
    expect(ws.getCell(7, 6).value).toBe('12:45 PM\n1:40 PM')
    expect(ws.getCell(7, 6).value).not.toContain('LUNCH')
    expect(ws.getRow(7).height).toBeGreaterThanOrEqual(36)
    expect(ws.getCell(7, 5).alignment).toMatchObject({
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true
    })

    const merges = ws.model.merges ?? []

    // B1 -> lane row (lane 0), Monday = first day.
    expect(merges).toContain('D8:E8') // Mon P3-4 BCS551 lab, two period columns
    // Whole-section lectures merge down both lane rows of the day.
    expect(merges).toContain('B10:B11') // Tue P1 BCS052
    // LUNCH column runs the entire grid (12 lane rows, from row 8).
    expect(merges).toContain('F8:F19')
    expect(ws.getCell(8, 6).value).toBe('LUNCH')
    expect(ws.getCell(8, 6).alignment.textRotation).toBe('vertical')

    const values = []
    ws.eachRow((row) => {
      const line = []
      row.eachCell({ includeEmpty: true }, (cell) => line.push(String(cell.value ?? '')))
      values.push(line.join(' | '))
    })
    const sheetText = values.join('\n')
    expect(sheetText).toContain('MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD')
    expect(sheetText).toContain('STUDENTS TIMETABLE 2026-27 (ODD SEMESTER)')
    expect(sheetText).toContain('Semester: V - B')
    expect(sheetText).toContain('Counselors:')
    expect(sheetText).toContain('Legend')
    expect(sheetText).toContain('Coordinator: Ms. Kanchan')
    expect(sheetText).toContain('Dr. Lalit Mohan Trivedi')
  })

  it('wraps and sizes both batch entries in Monday and Tuesday P8', async () => {
    const filePath = join(tempDir, 'P8 timetable.xlsx')
    await saveWorkbook([modelOf('section')], filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(filePath))
    const ws = wb.worksheets[0]

    for (const row of [8, 9, 10, 11]) {
      const cell = ws.getCell(row, 10)
      expect(String(cell.value)).toMatch(/MNPM501|HTCS501/)
      expect(cell.alignment).toMatchObject({
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true
      })
      expect(ws.getRow(row).height).toBeGreaterThanOrEqual(19)
    }
  })

  it('expands rows for unusually long timetable content without shrinking below 8pt', async () => {
    const model = JSON.parse(JSON.stringify(modelOf('section')))
    const monday = model.grid.days.find((day) => day.day === 1)
    const cell = monday.lanes.flat().find((item) => item.type === 'slot' && item.period === 8)
    cell.lines = [
      'ExtraordinarilyLongSubjectCode (P) B2',
      'Professor With A Particularly Long Name',
      'Venue B-114 North Wing'
    ]

    const filePath = join(tempDir, 'Long timetable content.xlsx')
    await saveWorkbook([model], filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(filePath))
    const ws = wb.worksheets[0]
    const row = 8 + cell.lane
    const exportedCell = ws.getCell(row, 10)

    expect(exportedCell.alignment.wrapText).toBe(true)
    expect(exportedCell.font.size).toBeGreaterThanOrEqual(8)
    expect(exportedCell.font.size).toBeLessThan(9)
    expect(ws.getRow(row).height).toBeGreaterThanOrEqual(19)
  })

  // Round-4 Issue 3: Semester / Class O.C. / Counselors on one row.
  it('puts the Semester, Class O.C. and Counselors strip on ONE merged row', async () => {
    const filePath = join(tempDir, 'Header strip timetable.xlsx')
    await saveWorkbook([modelOf('section')], filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(filePath))
    const ws = wb.worksheets[0]

    expect(String(ws.getCell(5, 1).value)).toBe('Semester: V - B')
    expect(String(ws.getCell(5, 3).value)).toContain('Class O.C.:')
    expect(String(ws.getCell(5, 6).value)).toContain('Counselors:')

    const merges = ws.model.merges ?? []
    expect(merges).toContain('A5:B5') // 20%
    expect(merges).toContain('C5:E5') // 30%
    expect(merges).toContain('F5:J5') // 50%
    // Nothing else on a second header row: row 6 is the blank spacer.
    expect(ws.getCell(6, 1).value ?? '').toBe('')
    expect(ws.getCell(7, 2).value).toBe('P1\n9:05 AM\n10:00 AM')
  })

  // Round-4 Issue 4: 38 pt per day, split over the day's lanes.
  it('gives every day row a minimum height, empty days included', async () => {
    const filePath = join(tempDir, 'Empty days timetable.xlsx')
    await saveWorkbook([modelOf('faculty')], filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(filePath))
    const ws = wb.worksheets[0]

    // Find the period header row (the faculty header has no meta strip, so the
    // grid starts one row higher than the section sheet).
    let headRow = 0
    ws.eachRow((row, rowNumber) => {
      if (String(row.getCell(2).value ?? '').startsWith('P1')) headRow = rowNumber
    })
    expect(headRow).toBeGreaterThan(0)
    for (let row = headRow + 1; row <= headRow + 12; row += 1) {
      expect(ws.getRow(row).height, `row ${row}`).toBeGreaterThanOrEqual(19)
    }
  })

  it('writes one sheet per entry for the combined workbook', async () => {
    const filePath = join(tempDir, 'combined.xlsx')
    await saveWorkbook([modelOf('section'), modelOf('faculty'), modelOf('venue')], filePath)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(filePath))
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Section V-B', 'Faculty KN', 'Venue B-114'])
  })
})
