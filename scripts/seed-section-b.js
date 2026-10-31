// scripts/seed-section-b.js
// Section B, semester 5 - Students Timetable 2026-27 (Odd Semester).
// Reused by tests (in-memory DB) and usable from the main process later.
//
// NOTE: the original sheet also has a "SUPER - 30" box around Mon/Tue P7-8 that
// could not be read reliably - verify Mon/Tue P7-8 SUPER-30 against the original PDF.

import timetableCore from '../timetable-core.js'

const TIMETABLE = {
  title: 'Students Timetable 2026-27 (Odd Semester)',
  effective_from: '2026-07-14',
  coordinator: 'Ms. Kanchan',
  convener: 'Dr. Lalit Mohan Trivedi'
}

const SECTION = {
  semester: 5,
  name: 'B',
  class_oc: 'Ms. Prachi Gupta',
  counselors: 'Ms. Deepali Agarwal, Mr. Mohd. Ilyas, Ms. Prachi Gupta',
  default_venue: 'B-321'
}

const TEACHERS = [
  ['KN', 'Ms. Kanchan'],
  ['PAG', 'Ms. Prachi Agarwal'],
  ['ATS', 'Dr. Amit Saxena'],
  ['RUG', 'Ms. Ruchika Gupta'],
  ['AM', 'Mr. Anurag Malik'],
  ['VAG', 'Mr. Varun Agarwal'],
  ['MDG', 'Dr. Modika Gupta'],
  ['ASP', 'Ms. Ashu Pal'],
  ['VB', 'Mr. Vikas Bhatnagar'],
  ['VBR', 'Dr. Vibhor K. Vishnoi'],
  ['DUA', 'Unknown (DUA)'],
  ['ROS', 'Unknown (ROS)']
]

const SUBJECTS = [
  ['BCS501', 'Database Management System'],
  ['BCS502', 'Web Technology'],
  ['BCS503', 'Design & Analysis Algorithm'],
  ['BCS052', 'Data Analytics'],
  ['BCS055', 'Machine Learning Techniques'],
  ['MNPM501', 'Project Planning and Control'],
  ['BCS551', 'DBMS Lab'],
  ['BCS552', 'Web Technology Lab'],
  ['BCS553', 'DAA Lab'],
  ['BCS554', 'Mini Project or Internship Assessment'],
  ['BNC502', 'Essence of Indian Traditional Knowledge'],
  ['HTCS501', 'Data Encryption and Compression']
]

const VENUES = [
  { code: 'B-321', kind: 'classroom' },
  { code: 'B-317', kind: 'classroom' },
  { code: 'B-318', kind: 'classroom' },
  { code: 'B-109', kind: 'lab' },
  { code: 'B-113', kind: 'lab' },
  { code: 'B-114', kind: 'lab' }
]

// Subject -> teachers from the legend table of the original sheet.
const ALLOCATIONS = {
  BCS501: ['KN'],
  BCS502: ['PAG'],
  BCS503: ['ATS'],
  BCS052: ['RUG'],
  BCS055: ['AM'],
  MNPM501: ['VAG'],
  BCS551: ['KN'],
  BCS552: ['PAG'],
  BCS553: ['ATS'],
  BCS554: ['VB', 'VBR'],
  BNC502: ['MDG'],
  HTCS501: ['ASP']
}

