import { ipcMain } from 'electron'
import { getDb } from './db'
import timetableCore from '../../timetable-core.js'
import { toEnvelope } from './ipcEnvelope.js'
import {
  backupInfo,
  backupNow,
  inspectRestore,
  openBackupsFolder,
  pickRestoreFile,
  restoreBackup
} from './backupApi.js'
import { setEditorDirty } from './closeState.js'
import { logError } from './logger.js'
import {
  fail,
  normalizeSubjectCode,
  requireId,
  requireText,
  optionalId,
  optionalText,
  normalizeTeacherIds,
  slotsListBySection,
  slotsSave,
  slotsCheck,
  slotsMergeCandidates,
  slotsJoinMerge,
  slotsLeaveGroup,
  slotsBusy,
  slotsDelete
} from './slotsApi.js'
import {
  availabilityCopy,
  availabilityGet,
  availabilityMatrix,
  availabilitySave,
  availabilitySummary
} from './availabilityApi.js'
import {
  chooseFolder,
  exportCombined,
  exportFacultyPdf,
  exportOne,
  exportSectionPdf,
  exportSingle,
  exportVenuePdf,
  modelFor,
  openFolder
} from './exportExcel'

/**
 * Every channel answers { ok: true, data } or { ok: false, error }.
 * Nothing thrown inside a handler reaches the renderer as an exception:
 * the shape itself lives in ./ipcEnvelope.js, shared with the tests that
 * drive the same envelope.
 */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    const response = await toEnvelope(() => fn(getDb(), ...args))
    if (!response.ok) {
      console.error(`[ipc] ${channel} failed: ${response.error}`)
    }
    return response
  })
}

// ---------- small validators ----------
// The shared ones (requireId, fail, …) live in ./slotsApi.js.

function countLabel(count, singular, plural) {
  return count === 1 ? singular : plural
}

