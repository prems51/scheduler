import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActiveTimetable } from '../context/ActiveTimetableContext'
import ConfirmDialog from '../components/ConfirmDialog'
import TimetableFormDialog from './timetableSetup/TimetableFormDialog'
import SectionFormDialog from './timetableSetup/SectionFormDialog'
import AllocationDialog from './timetableSetup/AllocationDialog'
import CopyAllocationsDialog from './timetableSetup/CopyAllocationsDialog'
import DuplicateTimetableDialog from './timetableSetup/DuplicateTimetableDialog'
import LegendPreview from './timetableSetup/LegendPreview'
import { useToast } from '../context/ToastContext'
import { groupSectionsBySemester } from '../lib/sectionGroups'

const COLLAPSE_KEY = 'timetable-manager:collapsed-semesters'

function readCollapsed() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.map(Number).filter(Number.isFinite) : []
  } catch {
    return []
  }
}

export default function TimetableSetup() {
  const { timetables, activeTimetable, activeId, setActiveId, refreshTimetables } = useActiveTimetable()
  const { notify } = useToast()

  const [venues, setVenues] = useState([])
  const [subjects, setSubjects] = useState([])
  const [teachers, setTeachers] = useState([])
  const [sections, setSections] = useState([])
  const [selectedSectionId, setSelectedSectionId] = useState(null)
  const [allocations, setAllocations] = useState([])
  const [error, setError] = useState('')

  const [timetableDialog, setTimetableDialog] = useState(null)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  // { section: null | section, semester: number | null }
  const [sectionDialog, setSectionDialog] = useState(null)
  const [collapsedSemesters, setCollapsedSemesters] = useState(readCollapsed)
  const [allocationDialog, setAllocationDialog] = useState(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [deleteSection, setDeleteSection] = useState(null)
  const [deleteSectionBusy, setDeleteSectionBusy] = useState(false)
  const [deleteSectionError, setDeleteSectionError] = useState('')
  const [deleteAllocation, setDeleteAllocation] = useState(null)
  const [deleteAllocationBusy, setDeleteAllocationBusy] = useState(false)
  const [deleteAllocationError, setDeleteAllocationError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadReferenceData() {
      try {
        const [venuesResponse, subjectsResponse, teachersResponse] = await Promise.all([
          window.api.venues.list(),
          window.api.subjects.list(),
          window.api.teachers.list()
        ])
        if (cancelled) return
        if (venuesResponse.ok) setVenues(venuesResponse.data)
        if (subjectsResponse.ok) setSubjects(subjectsResponse.data)
        if (teachersResponse.ok) setTeachers(teachersResponse.data)
      } catch (loadFailure) {
        if (!cancelled) setError(loadFailure.message)
      }
    }
    loadReferenceData()
    return () => {
      cancelled = true
    }
  }, [])

  const loadSections = useCallback(
    async (preferredId = null) => {
      if (!activeId) {
        setSections([])
        setSelectedSectionId(null)
        return
      }
      const response = await window.api.sections.list(activeId)
      if (!response.ok) {
        setError(response.error)
        return
      }
      setSections(response.data)
      setSelectedSectionId((previous) => {
        if (preferredId) return preferredId
        if (response.data.some((section) => section.id === previous)) return previous
        return response.data[0]?.id ?? null
      })
    },
    [activeId]
  )

  useEffect(() => {
    setSelectedSectionId(null)
    setAllocations([])
    loadSections()
  }, [loadSections])

  const loadAllocations = useCallback(async () => {
    if (!selectedSectionId) {
      setAllocations([])
      return
    }
    const response = await window.api.allocations.list(selectedSectionId)
    if (!response.ok) {
      setError(response.error)
      return
    }
    setAllocations(response.data)
  }, [selectedSectionId])

  useEffect(() => {
    loadAllocations()
  }, [loadAllocations])

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  )

  const semesterGroups = useMemo(() => groupSectionsBySemester(sections), [sections])

  function toggleSemester(semester) {
    setCollapsedSemesters((previous) => {
      const next = previous.includes(semester)
        ? previous.filter((value) => value !== semester)
        : [...previous, semester]
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  const existingSubjectIds = useMemo(
    () => allocations.map((allocation) => allocation.subject_id),
    [allocations]
  )

  async function handleTimetableSaved(timetable) {
    setTimetableDialog(null)
    await refreshTimetables()
    setActiveId(timetable.id)
  }

  async function handleTimetableDuplicated(result) {
    setDuplicateOpen(false)
    await refreshTimetables()
    setActiveId(result.timetable.id)
    const counts = result.counts
    notify('success', 'Timetable duplicated', [
      `${result.timetable.title} · ${counts.sections} section(s), ${counts.slots} class(es), ${counts.availability} request(s) copied.`
    ])
  }

  async function handleSectionSaved(section) {
    setSectionDialog(null)
    setCollapsedSemesters((previous) => {
      if (!previous.includes(Number(section.semester))) return previous
      const next = previous.filter((value) => value !== Number(section.semester))
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
    await loadSections(section.id)
  }

  async function confirmDeleteSection() {
    setDeleteSectionBusy(true)
    setDeleteSectionError('')
    const response = await window.api.sections.delete(deleteSection.id)
    setDeleteSectionBusy(false)
    if (!response.ok) {
      setDeleteSectionError(response.error)
      return
    }
    setDeleteSection(null)
    setSelectedSectionId(null)
    await loadSections()
  }

  async function handleAllocationSaved() {
    setAllocationDialog(null)
    await loadAllocations()
    await loadSections(selectedSectionId)
  }

  async function confirmDeleteAllocation() {
    setDeleteAllocationBusy(true)
    setDeleteAllocationError('')
    const response = await window.api.allocations.delete(deleteAllocation.id)
    setDeleteAllocationBusy(false)
    if (!response.ok) {
      setDeleteAllocationError(response.error)
      return
    }
    setDeleteAllocation(null)
    await loadAllocations()
    await loadSections(selectedSectionId)
  }

  return (
    <div>
      <h1>Timetable Setup</h1>

      <div className="setup-topbar">
        <label className="inline-field">
          <span>Timetable</span>
          <select
            className="input setup-select"
            value={activeId ?? ''}
            onChange={(event) => setActiveId(Number(event.target.value))}
            disabled={timetables.length === 0}
            aria-label="Active timetable"
          >
            {timetables.length === 0 && <option value="">No timetable yet</option>}
            {timetables.map((timetable) => (
              <option key={timetable.id} value={timetable.id}>
                {timetable.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button" onClick={() => setTimetableDialog('new')}>
          New timetable
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setTimetableDialog('edit')}
          disabled={!activeTimetable}
        >
          Edit timetable
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setDuplicateOpen(true)}
          disabled={!activeTimetable}
          title="Copy this timetable into a new term"
        >
          Duplicate
        </button>
      </div>

      {activeTimetable && (
        <p className="muted small setup-details">
          {activeTimetable.effective_from ? `w.e.f. ${activeTimetable.effective_from} · ` : ''}
          Coordinator: {activeTimetable.coordinator || '—'} · Convener: {activeTimetable.convener || '—'}
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      {!activeTimetable ? (
        <div className="empty-state">
          <p>No timetable yet. Create the 2026-27 timetable to start setup.</p>
          <button type="button" className="button" onClick={() => setTimetableDialog('new')}>
            New timetable
          </button>
        </div>
      ) : (
        <div className="setup-layout">
          <aside className="setup-sections">
            <div className="panel-header">
              <h2>Sections</h2>
              <button
                type="button"
                className="button button-small"
                onClick={() => setSectionDialog({ section: null, semester: null })}
              >
                Add section
              </button>
            </div>

            {sections.length === 0 ? (
              <div className="empty-state empty-state-inline">
                <p>No sections yet. Click Add section to start this timetable.</p>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setSectionDialog({ section: null, semester: null })}
                >
                  Add section
                </button>
              </div>
            ) : (
              <div className="semester-groups">
                {semesterGroups.map((group) => {
                  const collapsed = collapsedSemesters.includes(group.semester)
                  return (
                    <section key={group.semester} className="semester-group">
                      <div className="semester-group-head">
                        <button
                          type="button"
                          className="semester-group-toggle"
                          aria-expanded={!collapsed}
                          onClick={() => toggleSemester(group.semester)}
                        >
                          <span className="semester-caret" aria-hidden="true">
                            {collapsed ? '▸' : '▾'}
                          </span>
                          <span className="semester-group-title">{group.label}</span>
                          <span className="semester-group-count">
                            {group.sections.length} section{group.sections.length === 1 ? '' : 's'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() =>
                            setSectionDialog({ section: null, semester: group.semester })
                          }
                          aria-label={`Add section to ${group.label}`}
                        >
                          + Add section
                        </button>
                      </div>
                      <p className="semester-group-summary">
                        {group.withSlots} of {group.sections.length} with classes ·{' '}
                        {group.slotCount} slot{group.slotCount === 1 ? '' : 's'}
                      </p>
                      {!collapsed && (
                        <ul className="section-list">
                          {group.sections.map((section) => (
                            <li key={section.id}>
                              <button
                                type="button"
                                className={
                                  section.id === selectedSectionId
                                    ? 'section-item section-item-active'
                                    : 'section-item'
                                }
                                onClick={() => setSelectedSectionId(section.id)}
                              >
                                <span className="section-item-title">
                                  Sem {section.semester} - {section.name}
                                </span>
                                <span className="section-item-meta">
                                  {section.allocation_count} subject(s) · {section.slot_count} slot(s)
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </aside>

          <section className="setup-panel">
            {!selectedSection ? (
              <p className="muted">Select a section on the left, or add a new one.</p>
            ) : (
              <>
                <div className="panel-header">
                  <div>
                    <h2>
                      Sem {selectedSection.semester} - {selectedSection.name}
                    </h2>
                    <p className="muted small">
                      Class O.C.: {selectedSection.class_oc || '—'}
                      {selectedSection.counselors ? ` · Counselors: ${selectedSection.counselors}` : ''}
                      {selectedSection.default_venue_code
                        ? ` · Default venue: ${selectedSection.default_venue_code}`
                        : ''}
                    </p>
                  </div>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() =>
                        setSectionDialog({ section: selectedSection, semester: null })
                      }
                    >
                      Edit section
                    </button>
                    <button
                      type="button"
                      className="button button-danger-outline button-small"
                      onClick={() => {
                        setDeleteSectionError('')
                        setDeleteSection(selectedSection)
                      }}
                    >
                      Delete section
                    </button>
                  </div>
                </div>

                <div className="panel-subheader">
                  <h3>Allocations</h3>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => setCopyOpen(true)}
                      disabled={sections.length < 2}
                    >
                      Copy allocations from another section
                    </button>
                    <button
                      type="button"
                      className="button button-small"
                      onClick={() => setAllocationDialog('new')}
                    >
                      Add subject
                    </button>
                  </div>
                </div>

                {allocations.length === 0 ? (
                  <p className="muted small">
                    No subjects allocated yet. Add the subjects this section studies.
                  </p>
                ) : (
                  <table className="allocation-table">
                    <colgroup>
                      <col style={{ width: '110px' }} />
                      <col />
                      <col style={{ width: '170px' }} />
                      <col style={{ width: '150px' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="allocation-code">
                          Code
                        </th>
                        <th scope="col">Subject</th>
                        <th scope="col">Faculty</th>
                        <th scope="col" className="table-actions">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((allocation) => {
                        const teacherCodes = allocation.teacher_ids
                          .map((teacherId) => teachers.find((teacher) => teacher.id === teacherId)?.code)
                          .filter(Boolean)
                        return (
                          <tr key={allocation.id}>
                            <td className="allocation-code">{allocation.subject_code}</td>
                            <td>{allocation.subject_name}</td>
                            <td>
                              <span className="chip-group">
                                {teacherCodes.map((code) => (
                                  <span key={code} className="chip chip-static">
                                    {code}
                                  </span>
                                ))}
                              </span>
                            </td>
                            <td className="table-actions">
                              <button
                                type="button"
                                className="table-action"
                                onClick={() => setAllocationDialog(allocation)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="table-action table-action-danger"
                                onClick={() => {
                                  setDeleteAllocationError('')
                                  setDeleteAllocation(allocation)
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}

                <LegendPreview allocations={allocations} teachers={teachers} />
              </>
            )}
          </section>
        </div>
      )}

      {timetableDialog && (
        <TimetableFormDialog
          timetable={timetableDialog === 'edit' ? activeTimetable : null}
          onClose={() => setTimetableDialog(null)}
          onSaved={handleTimetableSaved}
        />
      )}

      {duplicateOpen && activeTimetable && (
        <DuplicateTimetableDialog
          timetable={activeTimetable}
          onClose={() => setDuplicateOpen(false)}
          onDuplicated={handleTimetableDuplicated}
        />
      )}

      {sectionDialog && activeTimetable && (
        <SectionFormDialog
          section={sectionDialog.section}
          timetableId={activeTimetable.id}
          venues={venues}
          defaultSemester={sectionDialog.semester}
          onClose={() => setSectionDialog(null)}
          onSaved={handleSectionSaved}
        />
      )}

      {allocationDialog && selectedSection && (
        <AllocationDialog
          section={selectedSection}
          allocation={allocationDialog === 'new' ? null : allocationDialog}
          subjects={subjects}
          teachers={teachers}
          existingSubjectIds={existingSubjectIds}
          onClose={() => setAllocationDialog(null)}
          onSaved={handleAllocationSaved}
        />
      )}

      {copyOpen && selectedSection && (
        <CopyAllocationsDialog
          sections={sections}
          targetSection={selectedSection}
          existingSubjectIds={existingSubjectIds}
          onClose={() => setCopyOpen(false)}
          onCopied={async () => {
            await loadAllocations()
            await loadSections(selectedSection.id)
          }}
        />
      )}

      {deleteSection && (
        <ConfirmDialog
          title="Delete section"
          message={`Delete Sem ${deleteSection.semester} - ${deleteSection.name}? This also deletes ${deleteSection.slot_count} slot(s) and ${deleteSection.allocation_count} allocation(s). This cannot be undone.`}
          confirmLabel="Delete section"
          busy={deleteSectionBusy}
          error={deleteSectionError}
          onCancel={() => setDeleteSection(null)}
          onConfirm={confirmDeleteSection}
        />
      )}

      {deleteAllocation && (
        <ConfirmDialog
          title="Remove allocation"
          message={`Remove ${deleteAllocation.subject_code} — ${deleteAllocation.subject_name} from this section?`}
          confirmLabel="Remove"
          busy={deleteAllocationBusy}
          error={deleteAllocationError}
          onCancel={() => setDeleteAllocation(null)}
          onConfirm={confirmDeleteAllocation}
        />
      )}
    </div>
  )
}
