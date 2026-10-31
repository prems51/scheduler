// legend.js — ONE legend builder for the section, faculty and venue sheets (on
// screen, in Excel and in the PDF). It is derived from the slots actually being
// displayed, not from the allocations, because a lab instructor can differ from
// the allocation (DUA, ROS) and a merged lecture can join two subjects.
//
// A row: Subject Code | Subject Name | Faculty Code(s) | Faculty Name(s)
// Rows are deduplicated by (subject, teacher set), so the same subject taught by
// two different sets shows twice — exactly what the department sheet does.

function codeList(slot) {
  if (Array.isArray(slot.teacher_codes)) {
    return slot.teacher_codes.map((code) => String(code).trim()).filter(Boolean)
  }
  return String(slot.teacher_codes ?? '')
    .split('/')
    .map((code) => code.trim())
    .filter(Boolean)
}

function idList(slot) {
  if (Array.isArray(slot.teacher_ids)) return slot.teacher_ids.map(Number).filter(Number.isFinite)
  return []
}

/**
 * @param {object[]} rows slot rows exactly as the views/exports receive them
 * @param {{ teachers?: {id:number, code:string, name:string}[] }} options
 * @returns {{code:string, name:string, teachers:string, teacherNames:string}[]}
 */
export function buildLegend(rows = [], options = {}) {
  const teachers = options.teachers ?? []
  const namesById = new Map(
    teachers.map((teacher) => [Number(teacher.id), String(teacher.name ?? '').trim()])
  )
  const codesById = new Map(
    teachers.map((teacher) => [Number(teacher.id), String(teacher.code ?? '').trim()])
  )

  const entries = new Map()
  for (const slot of rows ?? []) {
    if (String(slot?.kind ?? '').toUpperCase() === 'ACTIVITY') continue
    const code = String(slot.subject_code ?? '').trim()
    if (!code) continue

    const codes = codeList(slot)
    const ids = idList(slot)
    const names = ids
      .map((id) => namesById.get(id) || codesById.get(id))
      .filter(Boolean)
      .join(', ')
    const key = `${code}|${codes.join('/')}`

    if (entries.has(key)) {
      // Keep the fuller name if a later row knows it.
      const existing = entries.get(key)
      if (!existing.name && slot.subject_name) existing.name = String(slot.subject_name).trim()
      if (!existing.teacherNames && names) existing.teacherNames = names
      continue
    }

    entries.set(key, {
      code,
      name: String(slot.subject_name ?? '').trim(),
      teachers: codes.join('/'),
      teacherNames: names
    })
  }

  return [...entries.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || a.teachers.localeCompare(b.teachers)
  )
}

/**
 * The department sheet prints the legend in two column groups side by side.
 * Returns the two halves so every renderer (screen, Excel, PDF) splits rows the
 * same way.
 */
export function splitLegend(entries = []) {
  const rowCount = Math.ceil(entries.length / 2)
  return {
    rowCount,
    left: entries.slice(0, rowCount),
    right: entries.slice(rowCount),
    hasTeacherNames: entries.some((entry) => entry.teacherNames)
  }
}