export function registerIpcHandlers() {
  // ---------------- Teachers ----------------
  handle('teachers:list', (db) =>
    db.prepare('SELECT id, code, name FROM teachers ORDER BY code').all()
  )

  handle('teachers:save', (db, teacher = {}) => {
    const code = requireText(teacher.code, 'Teacher code')
    const name = requireText(teacher.name, 'Teacher name')
    const duplicate = db
      .prepare('SELECT id FROM teachers WHERE code = ? COLLATE NOCASE AND id != ?')
      .get(code, Number(teacher.id) || -1)
    if (duplicate) fail(`Teacher code "${code}" already exists.`)

    if (teacher.id) {
      const id = requireId(teacher.id, 'Teacher')
      const result = db.prepare('UPDATE teachers SET code = ?, name = ? WHERE id = ?').run(code, name, id)
      if (!result.changes) fail('That teacher no longer exists.')
      return db.prepare('SELECT id, code, name FROM teachers WHERE id = ?').get(id)
    }
    const info = db.prepare('INSERT INTO teachers (code, name) VALUES (?, ?)').run(code, name)
    return db.prepare('SELECT id, code, name FROM teachers WHERE id = ?').get(info.lastInsertRowid)
  })

  handle('teachers:delete', (db, teacherId) => {
    const id = requireId(teacherId, 'Teacher')
    if (!db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)) fail('That teacher no longer exists.')

    const slots = db.prepare('SELECT COUNT(*) AS count FROM slot_teachers WHERE teacher_id = ?').get(id).count
    if (slots > 0) {
      fail(`Used in ${slots} ${countLabel(slots, 'slot', 'slots')}. Remove those classes first.`)
    }
    const allocations = db
      .prepare('SELECT COUNT(*) AS count FROM allocation_teachers WHERE teacher_id = ?')
      .get(id).count
    if (allocations > 0) {
      fail(
        `Used in ${allocations} subject ${countLabel(allocations, 'allocation', 'allocations')}. Remove ${allocations === 1 ? 'it' : 'them'} first.`
      )
    }

    db.prepare('DELETE FROM teachers WHERE id = ?').run(id)
    return { id }
  })

  // ---------------- Subjects ----------------
  handle('subjects:list', (db) =>
    db.prepare('SELECT id, code, name FROM subjects ORDER BY code').all()
  )

  handle('subjects:save', (db, subject = {}) => {
    const code = normalizeSubjectCode(requireText(subject.code, 'Subject code'))
    if (!code) fail('Subject code is required.')
    const name = requireText(subject.name, 'Subject name')
    const duplicate = db
      .prepare('SELECT id FROM subjects WHERE code = ? COLLATE NOCASE AND id != ?')
      .get(code, Number(subject.id) || -1)
    if (duplicate) fail(`Subject code "${code}" already exists.`)

    if (subject.id) {
      const id = requireId(subject.id, 'Subject')
      const result = db.prepare('UPDATE subjects SET code = ?, name = ? WHERE id = ?').run(code, name, id)
      if (!result.changes) fail('That subject no longer exists.')
      return db.prepare('SELECT id, code, name FROM subjects WHERE id = ?').get(id)
    }
    const info = db.prepare('INSERT INTO subjects (code, name) VALUES (?, ?)').run(code, name)
    return db.prepare('SELECT id, code, name FROM subjects WHERE id = ?').get(info.lastInsertRowid)
  })

  handle('subjects:delete', (db, subjectId) => {
    const id = requireId(subjectId, 'Subject')
    if (!db.prepare('SELECT id FROM subjects WHERE id = ?').get(id)) fail('That subject no longer exists.')

    const slots = db.prepare('SELECT COUNT(*) AS count FROM slots WHERE subject_id = ?').get(id).count
    if (slots > 0) {
      fail(`Used in ${slots} ${countLabel(slots, 'slot', 'slots')}. Remove those classes first.`)
    }
    const allocations = db
      .prepare('SELECT COUNT(*) AS count FROM allocations WHERE subject_id = ?')
      .get(id).count
    if (allocations > 0) {
      fail(
        `Used by ${allocations} section ${countLabel(allocations, 'allocation', 'allocations')}. Remove ${allocations === 1 ? 'it' : 'them'} first.`
      )
    }

    db.prepare('DELETE FROM subjects WHERE id = ?').run(id)
    return { id }
  })

  // ---------------- Venues ----------------
  handle('venues:list', (db) =>
    db.prepare('SELECT id, code, name, kind FROM venues ORDER BY code').all()
  )

  handle('venues:save', (db, venue = {}) => {
    const code = requireText(venue.code, 'Venue code')
    const name = optionalText(venue.name)
    const kind = String(venue.kind ?? 'classroom').trim().toLowerCase()
    if (kind !== 'classroom' && kind !== 'lab') fail('Venue kind must be "classroom" or "lab".')

    const duplicate = db
      .prepare('SELECT id FROM venues WHERE code = ? COLLATE NOCASE AND id != ?')
      .get(code, Number(venue.id) || -1)
    if (duplicate) fail(`Venue code "${code}" already exists.`)

    if (venue.id) {
      const id = requireId(venue.id, 'Venue')
      const result = db
        .prepare('UPDATE venues SET code = ?, name = ?, kind = ? WHERE id = ?')
        .run(code, name, kind, id)
      if (!result.changes) fail('That venue no longer exists.')
      return db.prepare('SELECT id, code, name, kind FROM venues WHERE id = ?').get(id)
    }
    const info = db.prepare('INSERT INTO venues (code, name, kind) VALUES (?, ?, ?)').run(code, name, kind)
    return db.prepare('SELECT id, code, name, kind FROM venues WHERE id = ?').get(info.lastInsertRowid)
  })

  handle('venues:delete', (db, venueId) => {
    const id = requireId(venueId, 'Venue')
    if (!db.prepare('SELECT id FROM venues WHERE id = ?').get(id)) fail('That venue no longer exists.')

    const slots = db.prepare('SELECT COUNT(*) AS count FROM slots WHERE venue_id = ?').get(id).count
    if (slots > 0) {
      fail(`Used in ${slots} ${countLabel(slots, 'slot', 'slots')}. Move those classes first.`)
    }
    const sections = db
      .prepare('SELECT COUNT(*) AS count FROM sections WHERE default_venue_id = ?')
      .get(id).count
    if (sections > 0) {
      fail(
        `Set as the default venue of ${sections} ${countLabel(sections, 'section', 'sections')}. Change that first.`
      )
    }

    db.prepare('DELETE FROM venues WHERE id = ?').run(id)
    return { id }
  })

  // ---------------- Timetables ----------------
  handle('timetables:list', (db) =>
    db.prepare(
      'SELECT id, title, effective_from, coordinator, convener FROM timetables ORDER BY id'
    ).all()
  )

  handle('timetables:save', (db, timetable = {}) => {
    const title = requireText(timetable.title, 'Timetable title')
    const values = [
      title,
      optionalText(timetable.effective_from),
      optionalText(timetable.coordinator),
      optionalText(timetable.convener)
    ]

    if (timetable.id) {
      const id = requireId(timetable.id, 'Timetable')
      const result = db
        .prepare(
          'UPDATE timetables SET title = ?, effective_from = ?, coordinator = ?, convener = ? WHERE id = ?'
        )
        .run(...values, id)
      if (!result.changes) fail('That timetable no longer exists.')
      return db.prepare('SELECT * FROM timetables WHERE id = ?').get(id)
    }
    const info = db
      .prepare(
        'INSERT INTO timetables (title, effective_from, coordinator, convener) VALUES (?, ?, ?, ?)'
      )
      .run(...values)
    return db.prepare('SELECT * FROM timetables WHERE id = ?').get(info.lastInsertRowid)
  })

  handle('timetables:delete', (db, timetableId) => {
    const id = requireId(timetableId, 'Timetable')
    if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(id)) {
      fail('That timetable no longer exists.')
    }
    db.prepare('DELETE FROM timetables WHERE id = ?').run(id)
    return { id }
  })

  handle('timetables:duplicate', (db, timetableId, newTitle) => {
    const id = requireId(timetableId, 'Timetable')
    const title = requireText(newTitle, 'New timetable title')
    return timetableCore.duplicateTimetable(db, id, title)
  })

  handle('timetables:overview', (db, timetableId) =>
    timetableCore.dashboardOverview(db, requireId(timetableId, 'Timetable'))
  )

  // ---------------- Sections ----------------
  handle('sections:list', (db, timetableId) => {
    const id = requireId(timetableId, 'Timetable')
    return db
      .prepare(
        `SELECT s.id, s.timetable_id, s.semester, s.name, s.class_oc, s.counselors,
                s.default_venue_id, v.code AS default_venue_code,
                (SELECT COUNT(*) FROM slots sl WHERE sl.section_id = s.id) AS slot_count,
                (SELECT COUNT(*) FROM allocations al WHERE al.section_id = s.id) AS allocation_count
         FROM sections s
         LEFT JOIN venues v ON v.id = s.default_venue_id
         WHERE s.timetable_id = ?
         ORDER BY s.semester, s.name`
      )
      .all(id)
  })

  handle('sections:save', (db, section = {}) => {
    const timetableId = requireId(section.timetable_id, 'Timetable')
    const semester = Number(section.semester)
    if (!Number.isInteger(semester) || semester < 1 || semester > 8) {
      fail('Semester must be a whole number from 1 to 8.')
    }
    const name = requireText(section.name, 'Section name')
    const classOc = optionalText(section.class_oc)
    const counselors = optionalText(section.counselors)
    const defaultVenueId = optionalId(section.default_venue_id, 'Default venue')

    if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(timetableId)) {
      fail('That timetable no longer exists.')
    }
    const duplicate = db
      .prepare(
        'SELECT id FROM sections WHERE timetable_id = ? AND semester = ? AND name = ? AND id != ?'
      )
      .get(timetableId, semester, name, Number(section.id) || -1)
    if (duplicate) fail(`Sem ${semester}-${name} already exists in this timetable.`)

    if (section.id) {
      const id = requireId(section.id, 'Section')
      const result = db
        .prepare(
          `UPDATE sections
           SET timetable_id = ?, semester = ?, name = ?, class_oc = ?, counselors = ?, default_venue_id = ?
           WHERE id = ?`
        )
        .run(timetableId, semester, name, classOc, counselors, defaultVenueId, id)
      if (!result.changes) fail('That section no longer exists.')
      return db.prepare('SELECT * FROM sections WHERE id = ?').get(id)
    }
    const info = db
      .prepare(
        `INSERT INTO sections (timetable_id, semester, name, class_oc, counselors, default_venue_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(timetableId, semester, name, classOc, counselors, defaultVenueId)
    return db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid)
  })

  handle('sections:delete', (db, sectionId) => {
    const id = requireId(sectionId, 'Section')
    if (!db.prepare('SELECT id FROM sections WHERE id = ?').get(id)) fail('That section no longer exists.')
    db.prepare('DELETE FROM sections WHERE id = ?').run(id)
    return { id }
  })

  // ---------------- Allocations ----------------
  handle('allocations:list', (db, sectionId) => {
    const id = requireId(sectionId, 'Section')
    const rows = db
      .prepare(
        `SELECT a.id, a.section_id, a.subject_id, sub.code AS subject_code, sub.name AS subject_name
         FROM allocations a
         JOIN subjects sub ON sub.id = a.subject_id
         WHERE a.section_id = ?
         ORDER BY sub.code`
      )
      .all(id)

    const teacherStmt = db.prepare(
      `SELECT t.id, t.code
       FROM allocation_teachers at
       JOIN teachers t ON t.id = at.teacher_id
       WHERE at.allocation_id = ?
       ORDER BY t.code`
    )

    return rows.map((row) => {
      const teachers = teacherStmt.all(row.id)
      return {
        ...row,
        teacher_ids: teachers.map((t) => t.id),
        teacher_codes: teachers.map((t) => t.code)
      }
    })
  })

  handle('allocations:save', (db, sectionId, subjectId, teacherIds) => {
    const section = requireId(sectionId, 'Section')
    const subject = requireId(subjectId, 'Subject')
    const teachers = normalizeTeacherIds(teacherIds)

    if (!db.prepare('SELECT id FROM sections WHERE id = ?').get(section)) fail('That section no longer exists.')
    if (!db.prepare('SELECT id FROM subjects WHERE id = ?').get(subject)) fail('That subject no longer exists.')
    for (const teacherId of teachers) {
      if (!db.prepare('SELECT id FROM teachers WHERE id = ?').get(teacherId)) {
        fail('One of the selected teachers no longer exists.')
      }
    }

    const id = db.transaction(() => {
      const existing = db
        .prepare('SELECT id FROM allocations WHERE section_id = ? AND subject_id = ?')
        .get(section, subject)
      let allocationId
      if (existing) {
        allocationId = existing.id
      } else {
        allocationId = Number(
          db
            .prepare('INSERT INTO allocations (section_id, subject_id) VALUES (?, ?)')
            .run(section, subject).lastInsertRowid
        )
      }

      db.prepare('DELETE FROM allocation_teachers WHERE allocation_id = ?').run(allocationId)
      const insert = db.prepare(
        'INSERT INTO allocation_teachers (allocation_id, teacher_id) VALUES (?, ?)'
      )
      for (const teacherId of teachers) insert.run(allocationId, teacherId)
      return allocationId
    })()

    return db.prepare('SELECT * FROM allocations WHERE id = ?').get(id)
  })

  handle('allocations:delete', (db, allocationId) => {
    const id = requireId(allocationId, 'Allocation')
    if (!db.prepare('SELECT id FROM allocations WHERE id = ?').get(id)) {
      fail('That allocation no longer exists.')
    }
    db.prepare('DELETE FROM allocations WHERE id = ?').run(id)
    return { id }
  })

  // ---------------- Slots (master timetable) ----------------
  // The handler bodies are in ./slotsApi.js (shared with the bug tests); the
  // registration below is the same code the renderer's IPC reaches.
  handle('slots:listBySection', slotsListBySection)
  handle('slots:save', slotsSave)
  handle('slots:check', slotsCheck)
  handle('slots:merge-candidates', slotsMergeCandidates)
  handle('slots:join-merge', slotsJoinMerge)
  handle('slots:leave-group', slotsLeaveGroup)
  handle('slots:busy', slotsBusy)
  handle('slots:delete', slotsDelete)

  // ---------------- Availability requests ----------------
  handle('availability:get', availabilityGet)
  handle('availability:save', availabilitySave)
  handle('availability:matrix', availabilityMatrix)
  handle('availability:summary', availabilitySummary)
  handle('availability:copy', availabilityCopy)

  // ---------------- Backup and restore ----------------
  handle('backup:info', () => backupInfo())
  handle('backup:now', () => backupNow())
  handle('backup:pick-restore', () => pickRestoreFile())
  handle('backup:inspect', (_db, path) => inspectRestore(path))
  handle('backup:restore', (_db, path) => restoreBackup(path))
  handle('backup:open-folder', () => openBackupsFolder())

  // The close guard is a one-way flag; the window's close handler reads it.
  ipcMain.on('app:editor-dirty', (_event, dirty) => setEditorDirty(dirty))
  ipcMain.handle('logs:renderer', (_event, payload = {}) => {
    logError('renderer', payload.message || 'Renderer error', payload)
    return { ok: true, data: true }
  })

  handle('timetable:validate', (db, timetableId) => {
    const id = requireId(timetableId, 'Timetable')
    if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(id)) {
      fail('That timetable no longer exists.')
    }
    return timetableCore.validateTimetable(db, id)
  })

  // ---------------- Generated views ----------------
  handle('views:faculty', (db, timetableId, teacherId) => {
    return timetableCore.facultyTimetable(
      db,
      requireId(timetableId, 'Timetable'),
      requireId(teacherId, 'Teacher')
    )
  })

  handle('views:venue', (db, timetableId, venueId) => {
    return timetableCore.venueTimetable(
      db,
      requireId(timetableId, 'Timetable'),
      requireId(venueId, 'Venue')
    )
  })

  handle('views:free', (db, timetableId, kind, id) => {
    const timetable = requireId(timetableId, 'Timetable')
    const target = requireId(id, 'Id')
    const normalizedKind = String(kind ?? '').trim().toLowerCase()

    let busyRows
    if (normalizedKind === 'teacher' || normalizedKind === 'faculty') {
      busyRows = timetableCore.facultyTimetable(db, timetable, target)
    } else if (normalizedKind === 'venue') {
      busyRows = timetableCore.venueTimetable(db, timetable, target)
    } else {
      fail('Free-period lookup must be for a "teacher" or a "venue".')
    }
    return timetableCore.freePeriods(busyRows)
  })

  handle('views:summary', (db, timetableId) => {
    const timetable = requireId(timetableId, 'Timetable')
    if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(timetable)) {
      fail('That timetable no longer exists.')
    }
    return timetableCore.viewsSummary(db, timetable)
  })

  // ---------------- Excel / PDF export ----------------
  const EXPORT_KINDS = ['section', 'faculty', 'venue']
  const requireExportKind = (kind) => {
    const normalized = String(kind ?? '').trim().toLowerCase()
    if (!EXPORT_KINDS.includes(normalized)) fail('Export kind must be "section", "faculty" or "venue".')
    return normalized
  }
  const EXPORT_FORMATS = ['excel', 'pdf', 'both']
  const requireExportFormat = (format) => {
    const normalized = String(format ?? 'excel').trim().toLowerCase()
    if (!EXPORT_FORMATS.includes(normalized)) {
      fail('Format must be "excel", "pdf" or "both".')
    }
    return normalized
  }
  const PDF_SINGLES = {
    section: exportSectionPdf,
    faculty: exportFacultyPdf,
    venue: exportVenuePdf
  }

  handle('export:choose-folder', () => chooseFolder())

  handle('export:single', (db, kind, timetableId, id, format) => {
    const exportKind = requireExportKind(kind)
    const exportFormat = requireExportFormat(format)
    const timetable = requireId(timetableId, 'Timetable')
    const entryId = requireId(id, 'Id')
    if (exportFormat === 'pdf') return PDF_SINGLES[exportKind](db, timetable, entryId)
    return exportSingle(db, exportKind, timetable, entryId, exportFormat)
  })

  handle('export:one', (db, timetableId, kind, id, dir, format) => {
    const timetable = requireId(timetableId, 'Timetable')
    if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(timetable)) {
      fail('That timetable no longer exists.')
    }
    if (!String(dir ?? '').trim()) fail('Choose an export folder first.')
    return exportOne(
      db,
      requireExportKind(kind),
      timetable,
      requireId(id, 'Id'),
      String(dir),
      requireExportFormat(format)
    )
  })

  handle('export:combined', (db, timetableId, kind, dir, format) => {
    const timetable = requireId(timetableId, 'Timetable')
    if (!db.prepare('SELECT id FROM timetables WHERE id = ?').get(timetable)) {
      fail('That timetable no longer exists.')
    }
    if (!String(dir ?? '').trim()) fail('Choose an export folder first.')
    return exportCombined(
      db,
      timetable,
      requireExportKind(kind),
      String(dir),
      requireExportFormat(format)
    )
  })

  // Used by the Export page to preview a single sheet's file name.
  handle('export:preview', (db, kind, timetableId, id) => {
    return modelFor(db, requireExportKind(kind), timetableId, requireId(id, 'Id')).labels
  })

  handle('export:open-folder', (_db, folder) => openFolder(folder))
}
