// template.js — builds the full HTML string printToPDF renders inside a hidden
// BrowserWindow. Pure string work: no Electron, no DOM, no database. The
// layout comes from the shared sheet model (desktop-shared/sheetModel.js),
// the same one that drives the Excel workbook and the on-screen grid, so the
// PDF, the workbook and the app all agree on every merge.

import { LUNCH_AFTER } from '../../../desktop-shared/gridLayout.js'
import { splitLegend } from '../../../desktop-shared/legend.js'
import { PAGE_BOX_MM, SHEET_MM, SHEET_PAD_MM } from './pdfLayout.js'

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** The letters of the LUNCH column, written one per line like the sheet. */
const LUNCH_LETTERS = ['L', 'U', 'N', 'C', 'H']

// The page box and the inner padding live in pdfLayout.js so the CSS and the
// measuring script can never disagree about where the content starts.
const CSS = `
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; box-shadow: none; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Times New Roman", "Liberation Serif", Times, serif;
  font-size: 9pt;
  color: #000;
  background: #fff;
}
/* One timetable per printed page, on a fixed box so nothing can push a second
   page. Content is pinned to the TOP of the box (6 mm) and 8 mm from the
   sides; pdf.js measures .fit and scales it down per sheet. */
.sheet {
  position: relative;
  width: ${PAGE_BOX_MM.width}mm;
  height: ${PAGE_BOX_MM.height}mm;
  overflow: hidden;
  break-inside: avoid;
  page-break-after: always;
  break-after: page;
}
.sheet:last-child { page-break-after: auto; break-after: auto; }
.fit {
  position: absolute;
  top: ${SHEET_PAD_MM.top}mm;
  left: ${SHEET_PAD_MM.side}mm;
  width: ${SHEET_MM.width}mm;
  transform-origin: top left;
}
/* Only used when a sheet would need to shrink below the readable limit:
   tighten padding, line height and the legend font, then measure again. */
body.tight .grid th, body.tight .grid td { padding: 0 1px; line-height: 1; font-size: 8.5pt; }
body.tight .legend th, body.tight .legend td { padding: 0 2px; font-size: 8pt; line-height: 1; }
body.tight .lg-title { margin: 1mm 0 1px; font-size: 9pt; }
body.tight .head .college { font-size: 10pt; }
body.tight .head .dept { font-size: 9pt; }

/* Minimum height of one day: 13 mm before scaling. Every lane row inside a
   day is at least half of that, so a day with no lecture still looks like a
   day (round-4 Issue 4); a day with 3 lanes simply grows. */
:root { --day-min-height: 13mm; --lane-min-height: calc(var(--day-min-height) / 2); }

.head { text-align: center; margin: 0 0 1.2mm; line-height: 1.12; }
.head .college { font-size: 10.5pt; font-weight: bold; }
.head .dept { font-size: 9pt; }
.head .ptitle { font-size: 10pt; font-weight: bold; }
.head .eff { font-size: 9pt; font-style: italic; }

/* Round-4 Issue 3: Semester / Class O.C. / Counselors on ONE bordered row. */
.head .meta {
  display: flex;
  align-items: stretch;
  margin-top: 0.8mm;
  border: 1px solid #000;
  font-size: 9pt;
  font-weight: 400;
  text-align: center;
}
.head .meta span {
  padding: 1px 4px;
  display: flex;
  align-items: center;
  line-height: 1.1;
  overflow-wrap: break-word;
}
.head .meta span + span { border-left: 1px solid #000; }
.head .meta .sem { flex: 0 0 20%; justify-content: flex-start; }
.head .meta .oc { flex: 0 0 30%; justify-content: center; }
.head .meta .couns { flex: 1 1 50%; justify-content: flex-end; }

table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.grid th, .grid td {
  border: 1px solid #000;
  padding: 1px 2px;
  text-align: center;
  vertical-align: middle;
  font-size: 9pt;
  font-weight: 400;
  line-height: 1.05;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
/* Round-4 Issue 5: nothing inside a timetable cell is bold. Only the day
   names, the period/time header cells, the LUNCH letters and the corner
   header stay bold — enforced explicitly so th/strong/b/h* defaults cannot
   sneak in. */
.grid th *, .grid td * { font-weight: 400; }
.grid thead th, .grid thead th * { font-weight: bold; }
.grid thead th .time { font-size: 7.5pt; }
.grid tbody .day { font-weight: bold; }
.grid tbody tr { height: var(--lane-min-height); }
.grid td.act { background: #d9d9d9; }

/* The LUNCH column of the day rows: one tall cell, the word written letter by
   letter from top to bottom, no timing text (that stays in the header). */
.grid td.lunch { padding: 0; }
.grid td.lunch, .grid td.lunch * { font-weight: bold; }
.lunch-word { display: block; line-height: 1.4; }
.lunch-word span { display: block; font-size: 9.5pt; }

.lg-title { font-size: 9.5pt; font-weight: bold; margin: 1.5mm 0 1px; }
table.legend { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; }
.legend th, .legend td {
  border: 1px solid #000;
  padding: 1px 3px;
  text-align: center;
  vertical-align: middle;
  font-weight: 400;
  line-height: 1.05;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.sign { display: flex; margin-top: 2.5mm; font-size: 9.5pt; font-weight: 400; }
.sign span { width: 50%; text-align: center; }
`

function metaStripHtml({ metaLeft, metaRight, counselors }) {
  if (!metaLeft && !metaRight && !counselors) return ''
  return (
    `    <div class="meta">` +
    `<span class="sem">${esc(metaLeft)}</span>` +
    `<span class="oc">${esc(metaRight)}</span>` +
    `<span class="couns">${esc(counselors)}</span>` +
    `</div>`
  )
}

