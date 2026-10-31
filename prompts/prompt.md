# Timetable Manager: build prompts (phase by phase)

## How to use these

1. Make an empty project folder and put `schema.sql` and `timetable-core.js` (from our chat) inside it.
2. Open your AI coding tool (Claude Code, Cursor, etc.) in that folder.
3. Paste **Prompt 0** first. If your tool supports a project rules file (for example `CLAUDE.md`), save it there as well.
4. Then run the prompts **in order**, one per session or message. After each phase, run the app, check the "You should see" list, and `git commit` before moving on.
5. If a phase fails, paste the exact error back. Don't jump ahead.

---

## Prompt 0: Project brief (paste first)

```
You are helping me build "Timetable Manager", an offline Windows desktop app for the CSE department of Moradabad Institute of Technology. One non-technical user (a professor) will use it to build the department's class timetables.

GOAL
She creates a MASTER timetable (one grid per section). The app then auto-generates every faculty timetable and every venue (classroom/lab) timetable, checks clashes while she edits, and exports Excel and PDF.

STACK (fixed, do not change)
- Electron + React (plain JavaScript, JSX, no TypeScript) scaffolded with electron-vite
- SQLite through better-sqlite3, all DB access in the Electron MAIN process only
- Renderer talks to main only through a preload script with contextBridge (contextIsolation: true, nodeIntegration: false)
- exceljs for Excel export, Electron webContents.printToPDF for PDF export
- No Express server, no MongoDB, no cloud, no login

FILES I ALREADY HAVE (in the project root)
- schema.sql: the full SQLite schema. Treat it as the source of truth for tables.
- timetable-core.js: conflict engine, save/delete slot, section/faculty/venue view queries. Keep its logic. If you must change it, tell me exactly what and why.

DOMAIN RULES (from the real department timetable)
- Days: Mon-Sat (day 1-6). Eight teaching periods: P1 09:05-10:00, P2 10:00-10:55, P3 10:55-11:50, P4 11:50-12:45, LUNCH 12:45-13:40, P5 13:40-14:35, P6 14:35-15:30, P7 15:30-16:25, P8 16:25-17:20. Keep these canonical times in 24-hour format for storage and scheduling; display them in 12-hour format with AM/PM in the UI and exported files.
- A slot has a start period and a span (labs usually take 2 periods). No slot may cross lunch.
- Slot kinds: L (lecture), T (tutorial), P (practical/lab), ACTIVITY (free text like "SUPER - 30", "Sports", with no teacher or venue).
- A section can be split into batches (B1, B2) that run in parallel with different teachers and venues. B1 and B2 never clash with each other; a whole-section slot clashes with any batch slot.
- Parallel electives: two subjects in the same period for the same section (same elective_group value) are allowed, with different teachers and venues.
- A slot can have several teachers (for example VB/RUG). Lab instructors can differ from the subject's default teacher.
- Subject codes appear as "BCS-501" and "BCS501" in her files. Normalize to "BCS501" (uppercase, no dash or space).
- The master timetable (slots) is the ONLY source of truth. Faculty and venue timetables are always queries over slots, never stored copies.
- Conflicts to block: teacher busy, venue taken, section/batch busy, slot across lunch.

WORKING STYLE
- Build exactly what each prompt asks, no extra features.
- Write complete working code, no TODO placeholders, no "implement later".
- After each phase tell me: files created or changed, the exact commands to run, and what I should see.
- Keep the UI clean, large click targets, readable on a normal college PC. She is used to Excel, so keyboard-friendly and fast beats pretty.
- Do not ask me questions unless truly blocked. Make a sensible choice and tell me what you chose.

Reply only with "Ready" and a 5-line summary of how you understood the app.
```

---

## Prompt 1: Scaffold

