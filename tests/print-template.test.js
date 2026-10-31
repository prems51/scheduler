import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import timetableCore from '../timetable-core.js'
import seedModule from '../scripts/seed-section-b.js'
import { buildSheetModel } from '../desktop-shared/sheetModel.js'
import { buildPrintHtml } from '../src/main/print/template'

const { seedSectionB, SECTION } = seedModule
const here = dirname(fileURLToPath(import.meta.url))

let db
let seeded

beforeAll(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(here, '..', 'schema.sql'), 'utf8'))
  seeded = seedSectionB(db)
})

afterAll(() => {
  db.close()
})

function modelOf(kind) {
  const timetable = db.prepare('SELECT * FROM timetables WHERE id = ?').get(seeded.timetableId)
  const teachers = db.prepare('SELECT id, code, name FROM teachers').all()
  if (kind === 'section') {
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(seeded.sectionId)
    const rows = timetableCore.sectionSlots(db, seeded.sectionId)
    return buildSheetModel('section', { rows, timetable, section, teachers })
  }
  if (kind === 'faculty') {
    const rows = timetableCore.facultyTimetable(db, seeded.timetableId, seeded.teacherIds.KN)
    const teacher = db
      .prepare('SELECT id, code, name FROM teachers WHERE id = ?')
      .get(seeded.teacherIds.KN)
    return buildSheetModel('faculty', { rows, timetable, entity: teacher, teachers })
  }
  const rows = timetableCore.venueTimetable(db, seeded.timetableId, seeded.venueIds['B-114'])
  const venue = db.prepare('SELECT id, code, name FROM venues WHERE code = ?').get('B-114')
  return buildSheetModel('venue', { rows, timetable, entity: venue, teachers })
}

/**
 * Walks the printed table the way a browser does: cells are placed left to
 * right, skipping positions already claimed by a rowspan/colspan. Returns the
 * grid dimensions and how many positions got filled; a healthy sheet fills
 * every position of (totalLaneRows x 10) exactly once.
 */
function layoutStats(html) {
  const table = /<table class="grid">([\s\S]*?)<\/table>/.exec(html)
  expect(table, 'grid table present').toBeTruthy()
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(table[1])
  expect(tbody, 'tbody present').toBeTruthy()
  const rows = [...tbody[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1])

  const occupied = new Map()
  let columns = 0
  rows.forEach((row, r) => {
    let c = 0
    for (const cell of row.matchAll(/<td([^>]*)>/g)) {
      while (occupied.has(`${r},${c}`)) c += 1
      const colspan = Number(/colspan="(\d+)"/.exec(cell[1])?.[1] ?? 1)
      const rowspan = Number(/rowspan="(\d+)"/.exec(cell[1])?.[1] ?? 1)
      for (let rr = r; rr < r + rowspan; rr += 1) {
        for (let cc = c; cc < c + colspan; cc += 1) {
          expect(occupied.has(`${rr},${cc}`), `overlap at row ${rr} col ${cc}`).toBe(false)
          occupied.set(`${rr},${cc}`, true)
        }
      }
      c += colspan
    }
    columns = Math.max(columns, c)
  })

  return { rowCount: rows.length, columns, filled: occupied.size }
}

