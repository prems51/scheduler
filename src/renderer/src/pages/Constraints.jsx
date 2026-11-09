import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTimetable } from '../context/ActiveTimetableContext'
import { groupSectionsBySemester } from '../lib/sectionGroups'
import {
  AVAILABILITY_DAY_LABELS,
  AVAILABILITY_PRESETS,
  applyRequestByTime,
  cellKey,
  cellsToLevelMap,
  dayCells,
  normalizeCells,
  paintCells,
  periodCells,
  presetPoints,
  rectangleCells
} from '@shared/availability'
import {
  DAYS,
  LUNCH,
  LUNCH_AFTER,
  PERIODS,
  formatTimeRange12Hour
} from '@shared/gridLayout'

const TABS = [
  { value: 'teacher', label: 'Teachers' },
  { value: 'venue', label: 'Venues' },
  { value: 'section', label: 'Sections' }
]

const BEFORE_LUNCH = PERIODS.filter((period) => period.no <= LUNCH_AFTER)
const AFTER_LUNCH = PERIODS.filter((period) => period.no > LUNCH_AFTER)
const HISTORY_LIMIT = 30

const EMPTY_BY_TIME = {
  days: [1],
  from: '09:00',
  to: '11:00',
  level: 'cannot'
}

function shortSection(label) {
  return String(label ?? '').replace(/^Sem\s*/i, '')
}

function targetShortCode(target) {
  if (!target) return ''
  return target.code ?? target.name ?? ''
}

/** A cell key -> matrix row lookup. */
function matrixLookup(matrix) {
  return new Map((matrix ?? []).map((cell) => [cellKey(cell.day, cell.period), cell]))
}

/** Existing lectures that sit on a 'cannot' cell of the current draft. */
function conflictingLectures(cells, matrix, target) {
  const lookup = matrixLookup(matrix)
  const code = targetShortCode(target)
  return (cells ?? [])
    .filter((cell) => cell.level === 'cannot')
    .map((cell) => {
      const busy = lookup.get(cellKey(cell.day, cell.period))?.busy
      if (!busy) return null
      return {
        day: cell.day,
        period: cell.period,
        section: busy.sectionLabel,
        sectionId: busy.sectionId,
        subjectCode: busy.subjectCode,
        message:
          target?.target_type === 'section'
            ? `${code} already has ${busy.subjectCode} here`
            : `${code} already has ${busy.subjectCode} with ${shortSection(busy.sectionLabel)} here`
      }
    })
    .filter(Boolean)
}