```
Phase 1: scaffold the app.

1. Create an electron-vite project (React template, JavaScript) in the current folder. Keep schema.sql and timetable-core.js where they are.
2. Install: better-sqlite3, exceljs, react-router-dom (HashRouter, because Electron loads files). Install electron-builder as a dev dependency.
3. Make better-sqlite3 work with Electron (add the postinstall/rebuild step, for example electron-builder install-app-deps). Explain the Electron-vs-Node ABI problem in 3 lines and add two npm scripts: one that rebuilds native modules for Electron (used for `npm run dev`) and one that rebuilds them for plain Node (used for tests).
4. Window: 1280x800 minimum 1100x700, menu bar hidden, title "Timetable Manager".
5. Renderer: a left sidebar with these routes, each a placeholder page with just a heading for now: Dashboard, Master Data, Timetable Setup, Master Timetable, Faculty Timetables, Venue Timetables, Export, Settings.
6. Add a basic global CSS file (system font, light theme, sidebar layout). No UI library.
7. Add a .gitignore and run `git init`.

Done when: `npm run dev` opens the window and I can click through all sidebar pages. Tell me the exact commands.
```

---

## Prompt 2: Database and IPC

```
Phase 2: database layer and IPC bridge.

1. In the main process create src/main/db.js:
   - Open (or create) timetable.db in app.getPath('userData'). Enable WAL and foreign_keys.
   - On every startup run schema.sql (it is idempotent). Make sure schema.sql is bundled correctly in dev and in the packaged app (use an asset import or copy it with the build, not a hardcoded path).
2. Import timetable-core.js (it is CommonJS; make it work with whatever module format this electron-vite project uses, without changing its logic).
3. Create src/main/ipc.js that registers ipcMain.handle channels. Every handler returns { ok: true, data } or { ok: false, error: "readable message" } and never throws into the renderer. Channels:
   - teachers:list, teachers:save (insert or update by id), teachers:delete
   - subjects:list, subjects:save, subjects:delete  (normalize code on save)
   - venues:list, venues:save, venues:delete
   - timetables:list, timetables:save, timetables:delete
   - sections:list(timetableId), sections:save, sections:delete
   - allocations:list(sectionId) returning subject, and its teacher ids; allocations:save(sectionId, subjectId, teacherIds); allocations:delete
   - slots:listBySection(sectionId) returning rows with teacher ids and codes (use sectionTimetable and extend the query if it lacks ids)
   - slots:save(slot, teacherIds, slotId?) -> uses saveSlot; returns { ok:false, problems:[...] } shape for conflicts (keep a "problems" array in the response)
   - slots:check(slot, teacherIds, slotId?) -> checkConflicts only, no write (used for live warnings)
   - slots:delete
   - views:faculty(timetableId, teacherId), views:venue(timetableId, venueId), views:free(timetableId, kind, id)
   - Deleting a teacher/subject/venue that is used by slots must fail with a clear message ("Used in N slots") instead of a raw SQL error.
4. src/preload/index.js: expose window.api with one function per channel via contextBridge, plus a small helper so the renderer can write `const res = await api.teachers.list()`.
5. Add a temporary "DB check" button on the Dashboard that calls teachers:list and prints the result.

Done when: the button shows { ok: true, data: [] } and the app creates timetable.db. Tell me where the db file lives.
```

---

## Prompt 3: Tests and real seed data (verify the engine before any UI)

