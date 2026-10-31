// exportExcel.js — IPC-facing export functions. Runs in the MAIN process:
// it owns the native "Save as" / folder dialogs and hands the pure sheet
// models (desktop-shared/sheetModel.js) to excelWorkbook.js (Excel) or to
// print/pdf.js (PDF, rendered from print/template.js).

import { dialog, BrowserWindow, shell } from 'electron'
import timetableCore from '../../timetable-core.js'
import { buildSheetModel } from '../../desktop-shared/sheetModel.js'
import { saveWorkbook } from './excelWorkbook.js'
import { buildPrintHtml } from './print/template.js'
import { renderPdfFile } from './print/pdf.js'

const FILE_FILTERS = {
  excel: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  pdf: [{ name: 'PDF document', extensions: ['pdf'] }]
}
const FILE_EXT = { excel: 'xlsx', pdf: 'pdf' }
const PATH_BAD = /[\\/:*?"<>|]/g

function sanitizeName(name) {
  return String(name).replace(PATH_BAD, ' ').replace(/\s+/g, ' ').trim()
}

function windowForDialogs() {
  return BrowserWindow.getAllWindows()[0] ?? null
}

async function askSavePath(defaultName, format = 'excel') {
  const result = await dialog.showSaveDialog(windowForDialogs(), {
    title: format === 'pdf' ? 'Save timetable as PDF' : 'Save timetable as Excel',
    defaultPath: sanitizeName(defaultName),
    filters: FILE_FILTERS[format] ?? FILE_FILTERS.excel
  })
  return result.canceled ? null : result.filePath
}

async function askFolder() {
  const result = await dialog.showOpenDialog(windowForDialogs(), {
    title: 'Choose the export folder',
    buttonLabel: 'Export here',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

// ---------- data -> sheet models ----------

function loadTimetable(db, timetableId) {
  const timetable = db.prepare('SELECT * FROM timetables WHERE id = ?').get(timetableId)
  if (!timetable) throw new Error('That timetable no longer exists.')
  return timetable
}

function loadTeachers(db) {
  return db.prepare('SELECT id, code, name FROM teachers ORDER BY code').all()
}

export function sectionModel(db, sectionId) {
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId)
  if (!section) throw new Error('That section no longer exists.')
  const timetable = loadTimetable(db, section.timetable_id)
  const rows = timetableCore.sectionSlots(db, sectionId)
  return buildSheetModel('section', { rows, timetable, section, teachers: loadTeachers(db) })
}

export function facultyModel(db, timetableId, teacherId) {
  const teacher = db.prepare('SELECT id, code, name FROM teachers WHERE id = ?').get(teacherId)
  if (!teacher) throw new Error('That teacher no longer exists.')
  const allowlist = { ...teacher }
  const timetable = loadTimetable(db, timetableId)
  const rows = timetableCore.facultyTimetable(db, timetableId, teacherId)
  return buildSheetModel('faculty', {
    rows,
    timetable,
    entity: allowlist,
    teachers: loadTeachers(db)
  })
}

export function venueModel(db, timetableId, venueId) {
  const venue = db.prepare('SELECT id, code, name FROM venues WHERE id = ?').get(venueId)
  if (!venue) throw new Error('That venue no longer exists.')
  const venueEntity = { ...venue }
  const timetable = loadTimetable(db, timetableId)
  const rows = timetableCore.venueTimetable(db, timetableId, venueId)
  return buildSheetModel('venue', {
    rows,
    timetable,
    entity: venueEntity,
    teachers: loadTeachers(db)
  })
}

/** section/faculty/venue -> model, with the kind words the renderer uses. */
export function modelFor(db, kind, timetableId, id) {
  if (kind === 'section') return sectionModel(db, id)
  if (kind === 'faculty') return facultyModel(db, timetableId, id)
  if (kind === 'venue') return venueModel(db, timetableId, id)
  throw new Error(`Unknown export kind "${kind}".`)
}

// ---------- export flows ----------

function baseName(filePath) {
  return String(filePath).split(/[\\/]/).pop()
}

function hasBookings(model) {
  return model.grid.days.some((day) =>
    day.lanes.some((lane) => lane.some((cell) => cell.type === 'slot'))
  )
}

/** The PDF twin of an .xlsx path: "Section V-B timetable.xlsx" -> "...pdf". */
function pdfSidecarPath(xlsxPath) {
  const stem = String(xlsxPath).replace(/\.[^./\\]+$/, '')
  const pdfPath = `${stem}.pdf`
  return pdfPath.toLowerCase() === String(xlsxPath).toLowerCase()
    ? `${stem} (print).pdf`
    : pdfPath
}

function folderPath(dir, stem, format) {
  const folder = String(dir).replace(/[\\/]+$/, '')
  return `${folder}\\${sanitizeName(stem)}.${FILE_EXT[format]}`
}

/**
 * Writes the model(s) to `filePath` (.xlsx) in the requested format: "excel"
 * saves the workbook only, "both" also saves the PDF beside it. Returns
 * { files, pdf } — pdf carries the verified page count and the low-scale
 * report when a PDF was produced (round-3 Issue 5).
 */
async function writeFiles(models, filePath, format) {
  await saveWorkbook(models, filePath)
  if (format !== 'both') return { files: [filePath], pdf: null }
  const pdfPath = pdfSidecarPath(filePath)
  const pdf = await renderPdfFile(buildPrintHtml(models), pdfPath)
  return { files: [filePath, pdfPath], pdf }
}

/**
 * Single entry, native Save as dialog. `format` is excel | pdf | both;
 * "both" asks once for the workbook and writes the PDF beside it.
 * Returns { filePath, file, files, count } or { canceled: true }.
 */
export async function exportSingle(db, kind, timetableId, id, format = 'excel') {
  const model = modelFor(db, kind, timetableId, id)
  const dialogFormat = format === 'pdf' ? 'pdf' : 'excel'
  const filePath = await askSavePath(
    `${model.labels.fileBase}.${FILE_EXT[dialogFormat]}`,
    dialogFormat
  )
  if (!filePath) return { canceled: true }

  let written
  if (format === 'pdf') {
    written = { files: [filePath], pdf: await renderPdfFile(buildPrintHtml([model]), filePath) }
  } else {
    written = await writeFiles([model], filePath, format)
  }
  return {
    filePath,
    file: baseName(filePath),
    files: written.files.map(baseName),
    count: 1,
    ...(written.pdf ? { pages: written.pdf.pages, small: written.pdf.small, warnings: written.pdf.warnings } : {})
  }
}

/** Direct "save as PDF" shortcuts — exportSingle with the format pinned. */
export const exportSectionPdf = (db, timetableId, id) =>
  exportSingle(db, 'section', timetableId, id, 'pdf')
export const exportFacultyPdf = (db, timetableId, id) =>
  exportSingle(db, 'faculty', timetableId, id, 'pdf')
export const exportVenuePdf = (db, timetableId, id) =>
  exportSingle(db, 'venue', timetableId, id, 'pdf')

/** Writes one entry into a folder chosen earlier. Empty views are skipped. */
export async function exportOne(db, kind, timetableId, id, dir, format = 'excel') {
  const model = modelFor(db, kind, timetableId, id)
  if (!hasBookings(model)) {
    return { skipped: true, reason: 'nothing booked yet' }
  }
  const stem = sanitizeName(model.labels.fileBase)

  let written
  if (format === 'pdf') {
    const pdfPath = folderPath(dir, stem, 'pdf')
    written = { files: [pdfPath], pdf: await renderPdfFile(buildPrintHtml([model]), pdfPath) }
  } else {
    written = await writeFiles([model], folderPath(dir, stem, 'excel'), format)
  }
  return {
    filePath: written.files[0],
    file: baseName(written.files[0]),
    files: written.files.map(baseName),
    ...(written.pdf ? { pages: written.pdf.pages, small: written.pdf.small, warnings: written.pdf.warnings } : {})
  }
}

/**
 * Combined file: one sheet (Excel) / one page (PDF) per non-empty entry,
 * written into the chosen folder.
 */
export async function exportCombined(db, timetableId, kind, dir, format = 'excel') {
  const plural = { section: 'sections', faculty: 'faculty', venue: 'venues' }[kind] ?? kind
  const entries = exportEntries(db, timetableId, plural)
  const models = []
  const skipped = []
  for (const entry of entries) {
    const model = await modelFor(db, kind, timetableId, entry.id)
    if (!hasBookings(model)) {
      skipped.push(`${model.labels.short}: nothing booked yet`)
      continue
    }
    models.push(model)
  }
  if (models.length === 0) {
    return { failed: true, reason: 'Nothing to export — every entry is empty.' }
  }
  const stem = sanitizeName(pluralLabel(plural))

  let written
  if (format === 'pdf') {
    const pdfPath = folderPath(dir, stem, 'pdf')
    written = { files: [pdfPath], pdf: await renderPdfFile(buildPrintHtml(models), pdfPath) }
  } else {
    written = await writeFiles(models, folderPath(dir, stem, 'excel'), format)
  }
  return {
    filePath: written.files[0],
    file: baseName(written.files[0]),
    files: written.files.map(baseName),
    count: models.length,
    skipped,
    ...(written.pdf ? { pages: written.pdf.pages, small: written.pdf.small, warnings: written.pdf.warnings } : {})
  }
}

function pluralLabel(plural) {
  return `${plural[0].toUpperCase()}${plural.slice(1)} timetable`
}

/** Every section / teacher / venue of a timetable, ready for a batch export. */
export function exportEntries(db, timetableId, plural) {
  if (plural === 'sections') {
    return db
      .prepare('SELECT id, semester, name FROM sections WHERE timetable_id = ? ORDER BY semester, name')
      .all(timetableId)
  }
  const summary = timetableCore.viewsSummary(db, timetableId)
  return plural === 'faculty' ? summary.teachers : summary.venues
}

export async function chooseFolder() {
  const folder = await askFolder()
  return folder ? { folder } : { canceled: true }
}

export function openFolder(folder) {
  return shell.openPath(String(folder))
}