function headHtml(model) {
  const { college, department, title, effective } = model.header
  const lines = [
    `<div class="college">${esc(college)}</div>`,
    `<div class="dept">${esc(department)}</div>`
  ]
  if (title) lines.push(`<div class="ptitle">${esc(title)}</div>`)
  if (effective) lines.push(`<div class="eff">${esc(effective)}</div>`)
  const strip = metaStripHtml(model.header)
  if (strip) lines.push(strip)
  return `  <div class="head">\n${lines.map((line) => `    ${line}`).join('\n')}\n  </div>`
}

/** LUNCH written vertically, one letter per line, no timing text. */
function lunchWordHtml() {
  return (
    '<span class="lunch-word">' +
    LUNCH_LETTERS.map((letter) => `<span>${letter}</span>`).join('') +
    '</span>'
  )
}

/**
 * The grid table. Same cells as the on-screen grid: a day label spanning its
 * lane rows, the LUNCH column merged down the whole sheet, slot cells carrying
 * their colSpan (labs) and laneSpan (whole-section lectures), covered cells
 * omitted because the span above/left already paints them.
 */
function gridHtml(model) {
  const headCells = ['<th class="day">DAY</th>']
  for (const period of model.periodHeader) {
    if (period.no === LUNCH_AFTER + 1) {
      headCells.push(
        `<th class="lunch">LUNCH<br><span class="time">${esc(model.lunch.time)}</span></th>`
      )
    }
    headCells.push(
      `<th>${esc(period.label)}<br><span class="time">${esc(period.time)}</span></th>`
    )
  }

  const rows = []
  let lunchPlaced = false
  for (const day of model.grid.days) {
    day.lanes.forEach((lane, laneIndex) => {
      const cells = []
      if (laneIndex === 0) {
        cells.push(`<td class="day" rowspan="${day.laneCount}">${esc(day.label)}</td>`)
      }
      lane.forEach((cell, index) => {
        if (index + 1 === LUNCH_AFTER + 1 && !lunchPlaced) {
          cells.push(
            `<td class="lunch" rowspan="${model.grid.totalLaneRows}">${lunchWordHtml()}</td>`
          )
          lunchPlaced = true
        }
        if (cell.type === 'covered') return
        if (cell.type === 'empty') {
          cells.push('<td></td>')
          return
        }
        const attrs = []
        if (cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`)
        if (cell.laneSpan > 1) attrs.push(`rowspan="${cell.laneSpan}"`)
        const className = cell.shade === 'activity' ? ' class="act"' : ''
        const attrText = attrs.length ? ` ${attrs.join(' ')}` : ''
        cells.push(
          `<td${className}${attrText}>${cell.lines.map(esc).join('<br>')}</td>`
        )
      })
      rows.push(`      <tr>${cells.join('')}</tr>`)
    })
  }

  return `  <table class="grid">
    <colgroup><col style="width:5%"><col span="4" style="width:11.25%"><col style="width:5%"><col span="4" style="width:11.25%"></colgroup>
    <thead><tr>${headCells.join('')}</tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`
}

/**
 * Legend in the department sheet's two column groups: code | subject name |
 * faculty code | faculty name, twice side by side.
 */
function legendHtml(model) {
  const entries = model.legend
  if (!entries.length) return ''
  const { rowCount, left, right } = splitLegend(entries)

  const headRow =
    '<tr><th>Subject Code</th><th>Subject Name</th><th>Faculty Code</th><th>Faculty Name</th>' +
    '<th>Subject Code</th><th>Subject Name</th><th>Faculty Code</th><th>Faculty Name</th></tr>'

  const bodyRows = Array.from({ length: rowCount }, (_, index) => {
    const cells = []
    for (const entry of [left[index], right[index]]) {
      if (!entry) {
        cells.push('<td></td><td></td><td></td><td></td>')
        continue
      }
      cells.push(
        `<td>${esc(entry.code)}</td>`,
        `<td>${esc(entry.name)}</td>`,
        `<td>${esc(entry.teachers || '—')}</td>`,
        `<td>${esc(entry.teacherNames || '—')}</td>`
      )
    }
    return `      <tr>${cells.join('')}</tr>`
  }).join('\n')

  const cols =
    '<col style="width:6%"><col style="width:16%"><col style="width:5%"><col style="width:23%">' +
    '<col style="width:6%"><col style="width:16%"><col style="width:5%"><col style="width:23%">'

  return `  <div class="lg-title">Legend</div>
  <table class="legend">
    <colgroup>${cols}</colgroup>
    <thead>${headRow}</thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>`
}

function footerHtml(model) {
  const { coordinator, convener } = model.footer
  if (!coordinator && !convener) return ''
  return `  <div class="sign"><span>Coordinator: ${esc(
    coordinator || '—'
  )}</span><span>Convener: ${esc(convener || '—')}</span></div>`
}

function sheetHtml(model) {
  const title = String(model?.labels?.short ?? '').replace(/"/g, ' ')
  return `  <section class="sheet" data-title="${esc(title)}">
    <div class="fit">
${headHtml(model)}
${gridHtml(model)}
${legendHtml(model)}
${footerHtml(model)}
    </div>
  </section>`
}

/**
 * One or many sheet models -> one full HTML document. Several models give one
 * <section class="sheet"> each, and the page-break CSS turns a single
 * printToPDF call into one printed page per entry.
 *
 * @param {object|object[]} models
 * @returns {string} complete HTML document
 */
export function buildPrintHtml(models) {
  const list = Array.isArray(models) ? models : [models]
  const sheets = list.map(sheetHtml).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Timetable export</title>
<style>
${CSS}
</style>
</head>
<body>
${sheets}
</body>
</html>
`
}