```
Phase 3: prove the conflict engine works, using a real timetable.

1. Add vitest as a dev dependency and an npm script "test" that runs after rebuilding better-sqlite3 for Node (use the Node-rebuild script from Phase 1). Tests use an in-memory SQLite database loaded with schema.sql.

2. Write scripts/seed-section-b.js (a function that can be reused by tests) that inserts:
   Timetable: "Students Timetable 2026-27 (Odd Semester)", effective_from 2026-07-14, coordinator "Ms. Kanchan", convener "Dr. Lalit Mohan Trivedi".
   Section: semester 5, name B, class_oc "Ms. Prachi Gupta", counselors "Ms. Deepali Agarwal, Mr. Mohd. Ilyas, Ms. Prachi Gupta", default venue B-321.
   Teachers (code, name): KN Ms. Kanchan; PAG Ms. Prachi Agarwal; ATS Dr. Amit Saxena; RUG Ms. Ruchika Gupta; AM Mr. Anurag Malik; VAG Mr. Varun Agarwal; MDG Dr. Modika Gupta; ASP Ms. Ashu Pal; VB Mr. Vikas Bhatnagar; VBR Dr. Vibhor K. Vishnoi; DUA Unknown (DUA); ROS Unknown (ROS).
   Subjects: BCS501 Database Management System; BCS502 Web Technology; BCS503 Design & Analysis Algorithm; BCS052 Data Analytics; BCS055 Machine Learning Techniques; MNPM501 Project Planning and Control; BCS551 DBMS Lab; BCS552 Web Technology Lab; BCS553 DAA Lab; BCS554 Mini Project or Internship Assessment; BNC502 Essence of Indian Traditional Knowledge; HTCS501 Data Encryption and Compression.
   Venues (classroom unless noted): B-321, B-317, B-318; labs: B-109, B-113, B-114.
   Allocations (section B): BCS501 KN; BCS502 PAG; BCS503 ATS; BCS052 RUG; BCS055 AM; MNPM501 VAG; BCS551 KN; BCS552 PAG; BCS553 ATS; BCS554 VB+VBR; BNC502 MDG; HTCS501 ASP.
   Slots (format: day, periods, kind, subject, batch, teachers, venue):
     Mon P1 L BCS502 PAG B-321
     Mon P2 L BCS055 AM B-321
     Mon P3-4 P BCS551 B1 KN B-114
     Mon P3-4 P BCS553 B2 DUA B-113
     Mon P5 L BCS503 ATS B-321
     Mon P6 T BCS502 B1 PAG B-317
     Mon P6 T BCS501 B2 KN B-321
     Mon P7 T BCS503 B1 ATS B-317
     Mon P7 T BCS502 B2 PAG B-321
     Mon P8 L MNPM501 VAG B-318 (elective_group "E1")
     Mon P8 L HTCS501 ASP B-321 (elective_group "E1")
     Tue P1 L BCS052 RUG B-321
     Tue P2 L BCS503 ATS B-321
     Tue P3 L BCS501 KN B-321
     Tue P4 L BNC502 MDG B-321
     Tue P5 L BCS055 AM B-321
     Tue P6-7 P BCS554 VB+RUG B-321
     Tue P8 L MNPM501 VAG B-318 (elective_group "E2")
     Tue P8 L HTCS501 ASP B-321 (elective_group "E2")
     Wed P1-2 P BCS553 B1 ATS B-113
     Wed P1-2 P BCS552 B2 ROS B-109
     Wed P3 L BCS501 KN B-321
     Wed P4 L BCS055 AM B-321
     Wed P5 L MNPM501 VAG B-318 (elective_group "E3")
     Wed P5 L HTCS501 ASP B-321 (elective_group "E3")
     Wed P6 T MNPM501 VAG B-318 (elective_group "E4")
     Wed P6 T HTCS501 ASP B-321 (elective_group "E4")
     Wed P7-8 ACTIVITY label "SUPER - 30"
     Thu P1 L BNC502 MDG B-321
     Thu P2 L BCS501 KN B-321
     Thu P3 L BCS502 PAG B-321
     Thu P4 L BCS052 RUG B-321
     Fri P1 L BCS503 ATS B-321
     Fri P2 L BCS052 RUG B-321
     Fri P3 L BCS502 PAG B-321
     Fri P4 T BCS501 B1 KN B-317
     Fri P4 T BCS503 B2 ATS B-321
     Fri P5-6 P BCS552 B1 PAG B-109
     Fri P5-6 P BCS551 B2 KN B-114
     Fri P7-8 ACTIVITY label "SUPER - 30"
     Sat P1-2 ACTIVITY "Hobbies Club / Literacy Society Activities"
     Sat P3-4 ACTIVITY "Sports"
     Sat P5-8 ACTIVITY "Department Societies Activities"
   (The Mon/Tue P7-8 area of the original sheet also has a SUPER - 30 box that I could not read reliably. Leave it out and put a comment in the seed file: "verify Mon/Tue P7-8 SUPER-30 against the original PDF".)

3. Tests (vitest):
   - Seeding all slots above produces ZERO conflicts (insert them with saveSlot and assert ok).
   - Teacher clash: adding KN at Mon P3 anywhere else is rejected with a teacher problem.
   - Venue clash: a different section in B-321 at Mon P1 is rejected.
   - Section clash: adding a whole-section lecture at Mon P1 for section B is rejected; adding B1 and B2 batch practicals in the same period is accepted.
   - A batch slot conflicts with a whole-section slot in the same period.
   - Lab crossing lunch (P4 with span 2) is rejected.
   - Multi-period overlap: a P-slot on P3-4 conflicts with a lecture on P4 for the same teacher.
   - Editing a slot (slotId passed) does not conflict with itself.
   - facultyTimetable for KN returns exactly KN's seeded slots; venueTimetable for B-114 returns the right ones.
   - Parallel electives with the same elective_group are accepted; the same two subjects without a group are rejected.
   If a test exposes a bug in timetable-core.js, fix it and tell me what changed.

Done when: `npm test` is all green. Show me the test output.
```

