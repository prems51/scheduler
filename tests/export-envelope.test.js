// Round-4 Issue 2 regression: "All, one file per entry" used to crash with
// "response is not defined" AFTER the files were written, because the
// renderer's runAll referenced the loop-scoped `response` after the loop.
// These tests pin the two halves of the fix:
//   1. the main-process side — the exact functions ipc.js wraps with
//      toEnvelope() answer { ok: true, data } with a files array, for every
//      batch shape (all faculty / all venues / all sections), and a failure
//      becomes { ok: false, error } instead of a thrown exception;
//   2. the renderer side — exportResult.js turns those envelopes into the
//      on-screen messages (success box, warnings, failure text).
// Electron is mocked (dialogs/shell only); exceljs and better-sqlite3 are real.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import seedModule from '../scripts/seed-section-b.js'
import { toEnvelope } from '../src/main/ipcEnvelope.js'
import {
  describeExportError,
  describeExportSuccess,
  footerWarnings,
  shrinkWarnings
} from '../src/renderer/src/lib/exportResult.js'

// exportExcel.js imports electron for the save dialogs and "open folder";
// the batch exporters never touch them, so a stub is enough to load the
// module under plain Node — everything else (models, exceljs, fs) is real.
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] })
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: async () => '' }
}))

const { exportCombined, exportOne, exportEntries } = await import('../src/main/exportExcel.js')
const { seedSectionB } = seedModule

const here = dirname(fileURLToPath(import.meta.url))

let db
let seeded
let tempDir

beforeAll(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'))
  seeded = seedSectionB(db)
  tempDir = mkdtempSync(join(tmpdir(), 'export-envelope-'))
})

afterAll(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

/**
 * The exact renderer batch loop: one envelope per entry through the same
 * toEnvelope wrapper ipc.js uses, collecting files, then the success message.
 */
async function runAllLikeRenderer(kind, plural, format) {
  const entries = exportEntries(db, seeded.timetableId, plural)
  const files = []
  const skipped = []
  for (const entry of entries) {
    const response = await toEnvelope(() =>
      exportOne(db, kind, seeded.timetableId, entry.id, tempDir, format)
    )
    if (!response.ok) {
      return { response, message: describeExportError(response.error) }
    }
    if (response.data.skipped) skipped.push(entry.id)
    else files.push(...(response.data.files ?? [response.data.file]))
  }
  return { response: { ok: true, data: { files, skipped } }, files, skipped }
}

describe('export batch envelopes (Issue 2)', () => {
  it('all faculty into a folder: ok:true, a files array, one file per teacher with classes', async () => {
    const { response, files } = await runAllLikeRenderer('faculty', 'faculty', 'excel')
    expect(response.ok).toBe(true)
    expect(Array.isArray(files)).toBe(true)
    // KN at least has classes in the seed.
    expect(files.length).toBeGreaterThanOrEqual(1)
    for (const file of files) expect(existsSync(join(tempDir, file))).toBe(true)
  })

  it('all venues into a folder: ok:true with files for every booked venue', async () => {
    const { response, files } = await runAllLikeRenderer('venue', 'venues', 'excel')
    expect(response.ok).toBe(true)
    expect(files.length).toBeGreaterThanOrEqual(1)
    for (const file of files) expect(existsSync(join(tempDir, file))).toBe(true)
  })

  it('all sections into a folder: ok:true with one file per section', async () => {
    const { response, files } = await runAllLikeRenderer('section', 'sections', 'excel')
    expect(response.ok).toBe(true)
    expect(files.length).toBe(1) // the seed builds Section B only
    expect(existsSync(join(tempDir, files[0]))).toBe(true)
  })

  it('combined "all faculty" export: one envelope, files array, count of entries', async () => {
    const response = await toEnvelope(() =>
      exportCombined(db, seeded.timetableId, 'faculty', tempDir, 'excel')
    )
    expect(response.ok).toBe(true)
    expect(Array.isArray(response.data.files)).toBe(true)
    expect(response.data.files.length).toBe(1) // one combined workbook
    expect(response.data.count).toBeGreaterThanOrEqual(1)
    expect(existsSync(join(tempDir, response.data.file))).toBe(true)
  })

  it('a failure inside the handler becomes { ok:false, error } — never a thrown JS error', async () => {
    const response = await toEnvelope(() =>
      exportOne(db, 'faculty', seeded.timetableId, 999999, tempDir, 'excel')
    )
    expect(response.ok).toBe(false)
    expect(typeof response.error).toBe('string')
    expect(response.error.length).toBeGreaterThan(0)
  })
})

describe('renderer message builders (Issue 2)', () => {
  it('batch success names the file count, folder and skipped entries', () => {
    const box = describeExportSuccess(
      { dir: 'C:/exports', files: ['a.xlsx', 'b.xlsx', 'c.xlsx'], skipped: [], small: [] },
      'files',
      'excel'
    )
    expect(box.title).toBe('Exported 3 files')
    expect(box.dir).toBe('C:/exports')
    expect(box.messages.join('\n')).toContain('a.xlsx')
  })

  it('small-scale warnings are listed under the success box', () => {
    const box = describeExportSuccess(
      { dir: 'x', files: ['a.pdf'], skipped: [], small: [{ title: 'Faculty KN', scale: 0.65 }] },
      'files',
      'pdf'
    )
    expect(box.messages.join('\n')).toContain('Faculty KN was scaled to 65%')
  })

  it('combined success reports pages for a PDF and sheets for Excel', () => {
    const pdfBox = describeExportSuccess(
      { dir: 'x', files: ['All faculty.pdf'], skipped: [], small: [], count: 5 },
      'combined',
      'pdf'
    )
    expect(pdfBox.messages.join('\n')).toContain('5 pages written')
    const xlsBox = describeExportSuccess(
      { dir: 'x', files: ['All sections.xlsx'], skipped: [], small: [], count: 2 },
      'combined',
      'excel'
    )
    expect(xlsBox.messages.join('\n')).toContain('2 sheets written')
  })

  it('failure text names the failing entry and lists files already written', () => {
    const text = describeExportError('Disk full', {
      failedEntry: 'Faculty KN',
      writtenFiles: ['a.xlsx', 'b.xlsx']
    })
    expect(text).toContain('Faculty KN: Disk full')
    expect(text).toContain('Files already written:')
    expect(text).toContain('a.xlsx')
  })

  it('shrinkWarnings is empty for a clean run', () => {
    expect(shrinkWarnings([])).toEqual([])
    expect(shrinkWarnings(undefined)).toEqual([])
  })

  // Round-4 Issue 3: a footer that could not be cleared is reported, not hidden.
  it('lists the entries whose footer the PDF exporter could not fit', () => {
    expect(footerWarnings([])).toEqual([])
    expect(footerWarnings(undefined)).toEqual([])

    const box = describeExportSuccess(
      {
        dir: 'x',
        files: ['a.pdf', 'b.pdf'],
        skipped: [],
        small: [],
        warnings: ['Semester VII - S: footer does not fit (12px left)']
      },
      'files',
      'pdf'
    )
    expect(box.messages.join('\n')).toContain('Semester VII - S: footer does not fit')
    expect(box.messages.join('\n')).toContain('Warning:')
  })

  it('combined exports carry the same footer warnings', () => {
    const box = describeExportSuccess(
      {
        dir: 'x',
        files: ['All faculty.pdf'],
        skipped: [],
        small: [],
        warnings: ['KN Ms. Kanchan: footer does not fit'],
        count: 3
      },
      'combined',
      'pdf'
    )
    expect(box.messages.join('\n')).toContain('KN Ms. Kanchan: footer does not fit')
  })
})
