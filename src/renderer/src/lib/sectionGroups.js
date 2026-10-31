// sectionGroups.js — one way to group sections by semester, used by the setup
// page, the master timetable's section tabs, the Export page and the copy
// dialog, so the app never shows two different orders.

/**
 * @param {{id:number, semester:number, name:string, slot_count?:number}[]} sections
 * @returns {{semester:number, label:string, sections:object[], withSlots:number, slotCount:number}[]}
 */
export function groupSectionsBySemester(sections = []) {
  const groups = new Map()

  for (const section of sections ?? []) {
    const semester = Number(section.semester)
    if (!Number.isFinite(semester)) continue
    if (!groups.has(semester)) groups.set(semester, [])
    groups.get(semester).push(section)
  }

  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([semester, list]) => ({
      semester,
      label: `Semester ${semester}`,
      sections: [...list].sort((left, right) =>
        String(left.name).localeCompare(String(right.name), undefined, { numeric: true })
      ),
      withSlots: list.filter((section) => Number(section.slot_count ?? 0) > 0).length,
      slotCount: list.reduce((total, section) => total + Number(section.slot_count ?? 0), 0)
    }))
}
