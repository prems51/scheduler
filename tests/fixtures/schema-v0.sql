-- The schema shipped before round 2: slots.batch ('B1'/'B2'), no merge_group.
-- Used only by tests/migration.test.js to prove an existing timetable.db is
-- upgraded without losing data.
PRAGMA foreign_keys = ON;

CREATE TABLE teachers (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE subjects (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE venues (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT,
  kind  TEXT NOT NULL DEFAULT 'classroom' CHECK (kind IN ('classroom','lab'))
);

CREATE TABLE periods (
  no          INTEGER PRIMARY KEY,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL
);

INSERT INTO periods (no, start_time, end_time) VALUES
  (1,'09:05','10:00'), (2,'10:00','10:55'), (3,'10:55','11:50'), (4,'11:50','12:45'),
  (5,'13:40','14:35'), (6,'14:35','15:30'), (7,'15:30','16:25'), (8,'16:25','17:20');

CREATE TABLE timetables (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,
  effective_from  TEXT,
  coordinator     TEXT,
  convener        TEXT
);

CREATE TABLE sections (
  id                INTEGER PRIMARY KEY,
  timetable_id      INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  semester          INTEGER NOT NULL,
  name              TEXT NOT NULL,
  class_oc          TEXT,
  counselors        TEXT,
  default_venue_id  INTEGER REFERENCES venues(id),
  UNIQUE (timetable_id, semester, name)
);

CREATE TABLE allocations (
  id          INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id),
  UNIQUE (section_id, subject_id)
);

CREATE TABLE allocation_teachers (
  allocation_id  INTEGER NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  teacher_id     INTEGER NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (allocation_id, teacher_id)
);

CREATE TABLE slots (
  id              INTEGER PRIMARY KEY,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  day             INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),
  start_period    INTEGER NOT NULL REFERENCES periods(no),
  span            INTEGER NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 4),
  kind            TEXT NOT NULL CHECK (kind IN ('L','T','P','ACTIVITY')),
  subject_id      INTEGER REFERENCES subjects(id),
  batch           TEXT,
  elective_group  TEXT,
  venue_id        INTEGER REFERENCES venues(id),
  label           TEXT,
  CHECK (kind = 'ACTIVITY' OR subject_id IS NOT NULL),
  CHECK (start_period + span - 1 <= 8)
);

CREATE TABLE slot_teachers (
  slot_id     INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (slot_id, teacher_id)
);

CREATE INDEX idx_slots_day_period ON slots (day, start_period);
CREATE INDEX idx_slots_section    ON slots (section_id);
CREATE INDEX idx_slots_venue      ON slots (venue_id);
