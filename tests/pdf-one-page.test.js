import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FOOTER_MIN_MM, mmToPx } from '../src/main/print/pdfLayout.js'

const here = dirname(fileURLToPath(import.meta.url))
const RUNNER_TIMEOUT_MS = 5 * 60 * 1000

/** The real Electron binary, not the npm CLI shim and not Node. */
function electronBinary() {
  const require_ = createRequire(join(here, '..', 'package.json'))
  const electronDist = dirname(require_.resolve('electron')) // node_modules/electron
  const exe =
    process.platform === 'win32'
      ? join(electronDist, 'dist', 'electron.exe')
      : join(electronDist, 'dist', 'electron')
  expect(existsSync(exe), `electron binary missing at ${exe}`).toBe(true)
  return exe
}

let result

beforeAll(() => {
  // Console streams in Electron main can arrive out of order or get cut off on
  // exit, so the runner writes its JSON result to a file under the test's
  // own temp dir and we read that afterwards.
  const resultPath = join(here, 'electron', 'pdf-export-result.tmp.json')
  const run = spawnSync(
    electronBinary(),
    [join(here, 'electron', 'pdf-export-runner.mjs'), resultPath],
    { encoding: 'utf8', timeout: RUNNER_TIMEOUT_MS }
  )
  expect(existsSync(resultPath),
    `the Electron runner produced no result file.\nstdout:\n${run.stdout}\n` +
      `stderr:\n${run.stderr}`
  ).toBeTruthy()
  result = JSON.parse(readFileSync(resultPath, 'utf8'))
  rmSync(resultPath, { force: true })
})

describe('PDF export prints exactly one page per timetable (round-3 Issue 5)', () => {
  it('Section B exports as exactly one page at a readable scale', () => {
    const { error } = result.sectionB
    expect(error, `Section B export failed: ${error}`).toBeUndefined()
    expect(result.sectionB.pages).toBe(1)
    expect(result.sectionB.scales).toHaveLength(1)
    expect(result.sectionB.titles[0]).toContain('Semester V - B')
    expect(result.sectionB.scales[0]).toBeGreaterThanOrEqual(0.7)
  })

  it('the stress fixture (3 lanes, merged lectures, 3 counselors) is exactly one page', () => {
    expect(result.stress.error, `stress export failed: ${result.stress.error}`).toBeUndefined()
    expect(result.stress.pages).toBe(1)
    expect(result.stress.titles[0]).toContain('Semester VII - S')
  })

  it('five timetables in one combined PDF print as exactly five pages', () => {
    expect(result.combined.error, `combined export failed: ${result.combined.error}`).toBeUndefined()
    expect(result.combined.pages).toBe(result.combined.expected)
    expect(result.combined.expected).toBe(5)
  })
})

describe('the coordinator/convener line is never clipped (round-4 Issue 3)', () => {
  const minimum = mmToPx(FOOTER_MIN_MM)

  for (const key of ['sectionB', 'stress']) {
    it(`${key}: every sheet leaves the footer clear of the sheet bottom`, () => {
      const entry = result[key]
      expect(entry.error, `${key} export failed: ${entry.error}`).toBeUndefined()
      expect(entry.footerGaps).toHaveLength(entry.expected)
      for (const gap of entry.footerGaps) {
        expect(gap).toBeGreaterThanOrEqual(minimum)
      }
      expect(entry.warnings).toEqual([])
    })
  }

  it('combined: every sheet keeps its footer inside the page', () => {
    const entry = result.combined
    expect(entry.error, `combined export failed: ${entry.error}`).toBeUndefined()
    expect(entry.footerGaps).toHaveLength(entry.expected)
    for (const gap of entry.footerGaps) expect(gap).toBeGreaterThanOrEqual(minimum)
    expect(entry.warnings).toEqual([])
  })

  it('keeps the content at the top: the scale is only ever a shrink', () => {
    for (const key of ['sectionB', 'stress', 'combined']) {
      for (const scale of result[key].scales) {
        expect(scale).toBeGreaterThan(0)
        expect(scale).toBeLessThanOrEqual(1)
      }
    }
  })
})
