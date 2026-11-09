import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useActiveTimetable } from '../context/ActiveTimetableContext'

const HEALTH_CATEGORIES = [
  { key: 'clashes', label: 'Clashes', tone: 'error' },
  { key: 'violations', label: 'Availability violations', tone: 'error' },
  { key: 'overridden', label: 'Overridden requests', tone: 'info' },
  { key: 'ignored', label: 'Ignored preferences', tone: 'warning' }
]

const QUICK_LINKS = [
  { to: '/master-data', label: 'Master Data', hint: 'Teachers, subjects and rooms' },
  { to: '/timetable-setup', label: 'Timetable Setup', hint: 'Sections and subject allocations' },
  { to: '/constraints', label: 'Constraints', hint: 'Cannot / prefer-not times' },
  { to: '/master-timetable', label: 'Master Timetable', hint: 'Place and check classes' },
  { to: '/faculty-timetables', label: 'Faculty Timetables', hint: 'Review generated views' },
  { to: '/venue-timetables', label: 'Venue Timetables', hint: 'Review room views' },
  { to: '/export', label: 'Export', hint: 'Excel and PDF files' }
]

const STAT_LABELS = [
  { key: 'sections', label: 'Sections' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'subjects', label: 'Subjects' },
  { key: 'venues', label: 'Venues' },
  { key: 'slots', label: 'Slots filled' }
]

