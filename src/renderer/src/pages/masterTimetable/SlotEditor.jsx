import { useEffect, useMemo, useRef, useState } from 'react'
import SearchSelect from '../../components/SearchSelect'
import ProblemList from '../../components/ProblemList'
import { DAYS, LUNCH_AFTER, PERIODS, rangesOverlap } from '@shared/gridLayout'
import { batchLabel } from '@shared/labels'
import { mergeOfferState } from '../../lib/mergeOffers'
import { initialVenueState, venueAfterKindChange } from '../../lib/venueState'

const KIND_OPTIONS = [
  { value: 'L', label: 'L' },
  { value: 'T', label: 'T' },
  { value: 'P', label: 'P' },
  { value: 'ACTIVITY', label: 'Activity' }
]

/**
 * Small editor anchored to one timetable cell. It never covers the page like a
 * modal: the page positions it next to the cell and closes it on outside click.
 *
 * Round-2 additions: batches are labelled from the section (A1/A2), an activity
 * may pick a venue, busy teachers/venues stay selectable (so the merge offer
 * can fire), and a merged lecture shows its sections and can be left.
 */
export default function SlotEditor({
  slot,
  day,
  period,
  section,
  allocations,
  teachers,
  venues,
  slots,
  style,
  draft = false,
  onAddActivityHere,
  onClose,
  onSaved,
  onRequestDelete
}) {
  const editing = Boolean(slot?.id)
  const startPeriod = slot?.start_period ?? period

  const [kind, setKind] = useState(slot?.kind ?? 'L')
  const [subjectId, setSubjectId] = useState(slot?.subject_id ?? null)
  const [teacherIds, setTeacherIds] = useState(slot?.teacher_ids ?? [])
  const [batchNo, setBatchNo] = useState(slot?.batch_no ?? null)
  const [span, setSpan] = useState(slot?.span ?? 1)
  // Venue is an explicit pair: "id" (venue or null for None) plus "touched".
  // Truthiness alone could not tell "unedited, use the defaults" from "the
  // user picked None", which is what let the default venue crawl back after a
  // save (round-3 Issues 1 and 4).
  const [venue, setVenue] = useState(() =>
    initialVenueState(slot, section, venues, slot?.kind ?? 'L')
  )
  const venueId = venue.id
  const [label, setLabel] = useState(slot?.label ?? '')
  const [parallel, setParallel] = useState(Boolean(slot?.elective_group))
  const [group, setGroup] = useState(slot?.elective_group ?? '')
  const [mergeGroup, setMergeGroup] = useState(slot?.merge_group ?? null)
  const [mergeWith, setMergeWith] = useState(null)
  const [mergeNote, setMergeNote] = useState('')
  const [merging, setMerging] = useState(false)
  const [teacherFilter, setTeacherFilter] = useState('')
  const [teacherOpen, setTeacherOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [problems, setProblems] = useState([])
  const [checking, setChecking] = useState(false)
  const [busyResources, setBusyResources] = useState({ teachers: [], venues: [] })

  const rootRef = useRef(null)
  const teacherPickerRef = useRef(null)

  const spanLimit =
    startPeriod <= LUNCH_AFTER ? LUNCH_AFTER + 1 - startPeriod : PERIODS.length + 1 - startPeriod

  const dayLabel = DAYS.find((entry) => entry.value === day)?.label ?? ''
  const periodRange = span > 1 ? `P${startPeriod}–P${startPeriod + span - 1}` : `P${startPeriod}`

  const batchOptions = [
    { value: null, label: 'Whole section' },
    { value: 1, label: batchLabel(section.name, 1) },
    { value: 2, label: batchLabel(section.name, 2) }
  ]

  const subjectOptions = useMemo(
    () =>
      allocations.map((allocation) => ({
        value: allocation.subject_id,
        label: `${allocation.subject_code} — ${allocation.subject_name}`
      })),
    [allocations]
  )

  const teachersById = useMemo(
    () => Object.fromEntries(teachers.map((teacher) => [teacher.id, teacher])),
    [teachers]
  )

  const visibleTeachers = useMemo(() => {
    const needle = teacherFilter.trim().toLowerCase()
    if (!needle) return teachers
    return teachers.filter((teacher) =>
      `${teacher.code} ${teacher.name}`.toLowerCase().includes(needle)
    )
  }, [teachers, teacherFilter])

  const venueOptions = useMemo(
    () =>
      [...venues].sort((a, b) =>
        a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'lab' ? -1 : 1
      ),
    [venues]
  )

  const labelSuggestions = useMemo(
    () => [...new Set(slots.map((entry) => entry.label).filter(Boolean))],
    [slots]
  )

  const busyTeacherMap = useMemo(
    () => new Map(busyResources.teachers.map((entry) => [entry.id, entry])),
    [busyResources]
  )

  const busyVenueMap = useMemo(
    () => new Map(busyResources.venues.map((entry) => [entry.id, entry])),
    [busyResources]
  )

  const { offers: mergeOffers, blockedNote: mergeBlockedNote } = useMemo(
    () => (mergeGroup ? { offers: [], blockedNote: '' } : mergeOfferState(problems)),
    [problems, mergeGroup]
  )

  const [mergePartners, setMergePartners] = useState(slot?.merge_partners ?? [])

  function buildPayload() {
    return {
      section_id: section.id,
      day,
      start_period: startPeriod,
      span,
      kind,
      subject_id: kind === 'ACTIVITY' ? null : subjectId,
      batch_no: kind === 'ACTIVITY' || parallel ? null : batchNo,
      elective_group: kind === 'ACTIVITY' || !parallel ? null : group.trim() || null,
      venue_id: venue.id,
      label: kind === 'ACTIVITY' ? label.trim() : null,
      merge_group: mergeGroup || null,
      merge_with: mergeWith || null
    }
  }

  function busyText(entry) {
    if (!entry) return ''
    return `busy in ${entry.section}${entry.mergeable ? ', can be merged' : ''}`
  }

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleOutside = (event) => {
      if (event.target.closest('.dialog-overlay')) return
      if (!rootRef.current?.contains(event.target)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  useEffect(() => {
    if (!teacherOpen) return
    const handleOutside = (event) => {
      if (!teacherPickerRef.current?.contains(event.target)) setTeacherOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [teacherOpen])

  // Live conflict check. Wait 200 ms so typing and clicking do not flood IPC.
  useEffect(() => {
    // A slot without its required subject/label cannot be checked yet; the
    // backend error for that is not a conflict, so it must not block Save.
    const missingRequired = kind === 'ACTIVITY' ? !label.trim() : !subjectId

    let cancelled = false
    setChecking(true)
    const timer = setTimeout(async () => {
      try {
        const response = await window.api.slots.check(
          buildPayload(),
          kind === 'ACTIVITY' ? [] : teacherIds,
          slot?.id ?? null
        )
        if (cancelled) return
        if (response.ok) setProblems(response.data)
        else if (missingRequired) setProblems([])
        else setProblems([{ type: 'section', message: response.error }])
      } catch (checkFailure) {
        if (!cancelled) setProblems([{ type: 'section', message: checkFailure.message }])
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // buildPayload is derived from these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, subjectId, teacherIds, venueId, batchNo, span, parallel, group, label, mergeGroup])

  // Busy teachers/venues for the dropdowns. Between members of the same merged
  // lecture nothing is busy, so the group id is passed along.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await window.api.slots.busy(
          section.timetable_id,
          day,
          startPeriod,
          span,
          slot?.id ?? null,
          mergeGroup
        )
        if (!cancelled && response.ok) setBusyResources(response.data)
      } catch {
        // A busy lookup failing must never block editing; the live check still runs.
      }
    }, 150)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [kind, section.timetable_id, day, startPeriod, span, slot?.id, mergeGroup])

  function chooseKind(nextKind) {
    if (nextKind === kind) return
    setError('')
    setKind(nextKind)

    if (nextKind === 'ACTIVITY') {
      setSubjectId(null)
      setTeacherIds([])
      setBatchNo(null)
      setParallel(false)
      setGroup('')
      setMergeGroup(null)
      setMergeWith(null)
      setVenue((previous) => venueAfterKindChange(previous, nextKind, section, venues))
      return
    }

    if (nextKind === 'P') {
      if (spanLimit >= 2) setSpan(2)
      setVenue((previous) => venueAfterKindChange(previous, nextKind, section, venues))
      return
    }

    // L/T: fill the default venue only when nothing concrete was chosen yet.
    setVenue((previous) => venueAfterKindChange(previous, nextKind, section, venues))
  }

  function chooseSubject(nextId) {
    setSubjectId(nextId)
    setError('')
    const allocation = allocations.find((entry) => entry.subject_id === nextId)
    if (allocation) setTeacherIds(allocation.teacher_ids)
  }

  function toggleTeacher(teacherId) {
    setTeacherIds((previous) =>
      previous.includes(teacherId)
        ? previous.filter((id) => id !== teacherId)
        : [...previous, teacherId]
    )
  }

  function chooseBatch(nextBatch) {
    setBatchNo(nextBatch)
    if (nextBatch) {
      setParallel(false)
      setGroup('')
    }
  }

  function nextGroupName() {
    const used = slots
      .map((entry) => entry.elective_group)
      .filter((value) => /^E\d+$/i.test(String(value ?? '')))
      .map((value) => Number(String(value).slice(1)))
    return `E${Math.max(0, ...used) + 1}`
  }

  function toggleParallel(nextValue) {
    setParallel(nextValue)
    setError('')
    if (!nextValue) {
      setGroup('')
      return
    }

    setBatchNo(null)
    const neighbor = slots.find(
      (entry) =>
        entry.id !== slot?.id &&
        entry.day === day &&
        entry.elective_group &&
        rangesOverlap(entry, { start_period: startPeriod, span })
    )
    setGroup(neighbor?.elective_group || nextGroupName())
  }

  /** Adopts the other section's teachers and venue; Save writes the group. */
  async function markAsMerged(candidate) {
    if (merging) return
    setMerging(true)
    setError('')
    try {
      const response = await window.api.slots.joinMerge(buildPayload(), candidate.slot_id)
      if (!response.ok) {
        setError(response.error)
        if (response.problems) setProblems(response.problems)
        return
      }
      const data = response.data
      setTeacherIds(data.teacher_ids)
      setVenue({ id: data.venue_id ?? null, touched: true })
      setMergeGroup(data.merge_group)
      setMergeWith(candidate.slot_id)
      setMergeNote(data.note)
      setMergePartners([
        { slot_id: candidate.slot_id, section: data.candidate?.section_code ?? candidate.section }
      ])
      setProblems([])
    } finally {
      setMerging(false)
    }
  }

  /** Leaves the group in the same save, with the teachers/venue chosen here. */
  async function removeFromMerge() {
    if (!slot?.id || saving) return
    setSaving(true)
    setError('')
    const payload = { ...buildPayload(), detach: true, merge_group: null }
    const finalTeacherIds = kind === 'ACTIVITY' ? [] : teacherIds
    try {
      const response = await window.api.slots.leaveGroup(slot.id, payload, finalTeacherIds)
      if (!response.ok) {
        setProblems(response.problems ?? [])
        setError(response.error)
        return
      }
      const subject = allocations.find((entry) => entry.subject_id === subjectId)
      onSaved(
        { ...slot, merge_group: null },
        {
          id: slot.id,
          payload,
          teacherIds: finalTeacherIds,
          code: kind === 'ACTIVITY' ? label.trim() : subject?.subject_code ?? ''
        }
      )
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (kind === 'ACTIVITY') {
      if (!label.trim()) {
        setError('An activity needs a label, for example "Sports".')
        return
      }
    } else if (!subjectId) {
      setError('Choose a subject.')
      return
    }

    if (parallel && !group.trim()) {
      setError('Enter an elective group, for example E1.')
      return
    }

    if (problems.length > 0 || checking) return

    const payload = buildPayload()
    const finalTeacherIds = kind === 'ACTIVITY' ? [] : teacherIds
    const subject = allocations.find((entry) => entry.subject_id === subjectId)

    setSaving(true)
    setError('')
    try {
      const response = await window.api.slots.save(payload, finalTeacherIds, slot?.id ?? null)
      if (!response.ok) {
        setError(response.error)
        if (response.problems) setProblems(response.problems)
        return
      }
      onSaved(response.data, {
        id: response.data.id,
        payload: { ...payload, merge_group: response.data.merge_group ?? null },
        teacherIds: finalTeacherIds,
        code: kind === 'ACTIVITY' ? label.trim() : subject?.subject_code ?? ''
      })
    } catch (saveFailure) {
      setError(saveFailure.message)
    } finally {
      setSaving(false)
    }
  }

  const spanControl = (
    <div className="editor-field">
      <span className="editor-label">Span</span>
      <div className="segmented segmented-small" role="group" aria-label="Span">
        {[1, 2, 3, 4].map((value) => (
          <button
            key={value}
            type="button"
            className={span === value ? 'segment segment-active' : 'segment'}
            aria-pressed={span === value}
            disabled={value > spanLimit}
            title={
              value > spanLimit
                ? `A ${value}-period class from P${startPeriod} crosses lunch or the end of the day`
                : `${value} period(s)`
            }
            onClick={() => setSpan(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  )

  const venueSelect = (
    <label className="editor-field">
      <span className="editor-label">
        Venue{kind === 'ACTIVITY' ? ' (optional)' : ''}
      </span>
      <select
        className="input"
        value={venue.id ?? ''}
        onChange={(event) =>
          setVenue({ id: event.target.value ? Number(event.target.value) : null, touched: true })
        }
      >
        <option value="">{kind === 'ACTIVITY' ? 'None' : 'No venue'}</option>
        {venueOptions.map((venue) => {
          const busy = busyVenueMap.get(venue.id)
          return (
            <option key={venue.id} value={venue.id}>
              {venue.code}
              {venue.name ? ` — ${venue.name}` : ''} ({venue.kind})
              {busy ? ` — ${busyText(busy)}` : ''}
            </option>
          )
        })}
      </select>
    </label>
  )

  return (
    <div
      className="slot-editor"
      style={style}
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`${editing ? 'Edit' : 'New'} class ${dayLabel} ${periodRange}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="slot-editor-header">
        <div>
          <h2>
            {editing ? 'Edit class' : 'New class'} · {dayLabel} {periodRange}
          </h2>
          <p className="muted small">
            Sem {section.semester} - {section.name}
          </p>
        </div>
        <button type="button" className="slot-editor-close" onClick={onClose} aria-label="Close editor">
          ✕
        </button>
      </div>

      <div className="slot-editor-body">
        {onAddActivityHere && !draft && (
          <button
            type="button"
            className="button button-secondary button-small editor-add-activity"
            onClick={onAddActivityHere}
            title="Opens a new activity editor for this period; this class is left unchanged"
          >
            Add activity in this period
          </button>
        )}
        <div className="editor-field">
          <span className="editor-label">Kind</span>
          <div className="segmented" role="group" aria-label="Kind">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={kind === option.value ? 'segment segment-active' : 'segment'}
                aria-pressed={kind === option.value}
                onClick={() => chooseKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {mergeGroup && (
          <div className="merge-group">
            <p className="merge-group-title">
              Merged with:{' '}
              {mergePartners.length
                ? mergePartners.map((partner) => partner.section).join(', ')
                : 'the other section'}
            </p>
            {mergeNote && <p className="muted small">{mergeNote}</p>}
            <p className="muted small merge-group-hint">
              Time, teachers and venue apply to every section in this lecture.
            </p>
            {editing && (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={removeFromMerge}
                disabled={saving}
              >
                Remove this section from the merged lecture
              </button>
            )}
          </div>
        )}

        {kind === 'ACTIVITY' ? (
          <>
            <label className="editor-field">
              <span className="editor-label">Label</span>
              <input
                type="text"
                className="input"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value)
                  setError('')
                }}
                placeholder="SUPER - 30"
                list="slot-editor-activity-labels"
              />
              <datalist id="slot-editor-activity-labels">
                {labelSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </label>
            <div className="editor-row">{spanControl}</div>
            {venueSelect}
          </>
        ) : (
          <>
            <div className="editor-field">
              <span className="editor-label">Subject</span>
              <SearchSelect
                options={subjectOptions}
                value={subjectId}
                onChange={chooseSubject}
                placeholder="Search this section's subjects…"
                ariaLabel="Subject"
              />
              {subjectOptions.length === 0 && (
                <span className="field-hint">This section has no allocated subjects yet.</span>
              )}
            </div>

            <div className="editor-row">
              <div className="editor-field">
                <span className="editor-label">Batch</span>
                <div className="segmented segmented-small" role="group" aria-label="Batch">
                  {batchOptions.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={batchNo === option.value ? 'segment segment-active' : 'segment'}
                      aria-pressed={batchNo === option.value}
                      disabled={parallel && option.value !== null}
                      onClick={() => chooseBatch(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {spanControl}
            </div>

            <div className="editor-field">
              <span className="editor-label">Teachers</span>
              <div className="chips">
                {teacherIds.length === 0 && <span className="muted small">No teacher selected.</span>}
                {teacherIds.map((teacherId) => {
                  const teacher = teachersById[teacherId]
                  const busy = busyTeacherMap.get(teacherId)
                  return (
                    <span key={teacherId} className="chip" title={teacher?.name}>
                      {teacher?.code ?? teacherId}
                      {busy ? <span className="chip-busy">· {busyText(busy)}</span> : null}
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => toggleTeacher(teacherId)}
                        aria-label={`Remove ${teacher?.name ?? 'teacher'}`}
                      >
                        ✕
                      </button>
                    </span>
                  )
                })}
              </div>
              <div className="teacher-picker" ref={teacherPickerRef}>
                <input
                  type="text"
                  className="input"
                  value={teacherFilter}
                  onChange={(event) => {
                    setTeacherFilter(event.target.value)
                    setTeacherOpen(true)
                  }}
                  onFocus={() => setTeacherOpen(true)}
                  placeholder="Add teacher…"
                  aria-label="Add teacher"
                />
                {teacherOpen && (
                  <div className="teacher-picker-list">
                    {visibleTeachers.map((teacher) => {
                      const selected = teacherIds.includes(teacher.id)
                      const busy = busyTeacherMap.get(teacher.id)
                      return (
                        <button
                          key={teacher.id}
                          type="button"
                          className={
                            [
                              'teacher-option',
                              selected ? 'is-selected' : '',
                              busy ? 'teacher-option-is-busy' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')
                          }
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            toggleTeacher(teacher.id)
                            setTeacherFilter('')
                          }}
                          aria-pressed={selected}
                          title={busy ? busy.reason : undefined}
                        >
                          <span className="teacher-option-code">{teacher.code}</span>
                          <span className="teacher-option-name">{teacher.name}</span>
                          {busy && <span className="teacher-option-busy">{busyText(busy)}</span>}
                        </button>
                      )
                    })}
                    {visibleTeachers.length === 0 && (
                      <p className="muted small">No teacher matches.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {venueSelect}

            <div className="editor-field">
              <label className="editor-checkbox">
                <input
                  type="checkbox"
                  checked={parallel}
                  onChange={(event) => toggleParallel(event.target.checked)}
                />
                <span>Parallel elective</span>
              </label>
              {parallel && (
                <input
                  type="text"
                  className="input"
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  placeholder="E1"
                  aria-label="Elective group"
                />
              )}
            </div>
          </>
        )}
      </div>

      {mergeOffers.length > 0 ? (
        <div className="merge-offers">
          <p className="merge-offers-title">
            This clashes with another section's class at exactly the same time.
          </p>
          {mergeOffers.map((offer) => (
            <button
              key={offer.slot_id}
              type="button"
              className="button button-small merge-offer"
              onClick={() => markAsMerged(offer)}
              disabled={merging || saving}
              title={`${offer.subject_code} · ${offer.teacher_codes || 'no teacher'} · ${offer.venue_code || 'no venue'}`}
            >
              {offer.label}
            </button>
          ))}
        </div>
      ) : (
        mergeBlockedNote && (
          <div className="merge-offers">
            <p className="merge-offers-title">{mergeBlockedNote}</p>
          </div>
        )
      )}

      {problems.length > 0 && <ProblemList problems={problems} className="slot-editor-problems" />}
      {checking && <p className="muted small slot-editor-checking">Checking conflicts…</p>}

      {error && <p className="form-error slot-editor-error">{error}</p>}

      <div className="slot-editor-actions">
        {editing && (
          <button
            type="button"
            className="button button-danger-outline button-small"
            onClick={() => onRequestDelete(slot)}
            disabled={saving}
          >
            Delete
          </button>
        )}
        <span className="slot-editor-spacer" />
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-small"
          onClick={save}
          disabled={saving || checking || problems.length > 0}
          title={problems.length > 0 ? 'Fix the conflicts before saving' : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

