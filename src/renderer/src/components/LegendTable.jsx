import { splitLegend } from '@shared/legend'

function EntryCells({ entry, startClassName = '' }) {
  if (!entry) {
    return (
      <>
        <td className={startClassName}>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
      </>
    )
  }

  return (
    <>
      <td className={`legend-code ${startClassName}`.trim()}>{entry.code}</td>
      <td>{entry.name}</td>
      <td className="legend-code">{entry.teachers || '—'}</td>
      <td>{entry.teacherNames || '—'}</td>
    </>
  )
}

/**
 * The department sheet's legend: Subject Code | Subject Name | Faculty Code |
 * Faculty Name, twice side by side. Entries come from buildLegend(), which is
 * fed by the slots actually shown on the sheet.
 */
export default function LegendTable({
  entries = [],
  hint = '',
  emptyMessage = 'No subject classes in this timetable yet.'
}) {
  const { rowCount, left, right } = splitLegend(entries)

  return (
    <section className="legend-preview">
      <div className="legend-heading">
        <h3>Legend</h3>
        {hint ? <span className="muted small">{hint}</span> : null}
      </div>

      {entries.length === 0 ? (
        <p className="muted small">{emptyMessage}</p>
      ) : (
        <table className="legend-table">
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Subject Code</th>
              <th scope="col">Subject Name</th>
              <th scope="col">Faculty Code</th>
              <th scope="col">Faculty Name</th>
              <th scope="col" className="legend-divider">
                Subject Code
              </th>
              <th scope="col">Subject Name</th>
              <th scope="col">Faculty Code</th>
              <th scope="col">Faculty Name</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, index) => (
              <tr key={index}>
                <EntryCells entry={left[index]} />
                <EntryCells entry={right[index]} startClassName="legend-divider" />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