// day: 1=Mon ... 6=Sat, period = start period, span defaults to 1.
const SLOTS = [
  // Monday
  { day: 1, period: 1, kind: 'L', subject: 'BCS502', teachers: ['PAG'], venue: 'B-321' },
  { day: 1, period: 2, kind: 'L', subject: 'BCS055', teachers: ['AM'], venue: 'B-321' },
  { day: 1, period: 3, span: 2, kind: 'P', subject: 'BCS551', batch: 1, teachers: ['KN'], venue: 'B-114' },
  { day: 1, period: 3, span: 2, kind: 'P', subject: 'BCS553', batch: 2, teachers: ['DUA'], venue: 'B-113' },
  { day: 1, period: 5, kind: 'L', subject: 'BCS503', teachers: ['ATS'], venue: 'B-321' },
  { day: 1, period: 6, kind: 'T', subject: 'BCS502', batch: 1, teachers: ['PAG'], venue: 'B-317' },
  { day: 1, period: 6, kind: 'T', subject: 'BCS501', batch: 2, teachers: ['KN'], venue: 'B-321' },
  { day: 1, period: 7, kind: 'T', subject: 'BCS503', batch: 1, teachers: ['ATS'], venue: 'B-317' },
  { day: 1, period: 7, kind: 'T', subject: 'BCS502', batch: 2, teachers: ['PAG'], venue: 'B-321' },
  { day: 1, period: 8, kind: 'L', subject: 'MNPM501', teachers: ['VAG'], venue: 'B-318', elective: 'E1' },
  { day: 1, period: 8, kind: 'L', subject: 'HTCS501', teachers: ['ASP'], venue: 'B-321', elective: 'E1' },

  // Tuesday
  { day: 2, period: 1, kind: 'L', subject: 'BCS052', teachers: ['RUG'], venue: 'B-321' },
  { day: 2, period: 2, kind: 'L', subject: 'BCS503', teachers: ['ATS'], venue: 'B-321' },
  { day: 2, period: 3, kind: 'L', subject: 'BCS501', teachers: ['KN'], venue: 'B-321' },
  { day: 2, period: 4, kind: 'L', subject: 'BNC502', teachers: ['MDG'], venue: 'B-321' },
  { day: 2, period: 5, kind: 'L', subject: 'BCS055', teachers: ['AM'], venue: 'B-321' },
  { day: 2, period: 6, span: 2, kind: 'P', subject: 'BCS554', teachers: ['VB', 'RUG'], venue: 'B-321' },
  { day: 2, period: 8, kind: 'L', subject: 'MNPM501', teachers: ['VAG'], venue: 'B-318', elective: 'E2' },
  { day: 2, period: 8, kind: 'L', subject: 'HTCS501', teachers: ['ASP'], venue: 'B-321', elective: 'E2' },

  // Wednesday
  { day: 3, period: 1, span: 2, kind: 'P', subject: 'BCS553', batch: 1, teachers: ['ATS'], venue: 'B-113' },
  { day: 3, period: 1, span: 2, kind: 'P', subject: 'BCS552', batch: 2, teachers: ['ROS'], venue: 'B-109' },
  { day: 3, period: 3, kind: 'L', subject: 'BCS501', teachers: ['KN'], venue: 'B-321' },
  { day: 3, period: 4, kind: 'L', subject: 'BCS055', teachers: ['AM'], venue: 'B-321' },
  { day: 3, period: 5, kind: 'L', subject: 'MNPM501', teachers: ['VAG'], venue: 'B-318', elective: 'E3' },
  { day: 3, period: 5, kind: 'L', subject: 'HTCS501', teachers: ['ASP'], venue: 'B-321', elective: 'E3' },
  { day: 3, period: 6, kind: 'T', subject: 'MNPM501', teachers: ['VAG'], venue: 'B-318', elective: 'E4' },
  { day: 3, period: 6, kind: 'T', subject: 'HTCS501', teachers: ['ASP'], venue: 'B-321', elective: 'E4' },
  { day: 3, period: 7, span: 2, kind: 'ACTIVITY', label: 'SUPER - 30' },

  // Thursday
  { day: 4, period: 1, kind: 'L', subject: 'BNC502', teachers: ['MDG'], venue: 'B-321' },
  { day: 4, period: 2, kind: 'L', subject: 'BCS501', teachers: ['KN'], venue: 'B-321' },
  { day: 4, period: 3, kind: 'L', subject: 'BCS502', teachers: ['PAG'], venue: 'B-321' },
  { day: 4, period: 4, kind: 'L', subject: 'BCS052', teachers: ['RUG'], venue: 'B-321' },

  // Friday
  { day: 5, period: 1, kind: 'L', subject: 'BCS503', teachers: ['ATS'], venue: 'B-321' },
  { day: 5, period: 2, kind: 'L', subject: 'BCS052', teachers: ['RUG'], venue: 'B-321' },
  { day: 5, period: 3, kind: 'L', subject: 'BCS502', teachers: ['PAG'], venue: 'B-321' },
  { day: 5, period: 4, kind: 'T', subject: 'BCS501', batch: 1, teachers: ['KN'], venue: 'B-317' },
  { day: 5, period: 4, kind: 'T', subject: 'BCS503', batch: 2, teachers: ['ATS'], venue: 'B-321' },
  { day: 5, period: 5, span: 2, kind: 'P', subject: 'BCS552', batch: 1, teachers: ['PAG'], venue: 'B-109' },
  { day: 5, period: 5, span: 2, kind: 'P', subject: 'BCS551', batch: 2, teachers: ['KN'], venue: 'B-114' },
  { day: 5, period: 7, span: 2, kind: 'ACTIVITY', label: 'SUPER - 30' },

  // Saturday
  { day: 6, period: 1, span: 2, kind: 'ACTIVITY', label: 'Hobbies Club / Literacy Society Activities' },
  { day: 6, period: 3, span: 2, kind: 'ACTIVITY', label: 'Sports' },
  { day: 6, period: 5, span: 4, kind: 'ACTIVITY', label: 'Department Societies Activities' }
]