---

## Prompt 4: Master data screens

```
Phase 4: the "Master Data" page (teachers, subjects, venues).

Build one page with three tabs: Teachers, Subjects, Venues. Each tab:
- An editable table (not a modal form): click a cell to edit it inline, Enter saves and moves down, Tab moves right, Esc cancels. A blank row at the bottom adds a new record on Enter.
- Columns: Teachers (code, name); Subjects (code, name); Venues (code, name, type classroom/lab).
- Validation: code required and unique (case-insensitive); show the error in the row, not as an alert box. Subject codes are normalized to uppercase with no dash/space and the user sees the normalized value.
- Search box above the table filtering as you type.
- Bulk add: a "Paste from Excel" button opening a text area where she pastes tab-separated rows (code, name[, type]); show a preview with errors, then "Import".
- Delete with a confirmation; if the record is used in slots show the backend's message.

Create a small reusable EditableTable component, as it will be reused later.

Done when: I can add the teachers/subjects/venues of Section B by hand and by paste, edit them, and see validation errors.
```

---

## Prompt 5: Timetable setup (timetable, sections, allocations)

```
Phase 5: the "Timetable Setup" page.

1. Top bar: select the active timetable (term) from a dropdown, a "New timetable" button (title, effective from date, coordinator, convener) and an edit button. Remember the last selected timetable (localStorage in the renderer) and share it across pages through a React context (ActiveTimetableContext).
2. Left list: sections of the active timetable (e.g. "Sem 5 - B"), "Add section" (semester, name, class O.C., counselors, default venue dropdown), edit, delete (with confirm, and say how many slots will be deleted).
3. Right panel for the selected section: the ALLOCATIONS table = which subjects this section studies and with which teachers.
   - Add row: pick subject (searchable dropdown), pick one or more teachers (multi-select chips).
   - Edit and delete rows.
   - Below it, a live preview of the legend table exactly like the bottom of the department PDF: Subject Code, Subject Name, Faculty Code, Faculty Name (two column groups side by side), where multiple teachers show as VB/VBR and "Mr. Vikas Bhatnagar, Dr. Vibhor K. Vishnoi".
4. A "Copy allocations from another section" button (useful when sections share subjects).

Done when: I can create the 2026-27 timetable, section 5-B, and enter all allocations of Section B, with the legend preview looking right.
```

---

## Prompt 6a: Master grid, read-only render

