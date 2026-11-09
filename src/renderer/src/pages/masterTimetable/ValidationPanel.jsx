import ProblemList from '../../components/ProblemList'

const CATEGORIES = [
  { key: 'clashes', label: 'Clashes (errors)', tone: 'error' },
  { key: 'violations', label: 'Availability violations (not overridden)', tone: 'error' },
  { key: 'overridden', label: 'Overridden requests', tone: 'info' },
  { key: 'ignored', label: 'Ignored preferences (soft)', tone: 'warning' }
]

/**
 * Report from timetable:validate, listed under the section tabs. Every item can
 * jump to its slot; nothing is changed from here.
 */
export default function ValidationPanel({ report, busy = false, onClose, onGoToSlot }) {
  const counts = report?.counts ?? {
    clashes: 0,
    violations: 0,
    overridden: 0,
    ignored: 0,
    issues: 0
  }
  const checked = report?.checked ?? 0
  const slotWord = checked === 1 ? 'slot' : 'slots'
  const total =
    Number(counts.clashes ?? 0) +
    Number(counts.violations ?? 0) +
    Number(counts.overridden ?? 0) +
    Number(counts.ignored ?? 0)

  let summary = `Checking all ${slotWord}…`
  if (!busy) {
    summary =
      total === 0
        ? `No conflicts or timing requests. ${checked} ${slotWord} checked.`
        : `${counts.clashes} clash${counts.clashes === 1 ? '' : 'es'}, ${counts.violations} availability violation${
            counts.violations === 1 ? '' : 's'
          }, ${counts.overridden} overridden, ${counts.ignored} preference${
            counts.ignored === 1 ? '' : 's'
          } — ${checked} ${slotWord} checked.`
  }

  return (
    <section
      className={counts.issues > 0 ? 'validation-panel has-problems' : 'validation-panel'}
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

      {!busy && (
        <div className="validation-counts" aria-label="Issue counts">
          {CATEGORIES.map((category) => (
            <span
              key={category.key}
              className={`validation-count validation-count-${category.tone}`}
            >
              <strong>{counts[category.key] ?? 0}</strong> {category.label}
            </span>
          ))}
        </div>
      )}

      {!busy &&
        CATEGORIES.map((category) => {
          const items = report?.[category.key] ?? []
          if (!items.length) return null
          return (
            <div key={category.key} className="validation-category">
              <h4>
                {category.label} ({items.length})
              </h4>
              <ul className="validation-list">
                {items.map((entry, index) => (
                  <li
                    key={`${category.key}-${entry.slot_id}-${entry.type}-${index}`}
                    className={`validation-item validation-item-${category.tone}`}
                  >
                    <div className="validation-item-head">
                      <span className="validation-where">
                        <strong>{entry.section}</strong> · {entry.where}
                        {entry.what ? ` · ${entry.what}` : ''}
                      </span>
                      {onGoToSlot && (
                        <button
                          type="button"
                          className="button-link"
                          onClick={() => onGoToSlot(entry)}
                        >
                          Go to slot
                        </button>
                      )}
                    </div>
                    {entry.problem ? (
                      <ProblemList problems={[entry.problem]} />
                    ) : (
                      <p className="validation-message">{entry.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

      {!busy && total > 0 && (
        <p className="validation-hint">
          Clashes always block saving. An availability violation can be overridden from the slot
          editor; soft preferences never block.
        </p>
      )}
    </section>
  )
}