/**
 * Fills an empty schema into a section-B timetable.
 * Slots go through timetableCore.saveSlot, so any conflict throws immediately.
 * Returns the inserted ids, keyed by code, for use in tests.
 */
function seedSectionB(db) {
  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid)

  const timetableId = insert(
    'INSERT INTO timetables (title, effective_from, coordinator, convener) VALUES (?, ?, ?, ?)',
    TIMETABLE.title,
    TIMETABLE.effective_from,
    TIMETABLE.coordinator,
    TIMETABLE.convener
  )

  const venueIds = {}
  for (const venue of VENUES) {
    venueIds[venue.code] = insert(
      'INSERT INTO venues (code, name, kind) VALUES (?, ?, ?)',
      venue.code,
      null,
      venue.kind
    )
  }

  const teacherIds = {}
  for (const [code, name] of TEACHERS) {
    teacherIds[code] = insert('INSERT INTO teachers (code, name) VALUES (?, ?)', code, name)
  }

  const subjectIds = {}
  for (const [code, name] of SUBJECTS) {
    subjectIds[code] = insert('INSERT INTO subjects (code, name) VALUES (?, ?)', code, name)
  }

  const sectionId = insert(
    `INSERT INTO sections (timetable_id, semester, name, class_oc, counselors, default_venue_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    timetableId,
    SECTION.semester,
    SECTION.name,
    SECTION.class_oc,
    SECTION.counselors,
    venueIds[SECTION.default_venue]
  )

  const allocationIds = {}
  for (const [subjectCode, teacherCodes] of Object.entries(ALLOCATIONS)) {
    const allocationId = insert(
      'INSERT INTO allocations (section_id, subject_id) VALUES (?, ?)',
      sectionId,
      subjectIds[subjectCode]
    )
    allocationIds[subjectCode] = allocationId
    for (const teacherCode of teacherCodes) {
      insert(
        'INSERT INTO allocation_teachers (allocation_id, teacher_id) VALUES (?, ?)',
        allocationId,
        teacherIds[teacherCode]
      )
    }
  }

  const slotIds = []
  for (const entry of SLOTS) {
    const slot = {
      section_id: sectionId,
      day: entry.day,
      start_period: entry.period,
      span: entry.span ?? 1,
      kind: entry.kind,
      subject_id: entry.subject ? subjectIds[entry.subject] : null,
      batch_no: entry.batch ?? null,
      elective_group: entry.elective ?? null,
      venue_id: entry.venue ? venueIds[entry.venue] : null,
      label: entry.label ?? null
    }
    const teacherIdsForSlot = (entry.teachers ?? []).map((code) => teacherIds[code])
    const result = timetableCore.saveSlot(db, slot, teacherIdsForSlot)
    if (!result.ok) {
      const problems = result.problems.map((problem) => problem.message).join(' | ')
      throw new Error(
        `Seed conflict on ${entry.day}/${entry.period} (${entry.subject || entry.label}): ${problems}`
      )
    }
    slotIds.push(result.id)
  }

  return {
    timetableId,
    sectionId,
    teacherIds,
    subjectIds,
    venueIds,
    allocationIds,
    slotIds
  }
}

const seed = { seedSectionB, SLOTS, TEACHERS, SUBJECTS, VENUES, ALLOCATIONS, TIMETABLE, SECTION }

export { seedSectionB, SLOTS, TEACHERS, SUBJECTS, VENUES, ALLOCATIONS, TIMETABLE, SECTION }
export default seed
