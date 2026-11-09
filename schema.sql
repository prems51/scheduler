PRAGMA foreign_keys = ON;

-- ---------- Master data (typed once, reused everywhere) ----------
CREATE TABLE IF NOT EXISTS teachers (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,          -- KN, PAG, ATS
  name  TEXT NOT NULL                  -- Ms. Kanchan
);

CREATE TABLE IF NOT EXISTS subjects (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,          -- store normalized: BCS501 (PDF mixes "BCS-501" / "BCS501")
  name  TEXT NOT NULL                  -- Database Management System
);

CREATE TABLE IF NOT EXISTS venues (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,          -- B-321
  name  TEXT,
  kind  TEXT NOT NULL DEFAULT 'classroom' CHECK (kind IN ('classroom','lab'))
);

-- Fixed period grid. Lunch sits between period 4 and 5 and is not a period.
CREATE TABLE IF NOT EXISTS periods (
  no          INTEGER PRIMARY KEY,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL
);

INSERT OR IGNORE INTO periods (no, start_time, end_time) VALUES
  (1,'09:05','10:00'), (2,'10:00','10:55'), (3,'10:55','11:50'), (4,'11:50','12:45'),
  (5,'13:40','14:35'), (6,'14:35','15:30'), (7,'15:30','16:25'), (8,'16:25','17:20');

-- ---------- One timetable per semester term ----------
CREATE TABLE IF NOT EXISTS timetables (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,       -- Students Timetable 2026-27 (Odd Semester)
  effective_from  TEXT,                -- w.e.f. 2026-07-14
  coordinator     TEXT,                -- Ms. Kanchan
  convener        TEXT                 -- Dr. Lalit Mohan Trivedi
);

CREATE TABLE IF NOT EXISTS sections (
  id                INTEGER PRIMARY KEY,
  timetable_id      INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  semester          INTEGER NOT NULL,  -- 5
  name              TEXT NOT NULL,     -- B
  class_oc          TEXT,              -- Ms. Prachi Gupta
  counselors        TEXT,              -- comma separated
  default_venue_id  INTEGER REFERENCES venues(id),   -- B-321: pre-fills new cells
  UNIQUE (timetable_id, semester, name)
);

-- "Section B studies BCS501 with KN" -> auto-fills cells and generates the legend table at the bottom of the PDF.
CREATE TABLE IF NOT EXISTS allocations (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id),
  UNIQUE (section_id, subject_id)
);
CREATE TABLE IF NOT EXISTS allocation_teachers (   -- many: BCS554 has VB / VBR
  allocation_id  INTEGER NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  teacher_id     INTEGER NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (allocation_id, teacher_id)
);

-- ---------- The master timetable: the ONLY source of truth ----------
CREATE TABLE IF NOT EXISTS slots (
  id              INTEGER PRIMARY KEY,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  day             INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),        -- 1=Mon ... 6=Sat
  start_period    INTEGER NOT NULL REFERENCES periods(no),
  span            INTEGER NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 4),  -- labs usually 2
  kind            TEXT NOT NULL CHECK (kind IN ('L','T','P','ACTIVITY')),   -- lecture, tutorial, practical
  subject_id      INTEGER REFERENCES subjects(id),
  batch_no        INTEGER CHECK (batch_no IS NULL OR batch_no IN (1, 2)),   -- NULL = whole section; label derived from the section (B -> B1/B2)
  elective_group  TEXT,                -- same value = parallel electives (MNPM501 || HTCS501)
  venue_id        INTEGER REFERENCES venues(id),
  label           TEXT,                -- for ACTIVITY: 'SUPER - 30', 'Sports'
  merge_group     TEXT,                -- same value = one merged lecture across several sections
  constraint_override INTEGER NOT NULL DEFAULT 0,  -- 1 = saved after ignoring a requested unavailability
  CHECK (kind = 'ACTIVITY' OR subject_id IS NOT NULL),
  CHECK (start_period + span - 1 <= 8)
);

-- Many teachers per slot (VB/RUG) and lab instructors who differ from the legend (DUA, ROS).
CREATE TABLE IF NOT EXISTS slot_teachers (
  slot_id     INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (slot_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_slots_day_period   ON slots (day, start_period);
CREATE INDEX IF NOT EXISTS idx_slots_section      ON slots (section_id);
CREATE INDEX IF NOT EXISTS idx_slots_venue        ON slots (venue_id);
CREATE INDEX IF NOT EXISTS idx_slots_merge_group  ON slots (merge_group);

-- ---------- Availability requests (one row per blocked cell) ----------
-- 'cannot' is hard (not available, the editor can override it explicitly),
-- 'avoid' is soft (prefers not, never blocks). target_id is polymorphic, so
-- the triggers below clean it up when a teacher/venue/section is deleted.
CREATE TABLE IF NOT EXISTS availability (
  timetable_id INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL CHECK (target_type IN ('teacher','venue','section')),
  target_id    INTEGER NOT NULL,
  day          INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),
  period       INTEGER NOT NULL CHECK (period BETWEEN 1 AND 8),
  level        TEXT NOT NULL CHECK (level IN ('cannot','avoid')),
  PRIMARY KEY (timetable_id, target_type, target_id, day, period)
);

CREATE TABLE IF NOT EXISTS availability_notes (
  timetable_id INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  target_type  TEXT NOT NULL CHECK (target_type IN ('teacher','venue','section')),
  target_id    INTEGER NOT NULL,
  note         TEXT NOT NULL,
  PRIMARY KEY (timetable_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_target ON availability (timetable_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_availability_cell   ON availability (timetable_id, day, period);
CREATE INDEX IF NOT EXISTS idx_availability_notes_target ON availability_notes (timetable_id, target_type, target_id);

CREATE TRIGGER IF NOT EXISTS trg_teachers_availability AFTER DELETE ON teachers
BEGIN
  DELETE FROM availability WHERE target_type = 'teacher' AND target_id = OLD.id;
  DELETE FROM availability_notes WHERE target_type = 'teacher' AND target_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_venues_availability AFTER DELETE ON venues
BEGIN
  DELETE FROM availability WHERE target_type = 'venue' AND target_id = OLD.id;
  DELETE FROM availability_notes WHERE target_type = 'venue' AND target_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sections_availability AFTER DELETE ON sections
BEGIN
  DELETE FROM availability WHERE target_type = 'section' AND target_id = OLD.id;
  DELETE FROM availability_notes WHERE target_type = 'section' AND target_id = OLD.id;
END;