export default function Constraints() {
  const { activeTimetable, activeId, timetables, setActiveId } = useActiveTimetable()
  const navigate = useNavigate()

  const [tab, setTab] = useState('teacher')
  const [teachers, setTeachers] = useState([])
  const [venues, setVenues] = useState([])
  const [sections, setSections] = useState([])
  const [summary, setSummary] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [onlyRequests, setOnlyRequests] = useState(false)

  const [cells, setCells] = useState([])
  const [savedCells, setSavedCells] = useState([])
  const [note, setNote] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [matrix, setMatrix] = useState([])
  const [history, setHistory] = useState({ undo: [], redo: [] })
  const [brush, setBrush] = useState('cannot')
  const [cursor, setCursor] = useState({ day: 1, period: 1 })
  const [byTime, setByTime] = useState(EMPTY_BY_TIME)
  const [timeSummary, setTimeSummary] = useState('')
  const [copyFrom, setCopyFrom] = useState(null)
  const [savedConflicts, setSavedConflicts] = useState([])
  const [status, setStatus] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const dragRef = useRef(null)
  const lastPaintedRef = useRef(null)
  const cellsRef = useRef(cells)
  const dirtyRef = useRef(false)
  const revertingRef = useRef(false)
  const gridRef = useRef(null)

  useEffect(() => {
    cellsRef.current = cells
  }, [cells])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.teachers.list(), window.api.venues.list()]).then(
      ([teacherResponse, venueResponse]) => {
        if (cancelled) return
        if (teacherResponse.ok) setTeachers(teacherResponse.data)
        if (venueResponse.ok) setVenues(venueResponse.data)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!activeId) {
      setSections([])
      return undefined
    }
    window.api.sections.list(activeId).then((response) => {
      if (cancelled) return
      if (response.ok) setSections(response.data)
      else setError(response.error)
    })
    return () => {
      cancelled = true
    }
  }, [activeId])

  const loadSummary = useCallback(async () => {
    if (!activeId) {
      setSummary([])
      return
    }
    const response = await window.api.availability.summary(activeId, tab)
    if (response.ok) setSummary(response.data)
    else setError(response.error)
  }, [activeId, tab])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const targets = useMemo(() => {
    if (tab === 'teacher') {
      return teachers.map((teacher) => ({
        ...teacher,
        target_type: 'teacher',
        target_id: teacher.id,
        code: teacher.code,
        name: teacher.name,
        semester: null
      }))
    }
    if (tab === 'venue') {
      return venues.map((venue) => ({
        ...venue,
        target_type: 'venue',
        target_id: venue.id,
        code: venue.code,
        name: venue.name ?? '',
        semester: null
      }))
    }
    return sections.map((section) => ({
      ...section,
      target_type: 'section',
      target_id: section.id,
      code: `${section.semester}-${section.name}`,
      name: `Sem ${section.semester} - ${section.name}`,
      semester: Number(section.semester)
    }))
  }, [tab, teachers, venues, sections])

  const summaryMap = useMemo(() => {
    const map = new Map()
    for (const entry of summary) {
      map.set(Number(entry.target_id), entry)
    }
    return map
  }, [summary])

  useEffect(() => {
    setSelectedId(null)
    setSearch('')
    setOnlyRequests(false)
    setSavedConflicts([])
    setStatus('')
  }, [tab])

  useEffect(() => {
    if (targets.length === 0) {
      setSelectedId(null)
      return
    }
    if (!targets.some((target) => target.id === selectedId)) {
      setSelectedId(targets[0].id)
    }
  }, [targets, selectedId])

  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedId) || null,
    [targets, selectedId]
  )

  const loadTarget = useCallback(async () => {
    if (!activeId || !selectedId) {
      setCells([])
      setSavedCells([])
      setNote('')
      setSavedNote('')
      setMatrix([])
      return
    }
    setLoading(true)
    try {
      const [availabilityResponse, matrixResponse] = await Promise.all([
        window.api.availability.get(activeId, tab, selectedId),
        window.api.availability.matrix(activeId, tab, selectedId)
      ])
      if (availabilityResponse.ok) {
        setCells(availabilityResponse.data.cells)
        setSavedCells(availabilityResponse.data.cells)
        setNote(availabilityResponse.data.note ?? '')
        setSavedNote(availabilityResponse.data.note ?? '')
      } else {
        setError(availabilityResponse.error)
      }
      if (matrixResponse.ok) setMatrix(matrixResponse.data)
      setHistory({ undo: [], redo: [] })
      lastPaintedRef.current = null
      setSavedConflicts([])
      setStatus('')
    } finally {
      setLoading(false)
    }
  }, [activeId, tab, selectedId])

  useEffect(() => {
    loadTarget()
  }, [loadTarget])

  const levelMap = useMemo(() => cellsToLevelMap(cells), [cells])
  const matrixMap = useMemo(() => matrixLookup(matrix), [matrix])

  const dirty =
    JSON.stringify(normalizeCells(cells)) !== JSON.stringify(normalizeCells(savedCells)) ||
    note.trim() !== String(savedNote ?? '').trim()

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // Leaving the page with unsaved painting asks first (hash navigation and
  // window close both go through here).
  useEffect(() => {
    const beforeUnload = (event) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const hashChange = () => {
      // Putting the hash back triggers one more hashchange: ignore that one so
      // the professor is not asked twice and the guard stays active.
      if (revertingRef.current) {
        revertingRef.current = false
        return
      }
      if (!dirtyRef.current) return
      const leave = window.confirm('You have unsaved availability changes. Leave anyway?')
      if (leave) {
        dirtyRef.current = false
        return
      }
      revertingRef.current = true
      window.location.hash = '#/constraints'
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('hashchange', hashChange)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('hashchange', hashChange)
    }
  }, [])

  useEffect(() => {
    const mouseUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mouseup', mouseUp)
    return () => window.removeEventListener('mouseup', mouseUp)
  }, [])

  const existingViolations = useMemo(
    () => conflictingLectures(cells, matrix, selectedTarget),
    [cells, matrix, selectedTarget]
  )

  const visibleTargets = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return targets.filter((target) => {
      const counts = summaryMap.get(Number(target.id)) ?? { cannot: 0, avoid: 0 }
      if (onlyRequests && Number(counts.cannot) + Number(counts.avoid) === 0) return false
      if (!needle) return true
      return `${target.code} ${target.name ?? ''}`.toLowerCase().includes(needle)
    })
  }, [targets, search, onlyRequests, summaryMap])

  const semesterGroups = useMemo(() => {
    if (tab !== 'section') return null
    return groupSectionsBySemester(
      visibleTargets.map((target) => ({
        ...target,
        semester: target.semester,
        name: target.name
      }))
    )
  }, [tab, visibleTargets])

  function pushHistory() {
    setHistory((previous) => ({
      undo: [...previous.undo, cellsRef.current].slice(-HISTORY_LIMIT),
      redo: []
    }))
  }

  function paintWith(points, level) {
    if (!points.length) return
    pushHistory()
    setCells((previous) => paintCells(previous, points, level))
    lastPaintedRef.current = points[points.length - 1]
    setStatus('')
  }

  function startPaint(point, event) {
    gridRef.current?.focus()
    setCursor(point)
    if (event?.shiftKey && lastPaintedRef.current) {
      pushHistory()
      const points = rectangleCells(lastPaintedRef.current, point)
      setCells((previous) => paintCells(previous, points, brush))
      lastPaintedRef.current = point
      return
    }
    dragRef.current = point
    pushHistory()
    setCells((previous) => paintCells(previous, [point], brush))
    lastPaintedRef.current = point
    setStatus('')
  }

  function dragOver(point) {
    setCursor(point)
    const origin = dragRef.current
    if (!origin) return
    const points = rectangleCells(origin, point)
    setCells((previous) => paintCells(previous, points, brush))
  }

  function undo() {
    if (!history.undo.length) return
    const previous = history.undo[history.undo.length - 1]
    setHistory({ undo: history.undo.slice(0, -1), redo: [...history.redo, cells] })
    setCells(previous)
  }

  function redo() {
    if (!history.redo.length) return
    const next = history.redo[history.redo.length - 1]
    setHistory({ undo: [...history.undo, cells], redo: history.redo.slice(0, -1) })
    setCells(next)
  }

  function clearAll() {
    paintWith(
      DAYS.flatMap((day) => PERIODS.map((period) => ({ day: day.value, period: period.no }))),
      null
    )
    setTimeSummary('')
  }

  function applyByTime() {
    const result = applyRequestByTime({
      days: byTime.days,
      from: byTime.from,
      to: byTime.to,
      periodRows: PERIODS
    })
    setTimeSummary(result.summary)
    if (result.points.length) paintWith(result.points, byTime.level)
  }

  function toggleDay(day) {
    setByTime((previous) => ({
      ...previous,
      days: previous.days.includes(day)
        ? previous.days.filter((value) => value !== day)
        : [...previous.days, day].sort((left, right) => left - right)
    }))
  }

  function onGridKeyDown(event) {
    const { key } = event
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      setCursor((previous) => {
        if (key === 'ArrowUp') return { ...previous, day: Math.max(1, previous.day - 1) }
        if (key === 'ArrowDown') return { ...previous, day: Math.min(6, previous.day + 1) }
        if (key === 'ArrowLeft') {
          return { ...previous, period: Math.max(1, previous.period - 1) }
        }
        return { ...previous, period: Math.min(8, previous.period + 1) }
      })
      return
    }
    if (key === ' ') {
      event.preventDefault()
      paintWith([cursor], brush)
    }
  }

  async function save() {
    if (!activeId || !selectedId || saving) return
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const response = await window.api.availability.save(
        activeId,
        tab,
        selectedId,
        cells,
        note
      )
      if (!response.ok) {
        setError(response.error)
        return
      }
      setSavedCells(response.data.cells)
      setSavedNote(response.data.note ?? '')
      setNote(response.data.note ?? '')
      setHistory({ undo: [], redo: [] })
      await loadSummary()
      const matrixResponse = await window.api.availability.matrix(activeId, tab, selectedId)
      if (matrixResponse.ok) setMatrix(matrixResponse.data)
      const conflicts = conflictingLectures(
        response.data.cells,
        matrixResponse.ok ? matrixResponse.data : matrix,
        selectedTarget
      )
      setSavedConflicts(conflicts)
      setStatus(
        conflicts.length
          ? `Saved. ${conflicts.length} existing lecture${conflicts.length === 1 ? '' : 's'} now conflict.`
          : 'Saved.'
      )
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setCells(savedCells)
    setNote(savedNote ?? '')
    setHistory({ undo: [], redo: [] })
    setTimeSummary('')
    setSavedConflicts([])
    setStatus('')
  }

  async function copyFromTarget() {
    if (!copyFrom || !selectedId) return
    const response = await window.api.availability.copy(
      activeId,
      tab,
      copyFrom,
      tab,
      selectedId
    )
    if (!response.ok) {
      setError(response.error)
      return
    }
    setCells(response.data.cells)
    setSavedCells(response.data.cells)
    setNote(response.data.note ?? '')
    setSavedNote(response.data.note ?? '')
    setHistory({ undo: [], redo: [] })
    setSavedConflicts([])
    setStatus('Copied.')
    await loadSummary()
  }

  /** Switching target or tab throws the draft away, so ask first. */
  function confirmDiscard() {
    if (!dirtyRef.current) return true
    return window.confirm('You have unsaved availability changes. Discard them?')
  }

  function goToSlot(conflict) {
    navigate('/master-timetable', {
      state: {
        sectionId: conflict.sectionId,
        day: conflict.day,
        period: conflict.period
      }
    })
  }

  const copyOptions = targets.filter((target) => target.id !== selectedId)

  if (!activeTimetable) {
    return (
      <div>
        <h1>Constraints</h1>
        <div className="empty-state">
          <p>No timetable yet. Create one in Timetable Setup first.</p>
        </div>
      </div>
    )
  }

  const targetRow = (target) => {
    const counts = summaryMap.get(Number(target.id)) ?? { cannot: 0, avoid: 0 }
    return (
      <button
        key={`${target.target_type}-${target.id}`}
        type="button"
        className={
          target.id === selectedId
            ? 'availability-target availability-target-active'
            : 'availability-target'
        }
        aria-pressed={target.id === selectedId}
        onClick={() => {
          if (target.id === selectedId) return
          if (confirmDiscard()) setSelectedId(target.id)
        }}
      >
        <span className="availability-target-code">{target.code}</span>
        {target.name && target.name !== target.code && (
          <span className="availability-target-name">{target.name}</span>
        )}
        <span className="availability-badges">
          {Number(counts.cannot) > 0 && (
            <span className="availability-badge availability-badge-cannot" title="Cannot">
              {counts.cannot}
            </span>
          )}
          {Number(counts.avoid) > 0 && (
            <span className="availability-badge availability-badge-avoid" title="Prefer not">
              {counts.avoid}
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div className="availability-page">
      <header className="page-header availability-page-head">
        <div>
          <p className="eyebrow">Timing requests</p>
          <h1>Constraints</h1>
          <p className="muted small">
            Record when a teacher, venue or section is not available. The Master Timetable warns
            (prefer not) or blocks (cannot) when a lecture lands on a request.
          </p>
        </div>
        <label className="availability-timetable">
          <span className="editor-label">Timetable</span>
          <select
            className="input"
            value={activeId ?? ''}
            onChange={(event) => setActiveId(Number(event.target.value))}
          >
            {timetables.map((timetable) => (
              <option key={timetable.id} value={timetable.id}>
                {timetable.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && <p className="form-error">{error}</p>}

      <div className="tabs" role="tablist" aria-label="Availability targets">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            className={tab === entry.value ? 'tab tab-active' : 'tab'}
            onClick={() => {
              if (tab === entry.value) return
              if (confirmDiscard()) setTab(entry.value)
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="availability-layout">
        <aside className="availability-side" aria-label="Targets">
          <input
            type="search"
            className="input"
            placeholder={`Search ${tab === 'teacher' ? 'teachers' : tab === 'venue' ? 'venues' : 'sections'}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search targets"
          />
          <label className="editor-checkbox availability-filter">
            <input
              type="checkbox"
              checked={onlyRequests}
              onChange={(event) => setOnlyRequests(event.target.checked)}
            />
            <span>Only with requests</span>
          </label>

          <div className="availability-target-list">
            {tab === 'section' && semesterGroups
              ? semesterGroups.map((group) => (
                  <div key={group.semester} className="availability-target-group">
                    <p className="availability-target-group-label">{group.label}</p>
                    {group.sections.map(targetRow)}
                  </div>
                ))
              : visibleTargets.map(targetRow)}
            {visibleTargets.length === 0 && <p className="muted small">No match.</p>}
          </div>
        </aside>

        <section className="availability-editor" aria-label="Availability editor">
          {!selectedTarget ? (
            <p className="muted">Pick a target on the left.</p>
          ) : (
            <>
              <header className="availability-editor-head">
                <div>
                  <h2>
                    {selectedTarget.code}
                    {selectedTarget.name && selectedTarget.name !== selectedTarget.code
                      ? ` · ${selectedTarget.name}`
                      : ''}
                  </h2>
                  <p className="muted small">
                    {loading
                      ? 'Loading…'
                      : `${normalizeCells(cells).length} requested cell${
                          normalizeCells(cells).length === 1 ? '' : 's'
                        }`}
                  </p>
                </div>
                <div className="availability-brushes" role="group" aria-label="Brush">
                  <button
                    type="button"
                    className={brush === null ? 'segment segment-active' : 'segment'}
                    aria-pressed={brush === null}
                    onClick={() => setBrush(null)}
                  >
                    Free
                  </button>
                  <button
                    type="button"
                    className={brush === 'avoid' ? 'segment segment-active' : 'segment'}
                    aria-pressed={brush === 'avoid'}
                    onClick={() => setBrush('avoid')}
                  >
                    Prefer not
                  </button>
                  <button
                    type="button"
                    className={brush === 'cannot' ? 'segment segment-active' : 'segment'}
                    aria-pressed={brush === 'cannot'}
                    onClick={() => setBrush('cannot')}
                  >
                    Cannot
                  </button>
                </div>
              </header>

              <div className="availability-toolbar">
                <div className="availability-presets" role="group" aria-label="Presets">
                  {AVAILABILITY_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => paintWith(presetPoints(preset.id), brush)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="availability-edit-actions">
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={undo}
                    disabled={history.undo.length === 0}
                    title="Undo (last 30 edits)"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={redo}
                    disabled={history.redo.length === 0}
                  >
                    Redo
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={clearAll}
                  >
                    Clear all
                  </button>
                </div>
              </div>

              <div className="availability-legend">
                <span className="availability-legend-item availability-legend-free">Free</span>
                <span className="availability-legend-item availability-legend-avoid">Prefer not</span>
                <span className="availability-legend-item availability-legend-cannot">Cannot</span>
                <span className="muted small">
                  Click or drag to paint · day/period headers paint a whole row or column · Shift+click
                  paints a rectangle · arrows move, Space paints
                </span>
              </div>

              {existingViolations.length > 0 && (
                <div className="availability-inline-warning" role="status">
                  <strong>
                    {existingViolations.length} existing lecture
                    {existingViolations.length === 1 ? '' : 's'} will violate this.
                  </strong>
                  <ul>
                    {existingViolations.slice(0, 3).map((conflict) => (
                      <li key={`${conflict.day}-${conflict.period}-${conflict.subjectCode}`}>
                        {conflict.message} ({AVAILABILITY_DAY_LABELS[conflict.day]} P
                        {conflict.period})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div
                className="availability-grid-wrap"
                ref={gridRef}
                tabIndex={0}
                role="grid"
                aria-label="Availability grid. Use the brush to paint timing requests."
                onKeyDown={onGridKeyDown}
              >
                <table className="sheet-grid availability-grid">
                  <colgroup>
                    <col className="sheet-col-day" />
                    {BEFORE_LUNCH.map((period) => (
                      <col key={period.no} />
                    ))}
                    <col className="sheet-col-lunch" />
                    {AFTER_LUNCH.map((period) => (
                      <col key={period.no} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col" className="grid-head-day">
                        DAY
                      </th>
                      {BEFORE_LUNCH.map((period) => (
                        <th key={period.no} scope="col" className="grid-head-period">
                          <button
                            type="button"
                            className="availability-head-button"
                            title={`Paint P${period.no} on every day`}
                            onClick={() => paintWith(periodCells(period.no), brush)}
                          >
                            <span className="grid-period-label">P{period.no}</span>
                            <span className="grid-period-time">
                              {formatTimeRange12Hour(period.start, period.end)}
                            </span>
                          </button>
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="grid-head-lunch"
                        aria-label={`LUNCH ${formatTimeRange12Hour(LUNCH.start, LUNCH.end)}`}
                      />
                      {AFTER_LUNCH.map((period) => (
                        <th key={period.no} scope="col" className="grid-head-period">
                          <button
                            type="button"
                            className="availability-head-button"
                            title={`Paint P${period.no} on every day`}
                            onClick={() => paintWith(periodCells(period.no), brush)}
                          >
                            <span className="grid-period-label">P{period.no}</span>
                            <span className="grid-period-time">
                              {formatTimeRange12Hour(period.start, period.end)}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((day) => (
                      <tr key={day.value}>
                        <th scope="row" className="grid-day-name">
                          <button
                            type="button"
                            className="availability-day-button"
                            title={`Paint all of ${day.label}`}
                            onClick={() => paintWith(dayCells(day.value), brush)}
                          >
                            {day.label}
                          </button>
                        </th>
                        {BEFORE_LUNCH.map((period) => (
                          <AvailabilityCell
                            key={`${day.value}-${period.no}`}
                            day={day.value}
                            period={period.no}
                            level={levelMap.get(cellKey(day.value, period.no))}
                            busy={matrixMap.get(cellKey(day.value, period.no))?.busy}
                            focused={cursor.day === day.value && cursor.period === period.no}
                            onStart={startPaint}
                            onEnter={dragOver}
                          />
                        ))}
                        <td className="grid-lunch">
                          <span className="grid-lunch-label">LUNCH</span>
                        </td>
                        {AFTER_LUNCH.map((period) => (
                          <AvailabilityCell
                            key={`${day.value}-${period.no}`}
                            day={day.value}
                            period={period.no}
                            level={levelMap.get(cellKey(day.value, period.no))}
                            busy={matrixMap.get(cellKey(day.value, period.no))?.busy}
                            focused={cursor.day === day.value && cursor.period === period.no}
                            onStart={startPaint}
                            onEnter={dragOver}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <section className="availability-request-form" aria-label="Add a request by time">
                <h3>Add a request by time</h3>
                <div className="availability-day-chips">
                  {DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      className={
                        byTime.days.includes(day.value)
                          ? 'chip-chip chip-chip-active'
                          : 'chip-chip'
                      }
                      aria-pressed={byTime.days.includes(day.value)}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="chip-chip"
                    onClick={() =>
                      setByTime((previous) => ({
                        ...previous,
                        days: previous.days.length === 6 ? [] : [1, 2, 3, 4, 5, 6]
                      }))
                    }
                  >
                    All days
                  </button>
                </div>
                <div className="availability-time-row">
                  <label className="editor-field">
                    <span className="editor-label">From</span>
                    <input
                      type="time"
                      className="input"
                      value={byTime.from}
                      onChange={(event) =>
                        setByTime((previous) => ({ ...previous, from: event.target.value }))
                      }
                    />
                  </label>
                  <label className="editor-field">
                    <span className="editor-label">To</span>
                    <input
                      type="time"
                      className="input"
                      value={byTime.to}
                      onChange={(event) =>
                        setByTime((previous) => ({ ...previous, to: event.target.value }))
                      }
                    />
                  </label>
                  <label className="editor-field">
                    <span className="editor-label">Level</span>
                    <select
                      className="input"
                      value={byTime.level}
                      onChange={(event) =>
                        setByTime((previous) => ({ ...previous, level: event.target.value }))
                      }
                    >
                      <option value="cannot">Cannot</option>
                      <option value="avoid">Prefer not</option>
                    </select>
                  </label>
                  <button type="button" className="button button-small" onClick={applyByTime}>
                    Apply
                  </button>
                </div>
                {timeSummary && (
                  <p className="availability-time-summary" role="status">
                    {timeSummary}
                  </p>
                )}
              </section>

              <div className="availability-copy-row">
                <label className="editor-field availability-copy">
                  <span className="editor-label">
                    Copy from another {tab === 'teacher' ? 'teacher' : tab === 'venue' ? 'venue' : 'section'}
                  </span>
                  <select
                    className="input"
                    value={copyFrom ?? ''}
                    onChange={(event) =>
                      setCopyFrom(event.target.value === '' ? null : Number(event.target.value))
                    }
                  >
                    <option value="">Choose…</option>
                    {copyOptions.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.code}
                        {target.name && target.name !== target.code ? ` — ${target.name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={copyFromTarget}
                  disabled={!copyFrom}
                >
                  Copy
                </button>
              </div>

              <label className="editor-field availability-note">
                <span className="editor-label">Reason / note</span>
                <textarea
                  className="input"
                  rows={2}
                  value={note}
                  placeholder="Asked on 2 Nov, has a clinic every Friday"
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>

              <div className="availability-save-row">
                {dirty ? (
                  <span className="availability-dirty">● Unsaved changes</span>
                ) : (
                  <span className="muted small">No unsaved changes.</span>
                )}
                {status && <span className="availability-status">{status}</span>}
                <span className="slot-editor-spacer" />
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={discard}
                  disabled={!dirty || saving}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="button button-small"
                  onClick={save}
                  disabled={!dirty || saving}
                >
                  {saving
                    ? 'Saving…'
                    : existingViolations.length
                      ? `Save (${existingViolations.length} existing lecture${
                          existingViolations.length === 1 ? '' : 's'
                        } will violate this)`
                      : 'Save'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {savedConflicts.length > 0 && (
        <section className="availability-conflicts" aria-label="Existing conflicts">
          <h3>
            Existing lectures that conflict with these requests ({savedConflicts.length})
          </h3>
          <ul>
            {savedConflicts.map((conflict) => (
              <li key={`${conflict.sectionId}-${conflict.day}-${conflict.period}`}>
                <span>
                  <strong>{conflict.section}</strong> · {conflict.subjectCode} ·{' '}
                  {AVAILABILITY_DAY_LABELS[conflict.day]} P{conflict.period}
                </span>
                <button
                  type="button"
                  className="button-link"
                  onClick={() => goToSlot(conflict)}
                >
                  Go to slot
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Nothing was moved or deleted; open a slot to reschedule it.</p>
        </section>
      )}

    </div>
  )
}

function AvailabilityCell({ day, period, level, busy, focused, onStart, onEnter }) {
  const classes = ['availability-cell']
  if (level) classes.push(`availability-cell-${level}`)
  if (busy) classes.push('availability-cell-busy')
  if (focused) classes.push('availability-cell-focused')

  const title = [
    `Day ${day} · P${period}`,
    level === 'cannot' ? 'Cannot (requested)' : level === 'avoid' ? 'Prefer not (requested)' : 'Free',
    busy ? `Existing: ${busy.subjectCode} ${busy.sectionLabel}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <td
      className={classes.join(' ')}
      title={title}
      data-availability-key={`${day}-${period}`}
      onMouseDown={(event) => {
        event.preventDefault()
        onStart({ day, period }, event)
      }}
      onMouseEnter={() => onEnter({ day, period })}
    >
      {busy && (
        <span className="availability-busy-label">
          <strong>{busy.subjectCode}</strong>
          <span>{shortSection(busy.sectionLabel)}</span>
        </span>
      )}
    </td>
  )
}
