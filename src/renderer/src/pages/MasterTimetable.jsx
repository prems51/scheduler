import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useActiveTimetable } from '../context/ActiveTimetableContext'
import TimetableGrid from '../components/TimetableGrid'
import ConfirmDialog from '../components/ConfirmDialog'
import Toast from '../components/Toast'
import LegendTable from '../components/LegendTable'
import SlotEditor from './masterTimetable/SlotEditor'
import ValidationPanel from './masterTimetable/ValidationPanel'
import { groupSectionsBySemester } from '../lib/sectionGroups'
import {
  activityDraftFor,
  cellAnchorOf,
  contextMenuItems,
  lectureDraftFor
} from '../lib/cellActions'
import { DAYS, DAY_LABELS, PERIODS, buildGrid, slotCellAt } from '@shared/gridLayout'
import { buildLegend } from '@shared/legend'
import {
  commitRedo,
  commitUndo,
  emptyHistory,
  peekRedo,
  peekUndo,
  pushChange,
  snapshotFromPayload,
  snapshotFromRow,
  withSlotId
} from '../lib/slotHistory'

const SECTION_STORAGE_KEY = 'timetable-manager:master-section-id'
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
const EDITOR_WIDTH = 392

function readStoredSectionId() {
  const stored = Number(window.localStorage.getItem(SECTION_STORAGE_KEY))
  return Number.isInteger(stored) && stored > 0 ? stored : null
}

/** 2026-07-14 -> 14-07-2026, the way the department sheet writes w.e.f. */
function formatDate(value) {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text
}

