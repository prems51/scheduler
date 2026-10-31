// pdf-smoke.mjs — `npm run check:pdf`. Runs INSIDE Electron's main process.
//
// Renders three timetables through the REAL export path (modelFor ->
// buildPrintHtml -> renderPdfFile), then rasterizes each printed page to a PNG
// in ./pdf-check/ by loading the same HTML in an offscreen window at the exact
// page size. It prints the page count, the scale and the measured footer
// margin for every sheet so the one-page / un-clipped-footer contract can be
// checked by eye as well as by the assertions in tests/pdf-one-page.test.js.
//
// Open ./pdf-check/ afterwards to look at the images.

import { app, BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import seedModule from '../scripts/seed-section-b.js'
import { modelFor } from '../src/main/exportExcel.js'
import { buildPrintHtml } from '../src/main/print/template.js'
import { renderPdfFile } from '../src/main/print/pdf.js'
import { PAGE_BOX_MM, measureScript, pxToMm } from '../src/main/print/pdfLayout.js'
import { seedStress } from './electron/stress-fixture.mjs'

const { seedSectionB } = seedModule
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, 'pdf-check')

/** The page box in CSS pixels, the size the offscreen capture must use. */
const PAGE_PX = {
  width: Math.round((PAGE_BOX_MM.width / 25.4) * 96),
  height: Math.round((PAGE_BOX_MM.height / 25.4) * 96)
}

/** Sheets with at least one booking anywhere; exportCombined's own filter. */
function hasBookings(model) {
  return model.grid.days.some((day) => day.lanes.some((lane) => lane.some((cell) => cell.type === 'slot')))
}

/**
 * Loads `html` in an offscreen window the size of one printed page, runs the
 * same measuring/scaling script the exporter uses, then captures the page.
 */
async function capturePage(html, pngPath) {
  const win = new BrowserWindow({
    show: false,
    width: PAGE_PX.width,
    height: PAGE_PX.height,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: { offscreen: true }
  })
  try {
    const base64 = Buffer.from(html, 'utf8').toString('base64')
    await win.loadURL(`data:text/html;base64,${base64}`)

    // Windows clamps a window to the display work area, so a 297x209 mm page
    // does not always fit at 100%. Zoom the page down until the whole sheet is
    // visible in one capture; the authoritative measurements still come from
    // the real printToPDF pass, this image is for the eye.
    const viewport = await win.webContents.executeJavaScript(
      '({ w: window.innerWidth, h: window.innerHeight })'
    )
    const zoom = Math.min(1, viewport.w / PAGE_PX.width, viewport.h / PAGE_PX.height)
    if (zoom < 1) {
      win.webContents.setZoomFactor(zoom)
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    const measured = await win.webContents.executeJavaScript(measureScript())
    // Let the compositor paint the scaled frame before grabbing it.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const image = await win.webContents.capturePage()
    await writeFile(pngPath, image.toPNG())
    return measured
  } finally {
    win.destroy()
  }
}

function describe(entry) {
  const gaps = entry.footerGaps.map((gap) => `${pxToMm(gap).toFixed(1)}mm`).join(', ')
  const scales = entry.scales.map((scale) => scale.toFixed(2)).join(', ')
  const warn = entry.warnings.length ? ` WARNINGS: ${entry.warnings.join(' | ')}` : ''
  return (
    `${entry.name}: ${entry.pages} page(s) for ${entry.expected} timetable(s), ` +
    `scale ${scales}, footer margin ${gaps}${warn}`
  )
}

async function main() {
  app.on('window-all-closed', () => {})
  await app.whenReady()

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(root, 'schema.sql'), 'utf8'))
  const seed = seedSectionB(db)

  const ids = { subjectIds: {}, teacherIds: {}, venueIds: {} }
  for (const t of db.prepare('SELECT id, code FROM teachers').all()) ids.teacherIds[t.code] = t.id
  for (const v of db.prepare('SELECT id, code FROM venues').all()) ids.venueIds[v.code] = v.id
  for (const s of db.prepare('SELECT id, code FROM subjects').all()) ids.subjectIds[s.code] = s.id

  const stress = seedStress(db, seed.timetableId, ids)
  const sectionB = db.prepare('SELECT * FROM sections WHERE id = ?').get(seed.sectionId)
  const stressSection = db.prepare('SELECT * FROM sections WHERE id = ?').get(stress.sectionId)
  const kn = db.prepare('SELECT * FROM teachers WHERE id = ?').get(seed.teacherIds.KN)

  const entries = [
    { name: 'Section B', model: modelFor(db, 'section', seed.timetableId, sectionB.id) },
    { name: 'Stress section (3 lanes, 3 counselors)', model: modelFor(db, 'section', seed.timetableId, stressSection.id) },
    { name: 'Faculty KN (mostly empty days)', model: modelFor(db, 'faculty', seed.timetableId, kn.id) }
  ].filter((entry) => hasBookings(entry.model))

  await mkdir(outDir, { recursive: true })

  const results = []
  for (const [index, entry] of entries.entries()) {
    const html = buildPrintHtml([entry.model])
    const stem = `page-${index + 1}`
    const pdfPath = join(outDir, `${stem}.pdf`)
    const pngPath = join(outDir, `${stem}.png`)

    const rendered = await renderPdfFile(html, pdfPath)
    const captured = await capturePage(html, pngPath)

    results.push({
      name: entry.name,
      pages: rendered.pages,
      expected: rendered.titles.length,
      scales: rendered.scales,
      // The print pass is authoritative: it is the geometry that lands in the
      // PDF. The capture only proves what the page looks like.
      footerGaps: rendered.footerGaps,
      warnings: [...rendered.warnings, ...captured.warnings]
    })
  }

  db.close()

  process.stdout.write(`\nPDF check — images in ${outDir}\n`)
  let failed = false
  for (const result of results) {
    process.stdout.write(`  ${describe(result)}\n`)
    if (result.pages !== result.expected) failed = true
    if (result.warnings.length) failed = true
  }
  process.stdout.write(
    failed ? '\nFAILED: a timetable is not exactly one page or its footer is clipped.\n' : '\nOK: one page per timetable, footer fully visible.\n'
  )

  setTimeout(() => app.exit(failed ? 1 : 0), 150)
}

main().catch((error) => {
  process.stderr.write(`pdf-smoke failed: ${error && error.stack}\n`)
  setTimeout(() => app.exit(1), 150)
})