```
Phase 6a: the "Master Timetable" page, read-only rendering first. This is the hardest component, so do it carefully.

Page: section selector (tabs or dropdown, remembered) and the grid.

GRID LAYOUT
- Columns: DAY, P1, P2, P3, P4, a single narrow LUNCH column (vertical text "LUNCH", spanning all day rows), P5, P6, P7, P8. Header shows period time ranges.
- Rows: Mon-Sat. Each day row consists of 2 "lanes" (sub-rows) so that parallel things can sit on top of each other like the real PDF.
- LANES: compute them per day with interval partitioning. A whole-section slot (batch null) occupies ALL lanes of that day for its periods (merged vertically). Batch B1 prefers lane 1, B2 lane 2. Electives in the same elective_group go to separate lanes in order. If more than 2 lanes are needed on a day, add lanes dynamically for that day.
- A slot spans `span` period columns (colSpan). Never render across the lunch column.
- Cell content (centered, small font):
   whole-section L slot:  "BCS502 (L)" / teacher codes joined with "/" / venue
   batch slot:            "BCS551 (P) B1 KN B-114" style on two lines
   ACTIVITY:              just the label (merged across its periods, lighter background)
- Empty cells are blank with a faint border.
- Colour-code by kind: L white, T light blue, P light green, ACTIVITY light grey. Print-friendly.
- Below the grid: the legend (reuse the component from Phase 5).
- Header above the grid replicates the department format: college name, department name, "STUDENTS TIMETABLE - 2026-27 (ODD SEMESTER)", "w.e.f.", Semester/Section, Class O.C., Counselors, and at the bottom the coordinator and convener names.

Put the layout algorithm (lane assignment + colSpan/rowSpan calculation) in a separate pure function file src/renderer/lib/gridLayout.js and write vitest tests for it using the Mon/Tue/Wed/Fri data of Section B (seed it with scripts/seed-section-b.js through the real IPC data shape).

Done when: Section B renders and visually matches the PDF structure: 2-period labs merged, B1/B2 stacked, electives stacked, SUPER - 30 merged, Saturday blocks merged.
```

---

## Prompt 6b: Master grid, editing

```
Phase 6b: make the master grid editable.

1. Click an empty cell (or press Enter on a focused cell) -> a small popover editor anchored to the cell, not a full-screen modal:
   - Kind: L / T / P / Activity (segmented buttons). Default L; if the clicked period can hold a lab and the user picks P, default span to 2.
   - Subject: searchable dropdown listing only this section's allocated subjects (type to filter by code or name). For Activity: a free-text label with suggestions from earlier labels ("SUPER - 30", "Sports", ...).
   - Batch: Whole section / B1 / B2.
   - Span: 1-4 (disable values that would cross lunch or the end of the day).
   - Teachers: pre-filled from the subject's allocation (chips, editable, add any teacher).
   - Venue: pre-filled from the section's default venue, or the lab list when kind is P.
   - Elective group: an optional field shown only via an "Parallel elective" toggle, which auto-fills the group if the same period already has a slot for this section.
   - Buttons: Save, Delete (when editing), Cancel.
2. Click an existing slot to edit it. Editing must never conflict with itself.
3. Keyboard: arrow keys move the focused cell, Enter opens the editor, Delete removes the slot (confirm), Esc closes the popover.
4. After save or delete, refetch the section's slots and re-render.
5. Do NOT implement conflict UI beyond showing the error text returned by the backend inside the popover. That comes next.

Done when: I can rebuild Section B's whole timetable by hand from scratch using only this editor and it matches the seeded one.
```

---

## Prompt 6c: Live conflict warnings and speed features