export default function MasterTimetable() {
  const { activeTimetable, activeId } = useActiveTimetable()
  const location = useLocation()

  // A click inside a generated view lands here with { sectionId, day, period }.
  const jump = useMemo(() => {
    const state = location.state
    const sectionId = Number(state?.sectionId)
    const day = Number(state?.day)
    const period = Number(state?.period)
    if (!Number.isInteger(sectionId) || sectionId <= 0) return null
    if (!(day >= 1 && day <= 6) || !(period >= 1 && period <= 8)) return null
    return { sectionId, day, period }
  }, [location.state])
  const appliedJumpRef = useRef(null)

  const [teachers, setTeachers] = useState([])
  const [venues, setVenues] = useState([])
  const [sections, setSections] = useState([])
  const [selectedSectionId, setSelectedSectionId] = useState(readStoredSectionId)
  const [allocations, setAllocations] = useState([])
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [focused, setFocused] = useState(null)
  const [editor, setEditor] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [clipboard, setClipboard] = useState(null)
  const [history, setHistory] = useState(emptyHistory)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [validation, setValidation] = useState(null)
  const [validating, setValidating] = useState(false)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const [toast, setToast] = useState(null)

  const gridRef = useRef(null)
  const sheetRef = useRef(null)
  const historyBusyRef = useRef(false)
  const pasteBusyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.teachers.list(), window.api.venues.list()]).then(
      ([teachersResponse, venuesResponse]) => {
        if (cancelled) return
        if (teachersResponse.ok) setTeachers(teachersResponse.data)
        if (venuesResponse.ok) setVenues(venuesResponse.data)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSections() {
      if (!activeId) {
        setSections([])
        setSelectedSectionId(null)
        return
      }
      const response = await window.api.sections.list(activeId)
      if (cancelled) return
      if (!response.ok) {
        setError(response.error)
        return
      }
      if (jump) {
        appliedJumpRef.current = null
      }
      setSections(response.data)
      setSelectedSectionId((previous) => {
        if (jump && response.data.some((section) => section.id === jump.sectionId)) {
          return jump.sectionId
        }
        return response.data.some((section) => section.id === previous)
          ? previous
          : response.data[0]?.id ?? null
      })
    }

    loadSections()
    return () => {
      cancelled = true
    }
  }, [activeId, jump])

  useEffect(() => {
    if (selectedSectionId) {
      window.localStorage.setItem(SECTION_STORAGE_KEY, String(selectedSectionId))
    }
  }, [selectedSectionId])

  const refreshSlots = useCallback(async () => {
    if (!selectedSectionId) {
      setSlots([])
      return
    }
    const response = await window.api.slots.listBySection(selectedSectionId)
    if (response.ok) setSlots(response.data)
    else setError(response.error)
  }, [selectedSectionId])

  // Jump highlight from a generated view: once the requested section is the
  // selected one and its slots have landed, highlight the clicked cell.
  useEffect(() => {
    if (!jump || appliedJumpRef.current === jump) return
    if (selectedSectionId !== jump.sectionId) return
    appliedJumpRef.current = jump
    setFocused({ day: jump.day, period: jump.period })
  }, [jump, selectedSectionId, slots])

  // Status bar and the check panel share one whole-timetable report. Re-run it
  // whenever the section's slots are refreshed, so the count stays honest.
  useEffect(() => {
    let cancelled = false
    if (!activeId) {
      setValidation(null)
      return undefined
    }

    window.api.timetables.validate(activeId).then((response) => {
      if (!cancelled && response.ok) setValidation(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [activeId, slots])

  const showToast = useCallback((tone, title, messages = [], timeout = 6000) => {
    setToast({ id: Date.now(), tone, title, messages, timeout })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSectionData() {
      if (!selectedSectionId) {
        setAllocations([])
        setSlots([])
        return
      }
      setLoading(true)
      try {
        const [allocationResponse, slotResponse] = await Promise.all([
          window.api.allocations.list(selectedSectionId),
          window.api.slots.listBySection(selectedSectionId)
        ])
        if (cancelled) return
        if (allocationResponse.ok) setAllocations(allocationResponse.data)
        else setError(allocationResponse.error)
        if (slotResponse.ok) setSlots(slotResponse.data)
        else setError(slotResponse.error)
      } catch (loadFailure) {
        if (!cancelled) setError(loadFailure.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadSectionData()
    return () => {
      cancelled = true
    }
  }, [selectedSectionId])

  useEffect(() => {
    setEditor(null)
    setFocused(null)
  }, [selectedSectionId])

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  )

  const grid = useMemo(() => buildGrid(slots), [slots])
  const semesterGroups = useMemo(() => groupSectionsBySemester(sections), [sections])
  const legend = useMemo(() => buildLegend(slots, { teachers }), [slots, teachers])

  const conflictCount = validation
    ? validation.slots.filter((entry) => entry.section_id === selectedSectionId).length
    : null

  const clipboardHint = clipboard
    ? `Copied ${clipboard.code || 'class'} (${DAY_LABELS[clipboard.payload.day]} P${
        clipboard.payload.start_period
      }) · Ctrl+V to paste`
    : 'Ctrl+C copy · Ctrl+V paste · Ctrl+Z undo · Ctrl+Y redo'

  const focusElement = useCallback(
    (day, period) => {
      const anchor = slotCellAt(grid, day, period)
      const anchorPeriod = anchor ? anchor.period : period
      return gridRef.current?.querySelector(`[data-cell-key="${day}-${anchorPeriod}"]`) || null
    },
    [grid]
  )

  useEffect(() => {
    if (!focused || editor) return
    focusElement(focused.day, focused.period)?.scrollIntoView({ block: 'nearest' })
  }, [focused, editor, focusElement])

  function openEditor({ slot, day, period, element, draft = false }) {
    const sheet = sheetRef.current
    if (!sheet || !element) return

    const rect = element.getBoundingClientRect()
    const sheetRect = sheet.getBoundingClientRect()
    const estimatedHeight = 470

    let left = rect.right - sheetRect.left + 8
    if (left + EDITOR_WIDTH > sheetRect.width - 8) {
      left = rect.left - sheetRect.left - EDITOR_WIDTH - 8
    }
    left = Math.max(8, Math.min(left, Math.max(8, sheetRect.width - EDITOR_WIDTH - 8)))

    let viewportTop
    if (rect.bottom + 8 + estimatedHeight <= window.innerHeight) {
      viewportTop = rect.bottom + 6
    } else if (rect.top - 8 - estimatedHeight >= 8) {
      viewportTop = rect.top - estimatedHeight - 6
    } else {
      viewportTop = Math.max(
        8,
        Math.min(rect.top - 80, window.innerHeight - estimatedHeight - 8)
      )
    }
    const top = Math.max(8, viewportTop - sheetRect.top)

    setFocused({ day, period: slot ? slot.start_period : period })
    setEditor({
      slot: slot || null,
      day,
      period,
      draft,
      style: { left, top, width: EDITOR_WIDTH }
    })
  }

  /** "Add activity here" / hover button / keyboard A / editor's own button. */
  function openActivityEditor({ day, period, cellSlot, element }) {
    openEditor({ slot: activityDraftFor(day, period, cellSlot), day, period, element, draft: true })
  }

  /** From inside an existing slot's editor: leaves the current slot untouched. */
  function addActivityFromEditor() {
    if (!editor) return
    const cellSlot = editor.draft ? null : editor.slot
    const element = focusElement(editor.day, editor.period)
    openActivityEditor({ day: editor.day, period: editor.period, cellSlot, element })
  }

  function openCellContextMenu({ day, period, slot, element, client }) {
    const sheet = sheetRef.current
    if (!sheet) return
    const sheetRect = sheet.getBoundingClientRect()
    setContextMenu({
      items: contextMenuItems(slot),
      slot,
      day,
      period,
      element,
      left: Math.max(4, client.x - sheetRect.left),
      top: Math.max(4, client.y - sheetRect.top)
    })
  }

  function runContextAction(id) {
    const menu = contextMenu
    setContextMenu(null)
    if (!menu) return
    if (id === 'edit-slot') {
      openEditor({ slot: menu.slot, day: menu.day, period: menu.period, element: menu.element })
      return
    }
    if (id === 'add-activity') {
      const cellSlot = slotCellAt(grid, menu.day, menu.period)?.slot ?? null
      openActivityEditor({ day: menu.day, period: menu.period, cellSlot, element: menu.element })
      return
    }
    if (id === 'add-lecture') {
      openEditor({
        slot: lectureDraftFor(menu.day, menu.period),
        day: menu.day,
        period: menu.period,
        element: menu.element,
        draft: true
      })
    }
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    const close = (event) => {
      if (event.target.closest?.('.cell-context-menu')) return
      setContextMenu(null)
    }
    const escape = (event) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [contextMenu])

  function openFocusedCell() {
    if (!focused) return
    const element = focusElement(focused.day, focused.period)
    if (!element) return
    const anchor = slotCellAt(grid, focused.day, focused.period)
    openEditor({
      slot: anchor?.slot ?? null,
      day: focused.day,
      period: anchor ? anchor.slot.start_period : focused.period,
      element
    })
  }

  function copyFocusedSlot() {
    if (!focused) return false
    const anchor = slotCellAt(grid, focused.day, focused.period)
    if (!anchor) return false
    setClipboard(snapshotFromRow(anchor.slot))
    return true
  }

  async function pasteClipboard() {
    if (!clipboard || !selectedSection || !focused || pasteBusyRef.current) return

    if (slotCellAt(grid, focused.day, focused.period)) {
      showToast('info', 'That cell already has a class', [
        'Pick an empty cell, or click the class to edit it.'
      ])
      return
    }

    const payload = {
      ...clipboard.payload,
      section_id: selectedSection.id,
      day: focused.day,
      start_period: focused.period
    }

    pasteBusyRef.current = true
    try {
      const check = await window.api.slots.check(payload, clipboard.teacherIds, null)
      const problems = check.ok ? check.data : [{ type: 'section', message: check.error }]
      if (problems.length > 0) {
        showToast(
          'error',
          'Cannot paste here',
          problems.map((problem) => problem.message)
        )
        return
      }

      const response = await window.api.slots.save(payload, clipboard.teacherIds, null)
      if (!response.ok) {
        const messages = (response.problems || []).map((problem) => problem.message)
        showToast('error', 'Cannot paste here', messages.length ? messages : [response.error])
        return
      }

      const after = snapshotFromPayload(
        payload,
        clipboard.teacherIds,
        response.data.id,
        clipboard.code
      )
      setHistory((previous) => pushChange(previous, { before: null, after }))
      await refreshSlots()
      gridRef.current?.focus()
    } catch (failure) {
      showToast('error', 'Cannot paste here', [failure.message])
    } finally {
      pasteBusyRef.current = false
    }
  }

  async function runHistory(direction) {
    if (historyBusyRef.current) return
    const entry = direction === 'undo' ? peekUndo(history) : peekRedo(history)
    if (!entry) return

    const restoring = direction === 'undo' ? entry.before : entry.after
    const opposite = direction === 'undo' ? entry.after : entry.before
    const removing = restoring === null

    historyBusyRef.current = true
    setHistoryBusy(true)
    try {
      let nextId = null
      if (removing) {
        const response = await window.api.slots.delete(opposite.id)
        if (!response.ok) throw new Error(response.error)
      } else {
        const recreate = opposite === null
        const response = await window.api.slots.save(
          restoring.payload,
          restoring.teacherIds,
          recreate ? null : restoring.id
        )
        if (!response.ok) {
          throw new Error(response.problems?.[0]?.message || response.error)
        }
        nextId = response.data.id
      }

      const applied = withSlotId(entry, nextId, removing)
      setHistory((previous) =>
        direction === 'undo' ? commitUndo(previous, applied) : commitRedo(previous, applied)
      )
      await refreshSlots()
      gridRef.current?.focus()
    } catch (failure) {
      showToast('error', `${direction === 'undo' ? 'Undo' : 'Redo'} failed`, [failure.message])
    } finally {
      historyBusyRef.current = false
      setHistoryBusy(false)
    }
  }

  function handleGridKeyDown(event) {
    if (editor) return

    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.altKey) {
      const shortcut = event.key.toLowerCase()
      if (shortcut === 'c') {
        if (copyFocusedSlot()) event.preventDefault()
        return
      }
      if (shortcut === 'v') {
        if (clipboard) {
          event.preventDefault()
          pasteClipboard()
        }
        return
      }
      if (shortcut === 'z') {
        event.preventDefault()
        runHistory(event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (shortcut === 'y') {
        event.preventDefault()
        runHistory('redo')
        return
      }
    }

    if (!focused) return

    const { key } = event

    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      setFocused((previous) => {
        if (!previous) return previous
        let { day, period } = previous
        if (key === 'ArrowUp') day = Math.max(1, day - 1)
        if (key === 'ArrowDown') day = Math.min(DAYS.length, day + 1)
        if (key === 'ArrowLeft') period = Math.max(1, period - 1)
        if (key === 'ArrowRight') period = Math.min(PERIODS.length, period + 1)
        return { day, period }
      })
      return
    }

    if (key === 'Enter') {
      event.preventDefault()
      openFocusedCell()
      return
    }

    // "A" opens a new activity editor for the focused cell (occupied or not).
    if (key === 'a' || key === 'A') {
      event.preventDefault()
      const anchor = cellAnchorOf(grid, focused.day, focused.period)
      openActivityEditor({
        day: focused.day,
        period: focused.period,
        cellSlot: anchor.slot,
        element: focusElement(focused.day, focused.period)
      })
      return
    }

    if (key === 'Delete') {
      const anchor = slotCellAt(grid, focused.day, focused.period)
      if (anchor) {
        event.preventDefault()
        setDeleteError('')
        setDeleteTarget(anchor.slot)
      }
    }
  }

  function requestDelete(slot) {
    setDeleteError('')
    setDeleteTarget(slot)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const removed = snapshotFromRow(deleteTarget)
    setDeleteBusy(true)
    setDeleteError('')
    const response = await window.api.slots.delete(deleteTarget.id)
    setDeleteBusy(false)
    if (!response.ok) {
      setDeleteError(response.error)
      return
    }
    setHistory((previous) => pushChange(previous, { before: removed, after: null }))
    setDeleteTarget(null)
    setEditor(null)
    await refreshSlots()
    gridRef.current?.focus()
  }

  async function handleEditorSaved(saved, snapshot) {
    // A draft ("add activity here") has no before-row for undo history.
    const before = editor?.slot && !editor.draft ? snapshotFromRow(editor.slot) : null
    setHistory((previous) =>
      pushChange(previous, { before, after: { ...snapshot, id: saved.id } })
    )
    setEditor(null)
    await refreshSlots()
    gridRef.current?.focus()
  }

  async function checkWholeTimetable() {
    if (!activeId) return
    setValidating(true)
    const response = await window.api.timetables.validate(activeId)
    setValidating(false)
    if (!response.ok) {
      showToast('error', 'Check failed', [response.error])
      return
    }
    setValidation(response.data)
    setProblemsOpen(true)
  }

  function closeEditor() {
    setEditor(null)
    gridRef.current?.focus()
  }

  useEffect(() => {
    if (editor) setContextMenu(null)
  }, [editor])

  const mergedOthers = deleteTarget?.merge_partners ?? []
  const deleteMessage = deleteTarget
    ? `Delete ${
        deleteTarget.kind === 'ACTIVITY'
          ? deleteTarget.label || 'this activity'
          : deleteTarget.subject_code
      } on ${DAY_LABELS[deleteTarget.day] || ''} P${deleteTarget.start_period}?${
        mergedOthers.length
          ? ` This is a merged lecture: only this section's slot is removed, ${mergedOthers
              .map((partner) => `Sem ${partner.section}`)
              .join(' and ')} stay${mergedOthers.length === 1 ? 's' : ''} unaffected.`
          : ''
      } This cannot be undone.`
    : ''

  return (
    <div>
      <h1>Master Timetable</h1>

      {error && <p className="form-error">{error}</p>}

      {!activeTimetable ? (
        <div className="empty-state">
          <p>No timetable yet. Create one in Timetable Setup first.</p>
          <Link className="button" to="/timetable-setup">
            Open Timetable Setup
          </Link>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state">
          <p>{activeTimetable.title} has no sections yet.</p>
          <Link className="button" to="/timetable-setup">
            Add a section
          </Link>
        </div>
      ) : (
        <>
          <div className="tabs tabs-grouped" role="tablist" aria-label="Sections">
            {semesterGroups.map((group) => (
              <div key={group.semester} className="tab-group">
                <span className="tab-group-label">{group.label}</span>
                {group.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    aria-selected={section.id === selectedSectionId}
                    className={section.id === selectedSectionId ? 'tab tab-active' : 'tab'}
                    onClick={() => setSelectedSectionId(section.id)}
                  >
                    Sem {section.semester} - {section.name}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {selectedSection && (
            <div className="status-bar">
              <span className="status-main">
                Section {selectedSection.semester}-{selectedSection.name}: {slots.length} slot
                {slots.length === 1 ? '' : 's'}, {conflictCount ?? '…'} conflict
                {conflictCount === 1 ? '' : 's'}
                {historyBusy && <span className="status-working"> · working…</span>}
              </span>
              <span className="status-hint">{clipboardHint}</span>
              <button
                type="button"
                className="button-link"
                onClick={checkWholeTimetable}
                disabled={validating}
              >
                {validating ? 'Checking…' : 'Check whole timetable'}
              </button>
            </div>
          )}

          {problemsOpen && (
            <ValidationPanel
              report={validation}
              busy={validating || conflictCount === null}
              onClose={() => setProblemsOpen(false)}
            />
          )}

          {!selectedSection ? (
            <p className="muted">Select a section above.</p>
          ) : loading ? (
            <p className="muted">Loading timetable…</p>
          ) : (
            <section
              className="sheet"
              ref={sheetRef}
              aria-label={`Timetable for Sem ${selectedSection.semester} - ${selectedSection.name}`}
            >
              <header className="sheet-header">
                <p className="sheet-college">MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD</p>
                <p className="sheet-department">Department of Computer Science &amp; Engineering</p>
                <p className="sheet-title">{String(activeTimetable.title || '').toUpperCase()}</p>
                {activeTimetable.effective_from && (
                  <p className="sheet-effective">w.e.f. {formatDate(activeTimetable.effective_from)}</p>
                )}
                <div className="sheet-meta">
                  <span>
                    Semester: {ROMAN[selectedSection.semester] || selectedSection.semester} -{' '}
                    {selectedSection.name}
                  </span>
                  <span>Class O.C.: {selectedSection.class_oc || '—'}</span>
                </div>
                {selectedSection.counselors && (
                  <p className="sheet-counselors">Counselors: {selectedSection.counselors}</p>
                )}
              </header>

              <div
                className="sheet-grid-wrap"
                ref={gridRef}
                tabIndex={0}
                aria-label="Timetable grid. Arrow keys move between cells, Enter opens the editor, Delete removes a class."
                onKeyDown={handleGridKeyDown}
                onFocus={() => {
                  if (!focused) setFocused({ day: 1, period: 1 })
                }}
              >
                <TimetableGrid
                  grid={grid}
                  focused={focused}
                  onActivate={openEditor}
                  onAddActivity={openActivityEditor}
                  onCellContext={openCellContextMenu}
                />
              </div>

              {slots.length === 0 && (
                <p className="muted small">No classes placed in this section yet. Click a cell to add one.</p>
              )}

              <LegendTable
                entries={legend}
                emptyMessage="Place classes in this section and the legend will appear here."
                hint="Code, subject and faculty exactly as the department sheet prints them"
              />

              <footer className="sheet-signatures">
                <span>
                  <span className="sheet-signature-label">Coordinator</span>
                  {activeTimetable.coordinator || '—'}
                </span>
                <span>
                  <span className="sheet-signature-label">Convener</span>
                  {activeTimetable.convener || '—'}
                </span>
              </footer>

              {editor && (
                <SlotEditor
                  key={`${editor.day}-${editor.period}-${editor.slot?.id ?? 'new'}`}
                  draft={editor.draft}
                  onAddActivityHere={addActivityFromEditor}
                  slot={editor.slot}
                  day={editor.day}
                  period={editor.period}
                  section={selectedSection}
                  allocations={allocations}
                  teachers={teachers}
                  venues={venues}
                  slots={slots}
                  style={editor.style}
                  onClose={closeEditor}
                  onSaved={handleEditorSaved}
                  onRequestDelete={requestDelete}
                />
              )}
            </section>
          )}
        </>
      )}

      {toast && (
        <Toast
          key={toast.id}
          tone={toast.tone}
          title={toast.title}
          messages={toast.messages}
          timeout={toast.timeout}
          onClose={() => setToast(null)}
        />
      )}

      {contextMenu && (
        <div className="cell-context-menu" style={{ left: contextMenu.left, top: contextMenu.top }} role="menu">
          {contextMenu.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => runContextAction(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete class"
          message={deleteMessage}
          confirmLabel="Delete class"
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => {
            setDeleteTarget(null)
            setDeleteError('')
            requestAnimationFrame(() => {
              const editorElement = document.querySelector('.slot-editor')
              if (editorElement) editorElement.focus()
              else gridRef.current?.focus()
            })
          }}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
