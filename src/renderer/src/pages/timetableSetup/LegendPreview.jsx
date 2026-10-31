function legendCells(allocation, teachersById, startClassName = '') {
  if (!allocation) {
    return (
      <>
        <td className={startClassName}>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
      </>
    )
  }

  const codes = allocation.teacher_ids
    .map((teacherId) => teachersById[teacherId]?.code)
    .filter(Boolean)
    .join('/')
  const names = allocation.teacher_ids
    .map((teacherId) => teachersById[teacherId]?.name)
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <td className={`legend-code ${startClassName}`.trim()}>{allocation.subject_code}</td>
      <td>{allocation.subject_name}</td>
      <td className="legend-code">{codes}</td>
      <td>{names}</td>
    </>
  )
}

export default function LegendPreview({
  allocations,
  teachers,
  emptyMessage = 'Add subjects above and the legend will appear here.',
  hint = 'Printed below the timetable, two column groups side by side'
}) {
  const teachersById = Object.fromEntries(teachers.map((teacher) => [teacher.id, teacher]))
  const rowCount = Math.ceil(allocations.length / 2)
  const left = allocations.slice(0, rowCount)
  const right = allocations.slice(rowCount)

  return (
    <section className="legend-preview">
      <div className="legend-heading">
        <h3>Legend</h3>
        {hint && <span className="muted small">{hint}</span>}
      </div>

      {allocations.length === 0 ? (
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
                {legendCells(left[index], teachersById)}
                {legendCells(right[index], teachersById, 'legend-divider')}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