```
Phase 6c: conflict feedback and editing speed.

1. LIVE CHECK: while the editor popover is open, call slots:check (debounced 200 ms) whenever kind, batch, span, teachers, venue, or elective group changes. Show problems as red messages under the form (each with an icon by type: teacher, venue, section, lunch). Disable Save while there are problems.
2. SMART DROPDOWNS: in the Teachers and Venue pickers, mark options that are already busy at this day/period range as disabled with a small note ("busy: Tue P3, Sem 5-A BCS501"). Add a backend channel slots:busy(timetableId, day, startPeriod, span, ignoreSlotId) returning the busy teacher ids and venue ids with a short reason, and use it for this. (Teachers/venues of the slot being edited must not be marked busy.)
3. COPY/PASTE: Ctrl+C on a focused slot copies it; Ctrl+V on another empty cell pastes it (same subject/teachers/venue/kind/span/batch) after running the conflict check; if it conflicts, show the problems in a small toast instead of saving.
4. UNDO/REDO: keep an in-memory stack of the last 30 changes made in this session on this page (save, delete, paste). Ctrl+Z / Ctrl+Y re-apply the inverse through the same IPC calls.
5. A "Check whole timetable" button that re-validates every slot against all others and lists any problem in a panel (useful after future imports). Add the backend channel timetable:validate(timetableId) which uses checkConflicts per slot.
6. An unobtrusive status bar: "Section 5-B: 38 slots, 0 conflicts".

Done when: selecting a teacher already teaching elsewhere shows them disabled with the reason, a clashing save is impossible, and Ctrl+C/V/Z work.
```

---

## Prompt 7: Faculty and venue timetables

```
Phase 7: generated views.

1. "Faculty Timetables" page: teacher dropdown (search) + list of all teachers on the left with their weekly period count. Selecting one renders their timetable using the SAME grid layout engine as the master (reuse gridLayout.js and the cell component) but read-only. Cell content for faculty view: subject code (kind), section ("5-B" plus batch), venue. Parallel slots in the same period (e.g. teacher teaches two sections together) must be stacked, never overwritten.
2. "Venue Timetables" page: the same, for venues. Cell content: subject code, section/batch, teacher codes.
3. Both pages show a "Free periods" toggle that greys the free cells and displays the total free count, using views:free.
4. Each view has a heading in the same department format, e.g. "FACULTY TIMETABLE: Ms. Kanchan (KN) 2026-27 Odd Semester" and a legend listing the subjects that appear in it.
5. Clicking a slot in these views jumps to that section on the Master Timetable page and highlights the cell.

Done when: KN's timetable shows Mon P3-4, Mon P6, Tue P3, Wed P3, Thu P2, Fri P4, Fri P5-6 from the seeded Section B data, and B-114 shows its two lab slots.
```

---

## Prompt 8a: Excel export

```
Phase 8a: Excel export with exceljs, in the main process.

Export functions (called through IPC, saved with a native "Save as" dialog):
1. exportSectionExcel(sectionId): one .xlsx with one sheet, laid out like the department PDF:
   - Title rows (college, department, timetable title, w.e.f.), semester/section/O.C./counselors line.
   - The period header row with time ranges, and a merged LUNCH column.
   - Each day uses 2 rows (lanes); merge cells exactly as the grid does (period colSpan, whole-section slots merged across both lanes, activities merged).
   - Borders on everything, centered wrapped text, readable column widths, landscape A4, fit to one page wide, repeat nothing.
   - The legend table below, then coordinator and convener at the bottom.
2. exportFacultyExcel(timetableId, teacherId) and exportVenueExcel(timetableId, venueId): same layout.
3. exportAll(timetableId, kind) where kind is "sections", "faculty", or "venues": asks for a folder (native dialog) and writes one file per entry, plus a single combined workbook option with one sheet per entry (sheet names <= 31 chars, sanitized).
4. Reuse the same pure layout function gridLayout.js (move it to a shared folder importable from both main and renderer).

Export page (the "Export" route): choose What (sections/faculty/venues), Which (all or pick), Format (Excel here, PDF later), and a Run button with progress and a success message with "Open folder".

Done when: the exported Section B workbook opens in Excel and looks like her PDF, merged cells included.
```

---

## Prompt 8b: PDF export

