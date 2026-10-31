// scripts/sample-pdf.mjs
// Two-stage sample generator for the PDF export:
//
//   Stage A (plain Node):    seeds Section B in memory, renders the print HTML
//                            for the section sheet and one combined all-faculty
//                            document via the production template.
//   Stage B (the Electron    reads that HTML and runs the production renderer
//   binary, this same file): (hidden window + printToPDF) so the samples come
//                            out of exactly the code path the app uses, then
//                            reports page counts and orientation.
//
// Run both stages:
//   node scripts/sample-pdf.mjs
//   electron scripts/sample-pdf.mjs
//
// Output at the project root: "Section V-B sample.pdf" (must be one page)
// and "All-faculties sample.pdf" (must be one page per teacher).

import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataPath = join(root, '.sample-html.json')

async function buildStage() {
  // Dynamic imports: better-sqlite3 is built for plain Node here and must not
  // load in stage B, where the Electron binary loads the bundle instead.
  const { default: Database } = await import('better-sqlite3')
  const { default: timetableCore } = await import('../timetable-core.js')
  const { default: seedModule } = await import('../scripts/seed-section-b.js')
  const { buildSheetModel } = await import('../desktop-shared/sheetModel.js')
  const { buildPrintHtml } = await import('../src/main/print/template.js')

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(root, 'schema.sql'), 'utf8'))
  const seeded = seedModule.seedSectionB(db)

  const timetable = db.prepare('SELECT * FROM timetables WHERE id = ?').get(seeded.timetableId)
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(seeded.sectionId)
  const teachers = db.prepare('SELECT id, code, name FROM teachers ORDER BY code').all()

  const sectionModel = buildSheetModel('section', {
    rows: timetableCore.sectionSlots(db, seeded.sectionId),
    timetable,
    section,
    teachers
  })

  const summary = timetableCore.viewsSummary(db, seeded.timetableId)
  const facultyModels = summary.teachers
    .filter((teacher) => teacher.periods > 0)
    .map((teacher) => {
      const row = db.prepare('SELECT id, code, name FROM teachers WHERE id = ?').get(teacher.id)
      return buildSheetModel('faculty', {
        rows: timetableCore.facultyTimetable(db, seeded.timetableId, teacher.id),
        timetable,
        entity: row
      })
    })

  db.close()
  writeFileSync(
    dataPath,
    JSON.stringify({
      section: buildPrintHtml([sectionModel]),
      facultyAll: buildPrintHtml(facultyModels),
      facultyCount: facultyModels.length
    })
  )
  console.log(
    `[stage A] print HTML ready: 1 section sheet + ${facultyModels.length} faculty sheets -> .sample-html.json`
  )
}

/** Page count and orientation straight from the PDF's page tree. */
function pdfInfo(filePath) {
  const text = readFileSync(filePath).toString('latin1')
  const counts = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((match) =>
    Number(match[1])
  )
  const markers = (text.match(/\/Type\s*\/Page(?!s)/g) || []).length
  const pages = Math.max(0, ...counts, markers)
  const box = /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(text)
  return { pages, landscape: box ? Number(box[1]) > Number(box[2]) : null }
}

async function renderStage() {
  const { app } = await import('electron')
  const { tmpdir } = await import('node:os')

  // The dev app (electron .) runs on the profile this package.json names
  // (Roaming/timetable-manager). A second Electron sharing that profile can
  // block app.whenReady() entirely, so the sample run gets its own throwaway
  // profile — but only for this script, never the app's real data.
  app.setPath('userData', join(tmpdir(), 'timetable-sample-pdf-profile'))

  // Progress markers + a watchdog: if any step stalls (a hidden window that
  // never loads, printToPDF that never returns), we exit loudly instead of
  // hanging the terminal.
  let step = 'start'
  const mark = (name) => {
    step = name
    console.error(`[stage B] ${name}`)
  }
  const watchdog = setTimeout(() => {
    console.error(`[stage B] WATCHDOG: stuck at "${step}", exiting`)
    app.exit(2)
  }, 45000)

  mark('import renderer')
  const { renderPdfFile } = await import('../src/main/print/pdf.js')
  const payload = JSON.parse(readFileSync(dataPath, 'utf8'))

  mark('app.whenReady')
  await app.whenReady()
  const sectionPdf = join(root, 'Section V-B sample.pdf')
  const facultyPdf = join(root, 'All-faculties sample.pdf')
  mark('render section PDF')
  await renderPdfFile(payload.section, sectionPdf)
  mark('render faculty PDF')
  await renderPdfFile(payload.facultyAll, facultyPdf)
  mark('done')
  rmSync(dataPath, { force: true })

  const checks = [
    ['Section V-B sample.pdf', sectionPdf, 1],
    ['All-faculties sample.pdf', facultyPdf, payload.facultyCount]
  ]
  let failed = false
  for (const [name, filePath, expected] of checks) {
    const { pages, landscape } = pdfInfo(filePath)
    const ok = pages === expected && landscape === true
    if (!ok) failed = true
    console.log(
      `[stage B] ${name}: ${pages} page(s), landscape=${landscape} (expected ${expected} page(s), landscape) -> ${ok ? 'OK' : 'MISMATCH'}`
    )
  }
  clearTimeout(watchdog)
  app.exit(failed ? 1 : 0)
}

if (process.versions.electron) {
  await renderStage()
} else {
  await buildStage()
}
