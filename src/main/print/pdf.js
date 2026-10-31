// pdf.js — renders the HTML from print/template.js to a PDF file through a
// hidden BrowserWindow. Main process only: Electron's webContents.printToPDF
// is what guarantees the PDF matches the layout engine exactly.
//
// Round-3/4 contract: exactly ONE page per timetable, top-aligned, with the
// coordinator/convener line always fully visible. The page box is fixed in the
// template (@page A4 landscape, margin 0; .sheet = 297 x 209 mm, overflow
// hidden); pdfLayout.measureScript pins every sheet's content to the top,
// scales it down to fit and shrinks again until the footer clears the sheet
// bottom. After printing, pdf-lib counts the pages; a mismatch retries once
// with strictly smaller scales and then fails loudly, naming the entry.

import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import {
  REPORT_BELOW,
  TIGHTEN_BELOW,
  applyScalesScript,
  measureScript
} from './pdfLayout.js'

const PRINT_OPTIONS = {
  landscape: true,
  // @page in the template owns the page size and the zero margins; this makes
  // printToPDF obey it instead of applying its own InchesTemplate margins.
  preferCSSPageSize: true,
  pageSize: 'A4',
  printBackground: true,
  margins: { top: 0, bottom: 0, left: 0, right: 0 }
}

/** Page count of a PDF buffer, so the exporter can verify its own output. */
export async function countPdfPages(buffer) {
  const document = await PDFDocument.load(buffer)
  return document.getPageCount()
}

async function withHiddenWindow(html) {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    const base64 = Buffer.from(html, 'utf8').toString('base64')
    await win.loadURL(`data:text/html;base64,${base64}`)
    return win.webContents
  } catch (error) {
    win.destroy()
    throw error
  }
}

/**
 * Renders and verifies one document of one or more sheet models.
 * Returns { filePath, pages, scales, titles, footerGaps, warnings, small } —
 * `small` lists the entries that had to shrink below REPORT_BELOW, `warnings`
 * names any sheet whose footer could not be cleared even after shrinking.
 */
async function renderOnce(html, filePath) {
  const webContents = await withHiddenWindow(html)

  try {
    // Measure at natural size (fonts settled first), scale each sheet down and
    // verify the footer clears the sheet bottom.
    let measured = await webContents.executeJavaScript(measureScript())

    // Very cramped content (or a footer that still would not clear): tighten
    // paddings/line-heights once and re-measure — a bigger scale after
    // tightening beats an unreadable small one, and the second measurement
    // re-runs the footer check with the tightened CSS.
    if (
      measured.scales.some((scale) => scale < TIGHTEN_BELOW) ||
      measured.warnings.length > 0
    ) {
      await webContents.executeJavaScript("document.body.classList.add('tight')")
      measured = await webContents.executeJavaScript(measureScript())
    }

    let { scales, titles, footerGaps, warnings } = measured
    const expected = titles.length

    const buffer = await webContents.printToPDF(PRINT_OPTIONS)
    let pages = await countPdfPages(buffer)
    let printed = buffer

    if (pages !== expected) {
      // One retry with strictly smaller scales — rounding at a page break can
      // cost an extra blank page, 0.95x removes it.
      const stricter = scales.map((scale) => scale * 0.95)
      await webContents.executeJavaScript(applyScalesScript(stricter))
      scales = stricter
      printed = await webContents.printToPDF(PRINT_OPTIONS)
      pages = await countPdfPages(printed)
      if (pages !== expected) {
        const worst = scales.reduce(
          (low, scale, index) => (scale < scales[low] ? index : low),
          0
        )
        throw new Error(
          `PDF export did not fit on one page per timetable: got ${pages} pages ` +
            `for ${expected} timetables. Tightest sheet: "${titles[worst]}".`
        )
      }
    }

    await writeFile(filePath, printed)

    const small = scales
      .map((scale, index) => ({ title: titles[index], scale }))
      .filter((entry) => entry.scale < REPORT_BELOW)

    if (small.length) {
      console.log(
        `[pdf] shy content scaled below ${REPORT_BELOW}: ` +
          small.map((entry) => `${entry.title} x${entry.scale.toFixed(2)}`).join(', ')
      )
    }

    return { filePath, pages, scales, titles, footerGaps, warnings, small }
  } finally {
    BrowserWindow.fromWebContents(webContents)?.destroy()
  }
}

// Export flows run one after another (the renderer awaits each call), but the
// queue keeps overlapping requests — say a retried click — strictly serial:
// two hidden windows printing at once is asking for trouble.
let queue = Promise.resolve()

/**
 * Renders `html` and writes the PDF to `filePath`.
 * Resolves with { filePath, pages, scales, titles, footerGaps, warnings, small };
 * rejects if the window, the print or the one-page verification fails.
 */
export function renderPdfFile(html, filePath) {
  const task = queue.then(() => renderOnce(html, filePath))
  queue = task.catch(() => {})
  return task
}
