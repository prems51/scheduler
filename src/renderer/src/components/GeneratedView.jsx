import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useActiveTimetable } from '../context/ActiveTimetableContext'
import TimetableGrid from './TimetableGrid'
import LegendTable from './LegendTable'
import { buildGrid, viewLines } from '@shared/gridLayout'
import { buildLegend } from '@shared/legend'

/** 2026-07-14 -> 14-07-2026, the way the department sheet writes w.e.f. */
function formatDate(value) {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text
}

/** "Students Timetable 2026-27 (Odd Semester)" -> "2026-27 (Odd Semester)" */
function titleQualifier(activeTimetable) {
  return String(activeTimetable?.title ?? '')
    .replace(/^students\s+timetable\s*/i, '')
    .trim()
}


export default function GeneratedView({ mode }) {
  const isFaculty = mode === 'faculty'
  const { activeTimetable, activeId } = useActiveTimetable()
  const navigate = useNavigate()

  const [items, setItems] = useState([])
  const [teachers, setTeachers] = useState([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [rows, setRows] = useState(null)
  const [freeSlots, setFreeSlots] = useState([])
  const [showFree, setShowFree] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.teachers.list().then((response) => {
      if (!cancelled && response.ok) setTeachers(response.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (activeId) {
      window.api.views.summary(activeId).then((response) => {
        if (cancelled) return
        if (!response.ok) {
          setError(response.error)
          setItems([])
          return
        }
        const list = isFaculty ? response.data.teachers : response.data.venues
        setItems(list)
        setSelectedId((previous) =>
          list.some((item) => item.id === previous) ? previous : (list[0]?.id ?? null)
        )
      })
    } else {
      setItems([])
      setSelectedId(null)
    }
    return () => {
      cancelled = true
    }
  }, [isFaculty, activeId])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!activeId || !selectedId) {
        setRows(null)
        setFreeSlots([])
        return
      }
      setLoading(true)
      const kind = isFaculty ? 'teacher' : 'venue'
      const listResponse = isFaculty
        ? await window.api.views.faculty(activeId, selectedId)
        : await window.api.views.venue(activeId, selectedId)
      const freeResponse = await window.api.views.free(activeId, kind, selectedId)
      if (cancelled) return
      setLoading(false)
      if (!listResponse.ok) {
        setError(listResponse.error)
        return
      }
      setError('')
      setRows(listResponse.data)
      setFreeSlots(freeResponse.ok ? freeResponse.data : [])
    }

    load()
    return () => {
      cancelled = true
    }
  }, [isFaculty, activeId, selectedId])

  const needle = search.trim().toLowerCase()
  const visibleItems = useMemo(() => {
    if (!needle) return items
    return items.filter((item) =>
      `${item.code} ${item.name ?? ''}`.toLowerCase().includes(needle)
    )
  }, [items, needle])

  const grid = useMemo(() => buildGrid(rows ?? []), [rows])
  const freeSet = useMemo(() => {
    if (!showFree) return null
    const set = new Set()
    for (const entry of freeSlots) set.add(`${entry.day}-${entry.period}`)
    return set
  }, [showFree, freeSlots])

  const heading =
    (isFaculty
      ? items.find((item) => item.id === selectedId)
      : items.find((item) => item.id === selectedId)) ?? null
  const headingText = !heading
    ? isFaculty
      ? 'FACULTY TIMETABLE'
      : 'VENUE TIMETABLE'
    : isFaculty
      ? `FACULTY TIMETABLE: ${heading.name} (${heading.code}) ${titleQualifier(activeTimetable)}`.replace(
          /\s+/g,
          ' '
        )
      : `VENUE TIMETABLE: ${heading.code}${heading.name ? ` (${heading.name})` : ''} ${titleQualifier(
          activeTimetable
        )}`.replace(/\s+/g, ' ')

  const legend = useMemo(() => buildLegend(rows ?? [], { teachers }), [rows, teachers])

  function onActivate(activation) {
    if (!activation?.slot) return
    navigate('/master-timetable', {
      state: {
        sectionId: activation.slot.section_id,
        day: activation.day,
        period: activation.period
      }
    })
  }

  if (!activeTimetable) {
    return (
      <div>
        <h1>{isFaculty ? 'Faculty Timetables' : 'Venue Timetables'}</h1>
        <div className="empty-state">
          <p>No timetable yet. Create one in Timetable Setup first.</p>
          <Link className="button" to="/timetable-setup">
            Open Timetable Setup
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1>{isFaculty ? 'Faculty Timetables' : 'Venue Timetables'}</h1>

      {error && <p className="form-error">{error}</p>}

      <div className="view-layout">
        <aside className="view-side" aria-label={isFaculty ? 'Teacher list' : 'Venue list'}>
          <input
            type="search"
            className="input view-search"
            placeholder={isFaculty ? 'Search teachers…' : 'Search venues…'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={isFaculty ? 'Search teachers' : 'Search venues'}
          />
          <div className="view-side-list">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === selectedId
                    ? 'view-side-item view-side-item-active'
                    : 'view-side-item'
                }
                aria-pressed={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="view-side-code">{item.code}</span>
                <span className="view-side-name">{item.name ?? ''}</span>
                <span className="view-side-count">{item.periods} P/week</span>
              </button>
            ))}
            {visibleItems.length === 0 && <p className="muted small">No match.</p>}
          </div>
        </aside>

        <section className="sheet" aria-label={headingText}>
          <header className="sheet-header">
            <p className="sheet-college">MORADABAD INSTITUTE OF TECHNOLOGY, MORADABAD</p>
            <p className="sheet-department">Department of Computer Science &amp; Engineering</p>
            <p className="sheet-title">{headingText}</p>
            {activeTimetable.effective_from && (
              <p className="sheet-effective">w.e.f. {formatDate(activeTimetable.effective_from)}</p>
            )}
          </header>

          <div className="view-toolbar">
            <label className="editor-checkbox">
              <input
                type="checkbox"
                checked={showFree}
                onChange={(event) => setShowFree(event.target.checked)}
              />
              <span>Free periods</span>
            </label>
            {showFree && (
              <span className="view-free-count muted small">
                {freeSlots.length} free (Mon–Fri, P1–P8)
              </span>
            )}
            {loading && <span className="muted small">Loading…</span>}
          </div>

          {rows === null ? (
            <p className="muted">Select {isFaculty ? 'a teacher' : 'a venue'} on the left.</p>
          ) : rows.length === 0 ? (
            <p className="muted">
              Nothing booked for this {isFaculty ? 'teacher' : 'venue'} yet.
            </p>
          ) : (
            <TimetableGrid
              grid={grid}
              linesFor={(slot) => viewLines(slot, mode)}
              freeSet={freeSet}
              onActivate={onActivate}
            />
          )}

          <LegendTable
            entries={legend}
            emptyMessage="No subject classes in this view."
            hint={`${legend.length} subject${legend.length === 1 ? '' : 's'} in this view`}
          />
        </section>
      </div>
    </div>
  )
}