describe('buildPrintHtml — the section B sheet', () => {
  const html = () => buildPrintHtml([modelOf('section')])

  it('is a complete standalone document in Times serif with page-break CSS', () => {
    const doc = html()
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<meta charset="utf-8">')
    expect(doc).toContain('font-family: "Times New Roman", "Liberation Serif", Times, serif')
    // Round-3/4: the fixed one-page box, one page per timetable.
    expect(doc).toContain('@page { size: A4 landscape; margin: 0; }')
    expect(doc).toContain('.sheet {')
    expect(doc).toContain('width: 297mm;')
    expect(doc).toContain('height: 209mm;')
    expect(doc).toContain('overflow: hidden;')
    expect(doc).toContain('break-inside: avoid;')
    expect(doc).toContain('page-break-after: always;')
    expect(doc).toContain('break-after: page;')
    expect(doc).toContain('.sheet:last-child { page-break-after: auto; break-after: auto; }')

    // Round-4 Issue 3: pinned to the top, 6 mm down and 8 mm in from the sides.
    expect(doc).toContain('.fit {')
    expect(doc).toContain('position: absolute;')
    expect(doc).toContain('top: 6mm;')
    expect(doc).toContain('left: 8mm;')
    expect(doc).toContain('width: 281mm;')
    expect(doc).toContain('transform-origin: top left;')
    // No vertical centring and no page-level margin that pushed the content down.
    expect(doc).not.toContain('margin: 8mm auto')
    const fitCss = /\.fit \{([^}]*)\}/.exec(doc)[1]
    expect(fitCss).not.toContain('display: flex')
    expect(fitCss).not.toContain('align-items')
    expect(fitCss).not.toContain('translateY')
    expect(doc).not.toContain('<script')
    expect(doc.match(/<section class="sheet" data-title="/g)).toHaveLength(1)
    // The printable content is inside the .fit block pdf.js measures and scales.
    expect(doc).toContain('<div class="fit">')
  })

  it('prints the department header, the O.C. and the counselors', () => {
    const doc = html()
    expect(doc).toContain(
      '<div class="college">MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD</div>'
    )
    expect(doc).toContain(
      '<div class="dept">Department of Computer Science &amp; Engineering</div>'
    )
    expect(doc).toContain('<div class="ptitle">STUDENTS TIMETABLE 2026-27 (ODD SEMESTER)</div>')
    expect(doc).toContain('<div class="eff">w.e.f. 14-07-2026</div>')
    expect(doc).toContain('Semester: V - B')
    expect(doc).toContain(`Class O.C.: ${SECTION.class_oc}`)
    expect(doc).toContain('Counselors: Ms. Deepali Agarwal')
  })

  it('prints the period header with the merged LUNCH column', () => {
    const doc = html()
    expect(doc).toContain('<th class="day">DAY</th>')
    expect(doc).toContain('<th>P1<br><span class="time">9:05–10:00 AM</span></th>')
    expect(doc).toContain('<th>P4<br><span class="time">11:50 AM–12:45 PM</span></th>')
    expect(doc).toContain('<th class="lunch">LUNCH<br><span class="time">12:45–1:40 PM</span></th>')
    expect(doc).toContain('<th>P5<br><span class="time">1:40–2:35 PM</span></th>')
    expect(doc).toContain('<th>P8<br><span class="time">4:25–5:20 PM</span></th>')
    // The LUNCH header comes after P4 and before P5.
    expect(doc.indexOf('11:50 AM–12:45 PM')).toBeLessThan(doc.indexOf('>LUNCH<br>'))
    expect(doc.indexOf('>LUNCH<br>')).toBeLessThan(doc.indexOf('1:40–2:35 PM'))
    // Exactly the ten columns: DAY + 8 periods + lunch.
    const headCells = /<thead><tr>([\s\S]*?)<\/tr><\/thead>/.exec(doc)[1].match(/<th/g)
    expect(headCells).toHaveLength(10)
  })

  it('tiles the whole 12-row grid with the real colSpan/rowSpan merges', () => {
    const doc = html()
    expect(doc).toContain('<td class="day" rowspan="2">MON</td>')
    expect(doc).toContain('<td class="day" rowspan="2">SAT</td>')
    // Round-4 Issue 5: the lunch column is MERGED down all twelve lane rows and
    // carries only the word, written one letter per line — no timing text.
    expect(doc).toContain(
      '<td class="lunch" rowspan="12"><span class="lunch-word">' +
        '<span>L</span><span>U</span><span>N</span><span>C</span><span>H</span>' +
        '</span></td>'
    )
    // Mon P3-4 B1 lab spanning two period columns, on its batch lane.
    expect(doc).toContain('<td colspan="2">BCS551 (P) B1<br>KN B-114</td>')
    // Whole-section lecture merged across both lanes of the day.
    expect(doc).toContain('<td rowspan="2">BCS052 (L)<br>RUG<br>B-321</td>')
    // Saturday's four-period activity, grey and spanning P5-8 x 2 lanes.
    expect(doc).toContain(
      '<td class="act" colspan="4" rowspan="2">Department Societies Activities</td>'
    )

    const { rowCount, columns, filled } = layoutStats(doc)
    expect(rowCount).toBe(12) // 6 days x 2 lanes
    expect(columns).toBe(10) // day + lunch + 8 periods
    expect(filled).toBe(120) // every position painted exactly once
  })

  it('prints the legend as two column groups with codes, names and faculty names', () => {
    const doc = html()
    expect(doc).toContain('<div class="lg-title">Legend</div>')
    expect(doc).toContain(
      '<th>Subject Code</th><th>Subject Name</th><th>Faculty Code</th><th>Faculty Name</th>' +
        '<th>Subject Code</th><th>Subject Name</th><th>Faculty Code</th><th>Faculty Name</th>'
    )
    expect(doc).toContain('<td>Design &amp; Analysis Algorithm</td>')
    expect(doc).toContain('<td>Ms. Kanchan</td>')
    expect(doc).toContain('<td>RUG/VB</td>')
  })

  it('prints the coordinator and convener line', () => {
    expect(html()).toContain(
      '<div class="sign"><span>Coordinator: Ms. Kanchan</span>' +
        '<span>Convener: Dr. Lalit Mohan Trivedi</span></div>'
    )
  })

  it('escapes hostile text instead of injecting markup', () => {
    const model = modelOf('section')
    const saturday = model.grid.days.find((day) => day.day === 6)
    const activity = saturday.lanes.flat().find((cell) => cell.type === 'slot')
    activity.lines = ['Sports <script>alert("x")</script> & Culture']
    activity.label = activity.lines[0]

    const doc = buildPrintHtml([model])
    expect(doc).not.toContain('<script>alert')
    expect(doc).toContain('Sports &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Culture')
  })
})

describe('buildPrintHtml — generated views', () => {
  it('renders the faculty view with a three-column legend and one sheet', () => {
    const doc = buildPrintHtml([modelOf('faculty')])
    expect(doc).toContain('FACULTY TIMETABLE: Ms. Kanchan (KN) 2026-27 (Odd Semester)')
    // The generated views' legend now names the faculty too.
    expect(doc).toContain('<td>KN</td>')
    expect(doc).toContain('<td>Ms. Kanchan</td>')
    expect(doc.match(/<section class="sheet" data-title="/g)).toHaveLength(1)

    const { rowCount, columns, filled } = layoutStats(doc)
    expect(rowCount).toBe(12)
    expect(columns).toBe(10)
    expect(filled).toBe(120)
  })

  it('renders the venue view with teachers inside the cells', () => {
    const doc = buildPrintHtml([modelOf('venue')])
    expect(doc).toContain('VENUE TIMETABLE: B-114 2026-27 (Odd Semester)')
    expect(doc).toContain('<td>BCS551</td>')
  })

  it('puts one page per entry into a single document for combined exports', () => {
    const doc = buildPrintHtml([modelOf('section'), modelOf('faculty'), modelOf('venue')])
    expect(doc.match(/<section class="sheet" data-title="/g)).toHaveLength(3)
    // Three sheets means two forced breaks plus the trailing-auto rule.
    expect(doc).toContain('.sheet:last-child { page-break-after: auto; break-after: auto; }')
  })
})

describe('round-4 Issue 3 — compact header strip and an un-clippable footer', () => {
  it('puts Semester, Class O.C. and Counselors on ONE bordered row', () => {
    const doc = buildPrintHtml([modelOf('section')])
    const strip = /<div class="meta">([\s\S]*?)<\/div>/.exec(doc)
    expect(strip, 'one meta strip').toBeTruthy()
    expect(strip[1]).toContain('<span class="sem">Semester: V - B</span>')
    expect(strip[1]).toContain(`<span class="oc">Class O.C.: ${SECTION.class_oc}</span>`)
    expect(strip[1]).toMatch(/<span class="couns">Counselors: Ms\. Deepali Agarwal[^<]*<\/span>/)

    // A single flex row with 20% / 30% / 50% columns and a thin border.
    expect(doc).toContain('.head .meta {')
    expect(doc).toContain('border: 1px solid #000;')
    expect(doc).toContain('.head .meta .sem { flex: 0 0 20%;')
    expect(doc).toContain('.head .meta .oc { flex: 0 0 30%;')
    expect(doc).toContain('.head .meta .couns { flex: 1 1 50%;')
    // The counselors are no longer a separate line under the O.C.
    expect(doc).not.toContain('<div class="couns">')
  })

  it('wraps long counselor text inside its own cell instead of overlapping', () => {
    const model = modelOf('section')
    model.header.counselors =
      'Counselors: Ms. A Very Long Counselor Name, Dr. Another Long Name, Ms. Third Long Name'
    const doc = buildPrintHtml([model])
    expect(doc).toContain('overflow-wrap: break-word;')
    expect(doc).toContain(model.header.counselors)
    // Three cells, not absolutely positioned text that could overlap.
    const strip = /<div class="meta">([\s\S]*?)<\/div>/.exec(doc)[1]
    expect(strip.match(/<span class="(sem|oc|couns)"/g)).toHaveLength(3)
  })

  it('keeps the footer inside the scaled .fit block, not absolutely positioned', () => {
    const doc = buildPrintHtml([modelOf('section')])
    const fit = doc.indexOf('<div class="fit">')
    const sign = doc.indexOf('<div class="sign">')
    expect(fit).toBeGreaterThan(-1)
    expect(sign).toBeGreaterThan(fit)
    // The footer is the last thing inside .fit, so measuring/scaling includes it.
    expect(doc.indexOf('</div>\n  </section>')).toBeGreaterThan(sign)

    const signCss = /\.sign \{([^}]*)\}/.exec(doc)[1]
    expect(signCss).not.toContain('position: absolute')
    expect(signCss).toContain('margin-top')
  })
})

describe('round-4 Issue 4 — every day row has a minimum height', () => {
  it('defines a 13 mm day and a 6.5 mm lane minimum and applies it to day rows', () => {
    const doc = buildPrintHtml([modelOf('section')])
    expect(doc).toContain('--day-min-height: 13mm;')
    expect(doc).toContain('--lane-min-height: calc(var(--day-min-height) / 2);')
    expect(doc).toContain('.grid tbody tr { height: var(--lane-min-height); }')
  })

  it('gives empty faculty/venue days the same row height as booked ones', () => {
    for (const kind of ['faculty', 'venue']) {
      const doc = buildPrintHtml([modelOf(kind)])
      // All twelve lane rows exist whether or not the day has a lecture; the
      // height comes from the shared CSS rule above, not from cell content.
      expect(layoutStats(doc).rowCount).toBe(12)
      expect(doc).toContain('.grid tbody tr { height: var(--lane-min-height); }')
    }
  })
})

describe('round-4 Issue 5 — the printed sheet styling', () => {
  const doc = () => buildPrintHtml([modelOf('section')])

  it('bolds only the day names, the period/time header and the LUNCH letters', () => {
    const css = doc()
    expect(css).toContain('.grid th *, .grid td * { font-weight: 400; }')
    expect(css).toContain('.grid thead th, .grid thead th * { font-weight: bold; }')
    expect(css).toContain('.grid tbody .day { font-weight: bold; }')
    expect(css).toContain('.grid td.lunch, .grid td.lunch * { font-weight: bold; }')

    // The activity cell keeps its light grey but is no longer bold.
    expect(css).toContain('.grid td.act { background: #d9d9d9; }')
    const actCss = /\.grid td\.act \{([^}]*)\}/.exec(css)[1]
    expect(actCss).not.toContain('font-weight')

    // Legend cells and the signature line are normal weight.
    expect(/\.legend th, \.legend td \{([^}]*)\}/.exec(css)[1]).toContain('font-weight: 400;')
    expect(/\.sign \{([^}]*)\}/.exec(css)[1]).toContain('font-weight: 400;')
  })

  it('draws every line at 1px and nothing thicker', () => {
    const css = doc()
    const values = [...css.matchAll(/border[^:;]*:\s*([^;]+);/g)].map((match) => match[1])
    expect(values.length).toBeGreaterThan(4)
    for (const value of values) {
      expect(value, value).not.toMatch(/[2-9]\d*(\.\d+)?px/)
      expect(value, value).not.toMatch(/\b(thick|medium|dashed|dotted|double)\b/)
    }
    expect(css).toContain('border-collapse: collapse;')
    // Any box-shadow that survives is the `none` reset, never a real shadow.
    for (const match of css.matchAll(/box-shadow:\s*([^;]*)/g)) {
      expect(match[1].trim()).toBe('none')
    }
    expect(css).not.toContain('outline:')
  })

  it('writes LUNCH letter by letter in the day rows, timing only in the header', () => {
    const html = doc()
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)[1]
    expect(body).toContain(
      '<span class="lunch-word"><span>L</span><span>U</span><span>N</span><span>C</span>' +
        '<span>H</span></span>'
    )
    expect(body).not.toContain('12:45')

    const head = /<thead>([\s\S]*?)<\/thead>/.exec(html)[1]
    expect(head).toContain('LUNCH<br><span class="time">12:45–1:40 PM</span>')

    // One letter per line as blocks — never a rotated writing mode.
    expect(html).toContain('.lunch-word span { display: block;')
    expect(html).not.toContain('writing-mode')
  })
})