```
Phase 8b: PDF export using Electron's printToPDF.

1. Create an HTML print template (src/main/print/template.js producing a full HTML string) that renders the same timetable layout: college header, department, title, semester/section line, O.C. and counselors line, the grid as an HTML table with the same colSpan/rowSpan from gridLayout.js, the legend as a 4-column-group table, and the coordinator/convener signature line. Use inline CSS: A4 landscape, font Times-like serif at 9-10 pt, thin black borders, lunch column, grey activities. The grid and legend must fit on ONE page.
2. A hidden BrowserWindow loads the HTML (data URL or temp file), waits for load, calls webContents.printToPDF({ landscape: true, pageSize: 'A4', printBackground: true, margins in cm small }), then closes the window and writes the file.
3. Add exportSectionPdf, exportFacultyPdf, exportVenuePdf and extend exportAll to produce one PDF per entry, or one merged multi-page PDF (one page per entry; use page-break-after in the HTML so a single printToPDF call is enough).
4. Wire the Format option on the Export page (Excel / PDF / Both).

Done when: the Section B PDF is one clean landscape page that resembles her original, and "export all faculty as one PDF" gives one page per teacher.
```

---

## Prompt 9: Polish, safety, backup

```
Phase 9: make it safe and friendly for a non-technical user.

1. DASHBOARD: cards for the active timetable showing counts (sections, teachers, subjects, venues, slots), a list of sections with "slots filled" and a conflict count (from timetable:validate), and quick links.
2. BACKUP/RESTORE (Settings page):
   - "Backup now" saves a copy of timetable.db to a location she chooses (use SQLite's backup API or a safe copy after WAL checkpoint).
   - "Restore backup" asks for confirmation, checks the chosen file is a valid SQLite DB with the expected tables, makes an automatic backup of the current DB first, replaces it, and restarts the app.
   - Automatic daily backup on app start into a "Backups" folder in userData, keeping the last 14.
3. "Duplicate timetable" action: copy a whole timetable (sections, allocations, slots, slot_teachers) to a new term title so next semester starts from this one.
4. ERROR HANDLING: a global error boundary in React with a friendly message and "Copy details" button; log main-process errors to a file in userData/logs.
5. Confirm before closing the window if an editor popover has unsaved changes.
6. Small UX: loading states, empty states with a hint ("No sections yet, click Add section"), consistent toasts, and a Help page that explains the 5 steps: Master Data -> Timetable Setup -> Master Timetable -> Faculty/Venue views -> Export.

Done when: I can break things on purpose (delete, restore, wrong file) and the app recovers with clear messages.
```

---

## Prompt 10: Package for Windows

```
Phase 10: build a Windows installer.

1. Configure electron-builder for Windows (NSIS installer, per-user install without admin rights, desktop shortcut, app name "Timetable Manager", a simple generated icon placeholder I can replace later).
2. Make sure better-sqlite3 is unpacked correctly (asarUnpack) and schema.sql is available at runtime in the packaged build.
3. Add npm script "dist" and explain the exact command and where the installer file appears.
4. Test checklist for the packaged app, which I will run on a clean PC: first launch creates the db, data persists after closing, exports save to disk, backup/restore works, no console window.
5. Add a short README.md with: how to run in dev, how to run tests, how to build, where the data lives, and how to restore data on a new PC.

Done when: `npm run dist` produces an installer, and installing it on a PC without Node works end to end.
```

---

## Prompt 11 (later, not for v1): Import from her files

```
Phase 11: import existing timetables.

First, ask me to provide a sample of her Excel file. Then build "Import" on the Export page's sibling "Import" route:
1. Excel import with exceljs: the user picks a file, the app reads the sheet, detects the period header row, the day rows, merged cells (spans), and cells containing text like "BCS-551(P) B1 KN B-114". Parse each cell with a tolerant parser (subject code with optional dash, (L)/(T)/(P), optional batch B1/B2, teacher codes separated by "/", venue like B-321) and build a DRAFT list of slots.
2. A review screen listing every parsed slot with its original cell text, parsed fields, and any problem (unknown teacher/subject/venue, unparseable cell, conflicts via checkConflicts). The user can fix fields inline, create missing teachers/subjects/venues, then Import. Nothing is written to the DB before she approves.
3. Never silently guess. Anything uncertain is flagged.
4. (Optional second step) a PDF import path that first extracts text with positions using pdfjs-dist, tries the same parser, and falls back to the review screen.

Done when: importing a real section file gives a draft that she can review and approve in a couple of minutes.
```