// pdf-export-runner.mjs — runs INSIDE Electron's main process. It builds the
// in-memory fixtures (Section B, a layout-stress section, and a five-entry
// combined export), renders each through the REAL export path
// (modelFor -> buildPrintHtml -> renderPdfFile) and prints one JSON line on
// stdout for tests/pdf-one-page.test.js to assert on.
//
// Run directly with:  npx electron tests/electron/pdf-export-runner.mjs

import { app } from 'electron'
import Database from 'better-sqlite3'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

import seedModule from '../../scripts/seed-section-b.js'
import { modelFor } from '../../src/main/exportExcel.js'
import { buildPrintHtml } from '../../src/main/print/template.js'
import { renderPdfFile } from '../../src/main/print/pdf.js'
import { seedStress } from './stress-fixture.mjs'

const { seedSectionB } = seedModule

process.on('uncaughtException', (error) => {
  process.stderr.write(`UNCAUGHT: ${error && error.stack}`)
})
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`UNHANDLED REJECTION: ${reason && reason.stack}`)
})
process.on('exit', (code) => {
  process.stderr.write(`[runner] exit code ${code}\n`)
})

/** Sheets with at least one booking anywhere; exportCombined's same filter. */
function hasBookings(model) {
  return model.grid.days.some((day) =>
    day.lanes.some((lane) => lane.some((cell) => cell.type === 'slot'))
  )
}

async function main() {
  // The PDF renderer destroys each hidden window when it is done. Without a
  // handler, Electron's window-all-closed default quits the whole app right
  // after the first render — keep the runner alive for the batch.
  app.on('window-all-closed', () => {})
  app.on('child-process-gone', (event, details) => {
    process.stderr.write(`[runner] child-process-gone: ${JSON.stringify(details)}\n`)
  })
  app.on('render-process-gone', (event, details) => {
    process.stderr.write(`[runner] render-process-gone: ${JSON.stringify(details)}\n`)
  })

  await app.whenReady()
  process.stderr.write('[runner] ready\n')

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(here, '..', '..', 'schema.sql'), 'utf8'))
  const seed = seedSectionB(db)

  const sections = db.prepare(`SELECT id, semester, name FROM sections WHERE id = ?`).get(seed.sectionId)
  const teachers = db.prepare('SELECT id, code, name FROM teachers ORDER BY code').all()
  const ids = { ...seed, subjectIds: {}, teacherIds: {}, venueIds: {} }
  for (const t of teachers) ids.teacherIds[t.code] = t.id
  for (const v of db.prepare('SELECT id, code FROM venues').all()) ids.venueIds[v.code] = v.id
  for (const s of db.prepare('SELECT id, code FROM subjects').all()) ids.subjectIds[s.code] = s.id

  const stress = seedStress(db, seed.timetableId, {
    subjectIds: ids.subjectIds,
    teacherIds: ids.teacherIds,
    venueIds: ids.venueIds
  })
  const stressB = db.prepare('SELECT * FROM sections WHERE id = ?').get(stress.sectionBId)
  const stressSection = db.prepare('SELECT * FROM sections WHERE id = ?').get(stress.sectionId)

  function modelOf(kind, entity) {
    return modelFor(db, kind, seed.timetableId, entity.id)
  }

  const folder = await mkdtemp(join(tmpdir(), 'tt-pdf-'))

  const out = {}

  // 1. Section B -> exactly one page.
  try {
    const sectionB = modelOf('section', sections)
    const r = await renderPdfFile(buildPrintHtml([sectionB]), join(folder, 'section-b.pdf'))
    out.sectionB = { pages: r.pages, expected: 1, scales: r.scales, titles: r.titles, footerGaps: r.footerGaps, warnings: r.warnings, small: r.small }
    process.stderr.write('[runner] sectionB ok\n')
  } catch (error) {
    out.sectionB = { error: String(error && error.message) }
  }

  // 2. The stress section -> exactly one page.
  try {
    const stressModel = modelOf('section', stressSection)
    const r = await renderPdfFile(buildPrintHtml([stressModel]), join(folder, 'stress.pdf'))
    out.stress = { pages: r.pages, expected: 1, scales: r.scales, titles: r.titles, footerGaps: r.footerGaps, warnings: r.warnings, small: r.small }
    process.stderr.write('[runner] stress ok\n')
  } catch (error) {
    out.stress = { error: String(error && error.message) }
  }

  // 3. Five entries in one combined PDF -> exactly five pages.
  try {
    const models = [
      modelOf('section', sections),
      modelOf('section', stressSection),
      modelOf('section', stressB),
      modelOf('faculty', seed.teacherIds.KN
        ? db.prepare('SELECT * FROM teachers WHERE id = ?').get(seed.teacherIds.KN)
        : db.prepare('SELECT * FROM teachers WHERE code = ?').get('KN')),
      modelOf('venue', db.prepare('SELECT * FROM venues WHERE code = ?').get('B-114'))
    ].filter(hasBookings)
    const expected = models.length
    const r = await renderPdfFile(buildPrintHtml(models), join(folder, 'combined.pdf'))
    out.combined = {
      pages: r.pages,
      expected,
      scales: r.scales,
      titles: r.titles,
      footerGaps: r.footerGaps,
      warnings: r.warnings,
      small: r.small
    }
    process.stderr.write('[runner] combined ok\n')
  } catch (error) {
    out.combined = { error: String(error && error.message) }
  }

  db.close()
  // Console streams in Electron main are unreliable on Windows (block
  // buffered, and the child can die before the pipe drains) — write the JSON
  // result to a file instead; the test passes its path as argv[1].
  const resultPath = process.argv[2]
  if (!resultPath) {
    process.stderr.write('usage: electron pdf-export-runner.mjs <result.json>\n')
    app.exit(2)
    return
  }
  writeFileSync(resultPath, JSON.stringify(out, null, 2))
  process.stderr.write('[runner] results written to ' + resultPath + '\n')
  setTimeout(() => app.exit(0), 100)
}

main().catch((error) => {
  process.stderr.write(`RUNNER FAILED: ${error && error.stack}\n`)
  setTimeout(() => app.exit(1), 100)
})
