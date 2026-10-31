// stress-fixture.mjs — the layout-stress section used by the one-page tests
// and by `npm run check:pdf`. Raw SQL on purpose: it tests LAYOUT, not engine
// rules, and must stay deterministic whatever section B contains.

/**
 * Adds two sections to `timetableId`: section VII-S gets a Monday with THREE
 * lanes (two batch practicals plus an overlapping activity), a merged lecture
 * across both stress sections, a two-teacher slot, several legend rows and a
 * long O.C. / three-counselor line. Section VII-T is the other half of the
 * merged lecture.
 *
 * @returns {{ sectionId: number, sectionBId: number, slotIds: number[] }}
 */
export function seedStress(db, timetableId, { subjectIds, teacherIds, venueIds }) {
  const insertSection = db.prepare(
    `INSERT INTO sections (timetable_id, semester, name, class_oc, counselors)
     VALUES (?, ?, ?, ?, ?)`
  )
  const sectionId = Number(
    insertSection.run(
      timetableId,
      7,
      'S',
      'Ms. A Very Long Class O.C. Name With An Unusual Amount Of Words',
      'Counselor One (Ms. C1), Counselor Two (Dr. C2), Counselor Three (Ms. C3)'
    ).lastInsertRowid
  )
  const sectionBId = Number(
    insertSection.run(
      timetableId,
      7,
      'T',
      'Ms. Second Stress OC',
      'Counselor One (Ms. C1), Counselor Two (Dr. C2)'
    ).lastInsertRowid
  )

  const insertSlot = db.prepare(
    `INSERT INTO slots (section_id, day, start_period, span, kind, subject_id,
                        batch_no, elective_group, venue_id, label, merge_group)
     VALUES (@section_id, @day, @start_period, @span, @kind, @subject_id,
             @batch_no, NULL, @venue_id, @label, @merge_group)`
  )
  const put = db.prepare('INSERT INTO slot_teachers (slot_id, teacher_id) VALUES (?, ?)')

  function slot(overrides) {
    const row = insertSlot.run({
      section_id: sectionId,
      day: 1,
      start_period: 1,
      span: 1,
      kind: 'L',
      subject_id: null,
      batch_no: null,
      venue_id: null,
      label: null,
      merge_group: null,
      ...overrides
    })
    return Number(row.lastInsertRowid)
  }

  const ids = { sectionId, sectionBId, slotIds: [] }

  // Monday: batch 1 + batch 2 practicals, then an activity through P7-P8 that
  // overlaps them -> exactly 3 lanes that day (round-2 Issue 6 example).
  const lab1 = slot({ day: 1, start_period: 6, span: 2, kind: 'P', subject_id: subjectIds.BCS551, batch_no: 1, venue_id: venueIds['B-114'] })
  put.run(lab1, teacherIds.DUA)
  const lab2 = slot({ day: 1, start_period: 6, span: 2, kind: 'P', subject_id: subjectIds.BCS552, batch_no: 2, venue_id: venueIds['B-109'] })
  put.run(lab2, teacherIds.ROS)
  const super30 = slot({ day: 1, start_period: 7, span: 2, kind: 'ACTIVITY', label: 'SUPER - 30' })
  ids.slotIds.push(lab1, lab2, super30)

  // Merged lecture across the two stress sections: same real-world class.
  const group = 'stress-merge-1'
  const mergedA = slot({ day: 4, start_period: 1, kind: 'L', subject_id: subjectIds.BCS501, venue_id: venueIds['B-321'], merge_group: group })
  const mergedB = insertSlot.run({
    section_id: sectionBId,
    day: 4,
    start_period: 1,
    span: 1,
    kind: 'L',
    subject_id: subjectIds.BCS501,
    batch_no: null,
    venue_id: venueIds['B-321'],
    label: null,
    merge_group: group
  })
  put.run(mergedA, teacherIds.KN)
  put.run(Number(mergedB.lastInsertRowid), teacherIds.KN)
  ids.slotIds.push(mergedA, Number(mergedB.lastInsertRowid))

  // Several more legend rows, with a two-teacher slot among them.
  const extras = [
    { day: 2, start_period: 1, subject_id: subjectIds.BCS052, venue_id: venueIds['B-321'], teachers: [teacherIds.KN] },
    { day: 2, start_period: 5, subject_id: subjectIds.BCS554, venue_id: venueIds['B-317'], teachers: [teacherIds.VB, teacherIds.VBR] },
    { day: 3, start_period: 1, subject_id: subjectIds.BCS502, venue_id: venueIds['B-317'], teachers: [teacherIds.RUG] },
    { day: 3, start_period: 5, subject_id: subjectIds.HTCS501, venue_id: venueIds['B-321'], teachers: [teacherIds.ASP] },
    { day: 5, start_period: 1, subject_id: subjectIds.MNPM501, venue_id: venueIds['B-318'], teachers: [teacherIds.VAG] }
  ]
  for (const extra of extras) {
    if (subjectIds[extra.subject_id] === undefined) continue
    const id = slot({ day: extra.day, start_period: extra.start_period, kind: 'L', subject_id: extra.subject_id, venue_id: extra.venue_id })
    for (const teacherId of extra.teachers) put.run(id, teacherId)
    ids.slotIds.push(id)
  }

  return ids
}
