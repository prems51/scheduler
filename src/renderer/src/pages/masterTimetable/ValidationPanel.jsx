import ProblemList from '../../components/ProblemList'

/** Report from timetable:validate, listed under the section tabs. */
export default function ValidationPanel({ report, busy = false, onClose }) {
  const conflicts = report?.slots ?? []
  const checked = report?.checked ?? 0
  const slotWord = checked === 1 ? 'slot' : 'slots'

  let summary = `Checking all ${slotWord}…`
  if (!busy) {
    if (conflicts.length === 0) {
      summary = `No conflicts. ${checked} ${slotWord} checked.`
    } else {
      summary = `${conflicts.length} ${conflicts.length === 1 ? 'slot has' : 'slots have'} problems, out of ${checked} checked.`
    }
  }

  return (
    <section
      className={conflicts.length ? 'validation-panel has-problems' : 'validation-panel'}
      aria-label="Whole timetable check"
    >
      <header className="validation-header">
        <div>
          <strong>Whole timetable check</strong>
          <p className="validation-summary">{summary}</p>
        </div>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close check">
          ✕
        </button>
      </header>

      {conflicts.length > 0 && (
        <>
          <ul className="validation-list">
            {conflicts.map((entry) => (
              <li key={entry.slot_id} className="validation-item">
                <span className="validation-where">
                  <strong>{entry.section}</strong> · {entry.where}
                  {entry.what ? ` · ${entry.what}` : ''}
                </span>
                <ProblemList problems={entry.problems} />
              </li>
            ))}
          </ul>
          <p className="validation-hint">Fix a slot by clicking it in the grid, then saving without conflicts.</p>
        </>
      )}
    </section>
  )
}