export default function Dashboard() {
  const { activeTimetable, activeId, loading: timetableLoading } = useActiveTimetable()
  const navigate = useNavigate()

  const [overview, setOverview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    if (!activeId) {
      setOverview(null)
      setError('')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await window.api.timetables.overview(activeId)
      if (response.ok) setOverview(response.data)
      else {
        setOverview(null)
        setError(response.error)
      }
    } catch (failure) {
      setOverview(null)
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }, [activeId])

  useEffect(() => {
    setOverview(null)
    loadOverview()
  }, [loadOverview])

  function goToSlot(entry) {
    navigate('/master-timetable', {
      state: {
        sectionId: entry.section_id,
        day: entry.day,
        period: entry.start_period
      }
    })
  }

  const health = overview?.health
  const counts = health?.counts ?? {
    clashes: 0,
    violations: 0,
    overridden: 0,
    ignored: 0,
    issues: 0
  }

  if (timetableLoading) {
    return (
      <div className="dashboard-page">
        <h1>Dashboard</h1>
        <p className="muted">Loading your timetable…</p>
      </div>
    )
  }

  if (!activeTimetable) {
    return (
      <div className="dashboard-page">
        <h1>Dashboard</h1>
        <div className="empty-state">
          <p>No timetable yet. Create one in Timetable Setup to see its sections and health here.</p>
          <Link className="button" to="/timetable-setup">
            Open Timetable Setup
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {activeTimetable.title}
            {activeTimetable.effective_from ? ` · w.e.f. ${activeTimetable.effective_from}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={loadOverview}
          disabled={busy}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {!overview && busy ? (
        <section className="dashboard-loading" aria-label="Loading dashboard">
          <span className="dashboard-loading-bar" />
          <span className="dashboard-loading-bar" />
          <span className="dashboard-loading-bar" />
        </section>
      ) : overview ? (
        <>
          <section className="dashboard-stats" aria-label="Timetable totals">
            {STAT_LABELS.map((stat) => (
              <div key={stat.key} className="dashboard-stat">
                <span className="dashboard-stat-value">{overview.stats[stat.key] ?? 0}</span>
                <span className="dashboard-stat-label">{stat.label}</span>
              </div>
            ))}
          </section>
          <p className="dashboard-note">
            Teachers, subjects and venues are shared master data; sections and classes belong to this
            timetable.
          </p>

          <nav className="dashboard-quick-links" aria-label="Quick links">
            {QUICK_LINKS.map((link) => (
              <Link key={link.to} className="dashboard-quick-link" to={link.to}>
                <strong>{link.label}</strong>
                <span>{link.hint}</span>
              </Link>
            ))}
          </nav>

          <section className="dashboard-panel" aria-label="Sections">
            <div className="panel-header">
              <div>
                <h2>Sections</h2>
                <p className="muted small">How much of each section is filled and what needs attention.</p>
              </div>
              <Link className="button button-secondary button-small" to="/timetable-setup">
                Manage sections
              </Link>
            </div>

            {overview.sections.length === 0 ? (
              <div className="empty-state empty-state-inline">
                <p>No sections yet. Click Add section in Timetable Setup.</p>
                <Link className="button" to="/timetable-setup">
                  Add a section
                </Link>
              </div>
            ) : (
              <table className="dashboard-sections">
                <thead>
                  <tr>
                    <th scope="col">Section</th>
                    <th scope="col">Slots filled</th>
                    <th scope="col">Conflicts</th>
                    <th scope="col">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.sections.map((section) => (
                    <tr key={section.id}>
                      <td>
                        <strong>
                          Sem {section.semester} - {section.name}
                        </strong>
                        <span className="dashboard-section-meta">
                          {section.allocation_count} subject
                          {section.allocation_count === 1 ? '' : 's'} allocated
                        </span>
                      </td>
                      <td>{section.slot_count}</td>
                      <td>
                        <span
                          className={
                            section.conflicts > 0
                              ? 'dashboard-conflict-badge dashboard-conflict-badge-error'
                              : 'dashboard-conflict-badge'
                          }
                        >
                          {section.conflicts > 0 ? `${section.conflicts} to fix` : 'None'}
                        </span>
                      </td>
                      <td className="dashboard-request-counts">
                        {section.overridden > 0 && <span>{section.overridden} overridden</span>}
                        {section.warnings > 0 && <span>{section.warnings} prefer-not</span>}
                        {section.overridden === 0 && section.warnings === 0 && <span>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="dashboard-check" aria-label="Timetable health">
            <header className="dashboard-check-head">
              <div>
                <h2>Timetable health</h2>
                <p className="muted small">
                  {health ? `${health.checked} class${health.checked === 1 ? '' : 'es'} checked` : 'Checking…'}
                </p>
              </div>
              <Link className="button-link" to="/master-timetable">
                Open Master Timetable
              </Link>
            </header>

            {health && (
              <>
                <div className="dashboard-counts">
                  {HEALTH_CATEGORIES.map((category) => (
                    <div
                      key={category.key}
                      className={`dashboard-count dashboard-count-${category.tone}`}
                    >
                      <span className="dashboard-count-value">{counts[category.key] ?? 0}</span>
                      <span className="dashboard-count-label">{category.label}</span>
                    </div>
                  ))}
                </div>

                {counts.issues === 0 && counts.overridden === 0 && counts.ignored === 0 && (
                  <p className="muted">No clashes and no timing requests are being violated.</p>
                )}

                {HEALTH_CATEGORIES.map((category) => {
                  const items = health[category.key] ?? []
                  if (!items.length) return null
                  return (
                    <div key={category.key} className="dashboard-issues">
                      <h3>
                        {category.label} ({items.length})
                      </h3>
                      <ul>
                        {items.slice(0, 8).map((entry, index) => (
                          <li
                            key={`${category.key}-${entry.slot_id}-${entry.type}-${index}`}
                            className={`dashboard-issue dashboard-issue-${category.tone}`}
                          >
                            <span>
                              <strong>{entry.section}</strong> · {entry.where}
                              {entry.what ? ` · ${entry.what}` : ''}
                              {entry.message ? ` — ${entry.message}` : ''}
                            </span>
                            <button type="button" className="button-link" onClick={() => goToSlot(entry)}>
                              Go to slot
                            </button>
                          </li>
                        ))}
                      </ul>
                      {items.length > 8 && <p className="muted small">…and {items.length - 8} more.</p>}
                    </div>
                  )
                })}
              </>
            )}
          </section>
        </>
      ) : (
        <p className="muted">No summary available yet. Try Refresh.</p>
      )}
    </div>
  )
}
