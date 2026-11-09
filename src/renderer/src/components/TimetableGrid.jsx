import {
  LUNCH,
  LUNCH_AFTER,
  PERIODS,
  formatTimeRange12Hour,
  slotCellAt,
  slotLines
} from '@shared/gridLayout'

const BEFORE_LUNCH = PERIODS.filter((period) => period.no <= LUNCH_AFTER)
const AFTER_LUNCH = PERIODS.filter((period) => period.no > LUNCH_AFTER)

function PeriodHead({ period }) {
  return (
    <th scope="col" className="grid-head-period">
      <span className="grid-period-label">P{period.no}</span>
      <span className="grid-period-time">
        {formatTimeRange12Hour(period.start, period.end)}
      </span>
    </th>
  )
}

function CellContent({ slot, linesFor = slotLines }) {
  const lines = linesFor(slot)
  const kind = String(slot.kind || '').toUpperCase()

  if (kind === 'ACTIVITY') {
    // linesFor already knows an activity's optional second line (its venue,
    // round-3 Issue 2); render every line, not just the label.
    return (
      <>
        <span className="grid-activity-label">{lines[0]}</span>
        {lines.slice(1).map((line, index) => (
          <span className="grid-activity-detail" key={`${line}-${index}`}>
            {line}
          </span>
        ))}
      </>
    )
  }

  return (
    <>
      <span className="grid-slot-head">{lines[0]}</span>
      {lines.slice(1).map((line, index) => (
        <span
          className={
            String(line).startsWith('Merged:')
              ? 'grid-slot-detail grid-slot-merged'
              : 'grid-slot-detail'
          }
          key={`${line}-${index}`}
        >
          {line}
        </span>
      ))}
    </>
  )
}

/** Does this slot belong to the target being shown in the overlay? */
function slotMatchesOverlay(slot, overlay) {
  if (!overlay) return false
  const id = Number(overlay.id)
  if (overlay.type === 'teacher') {
    return (slot.teacher_ids ?? []).map(Number).includes(id)
  }
  if (overlay.type === 'venue') return Number(slot.venue_id) === id
  return Number(slot.section_id) === id
}

/** Worst requested level the slot occupies: 'cannot' beats 'avoid'. */
function overlayLevelForSlot(slot, overlay) {
  if (!slotMatchesOverlay(slot, overlay)) return null
  const start = Number(slot.start_period)
  const span = Number(slot.span ?? 1)
  let level = null
  for (let period = start; period < start + span; period += 1) {
    const cell = overlay.matrix?.get(`${Number(slot.day)}-${period}`)
    if (cell?.level === 'cannot') return 'cannot'
    if (cell?.level === 'avoid') level = 'avoid'
  }
  return level
}

/** Requested level covered by a slot (faculty view hatching). */
function requestLevelForSlot(slot, requestCells) {
  if (!requestCells) return null
  const start = Number(slot.start_period)
  const span = Number(slot.span ?? 1)
  let level = null
  for (let period = start; period < start + span; period += 1) {
    const value = requestCells.get(`${Number(slot.day)}-${period}`)
    if (value === 'cannot') return 'cannot'
    if (value === 'avoid') level = 'avoid'
  }
  return level
}

function rowCells(
  row,
  day,
  laneIndex,
  showLunch,
  totalLaneRows,
  focused,
  focusedSlotId,
  onActivate,
  onAddActivity,
  onCellContext,
  linesFor,
  freeSet,
  availabilityOverlay,
  requestCells
) {
  const cells = []

  row.forEach((cell, index) => {
    if (cell.type === 'covered') return

    const cellPeriod = index + 1
    const isFocused = Boolean(
      focused &&
        focusedSlotId === null &&
        laneIndex === 0 &&
        focused.day === day &&
        focused.period === cellPeriod
    )

    if (cell.type === 'empty') {
      const overlayCell = availabilityOverlay?.matrix?.get(`${day}-${cellPeriod}`) ?? null
      const requestLevel = requestCells?.get(`${day}-${cellPeriod}`) ?? null
      const overlayClass = overlayCell?.busy
        ? ' grid-cell-avail-busy'
        : overlayCell?.level === 'cannot'
          ? ' grid-cell-avail-cannot'
          : overlayCell?.level === 'avoid'
            ? ' grid-cell-avail-avoid'
            : overlayCell
              ? ' grid-cell-avail-free'
              : ''
      const requestClass = requestLevel ? ` grid-cell-request-${requestLevel}` : ''
      const overlayTitle = overlayCell?.busy
        ? `Busy in ${overlayCell.busy.sectionLabel}: ${overlayCell.busy.subjectCode}`
        : overlayCell?.level === 'cannot'
          ? 'Requested: not available'
          : overlayCell?.level === 'avoid'
            ? 'Requested: prefers not'
            : overlayCell
              ? 'Free for this target'
              : undefined

      cells.push(
        <td
          key={`empty-${index}`}
          title={overlayTitle}
          className={`grid-empty${
            isFocused ? ' grid-cell-focused' : ''
          }${freeSet?.has(`${day}-${cellPeriod}`) ? ' grid-cell-free' : ''}${overlayClass}${requestClass}`}
          data-cell-key={`${day}-${cellPeriod}`}
          data-empty-key={`${day}-${cellPeriod}`}
          onClick={(event) => {
            onActivate?.({ day, period: cellPeriod, slot: null, element: event.currentTarget })
          }}
          onContextMenu={
            onCellContext
              ? (event) => {
                  event.preventDefault()
                  onCellContext({
                    day,
                    period: cellPeriod,
                    slot: null,
                    element: event.currentTarget,
                    client: { x: event.clientX, y: event.clientY }
                  })
                }
              : undefined
          }
        />
      )
    } else {
      const kind = String(cell.slot.kind || 'l').toLowerCase()
      const coversFocus = focusedSlotId !== null && cell.slot.id === focusedSlotId
      const overlayViolation = overlayLevelForSlot(cell.slot, availabilityOverlay)
      const requestLevel = requestLevelForSlot(cell.slot, requestCells)
      const violationClass = overlayViolation
        ? ` grid-cell-violates-${overlayViolation}`
        : ''
      const requestClass = requestLevel ? ` grid-cell-request-${requestLevel}` : ''
      const overrideMarker = Number(cell.slot.constraint_override) === 1

      cells.push(
        <td
          key={`slot-${cell.slot.id}`}
          rowSpan={cell.laneSpan > 1 ? cell.laneSpan : undefined}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
          className={`grid-slot grid-slot-${kind}${coversFocus ? ' grid-cell-focused' : ''}${violationClass}${requestClass}`}
          data-cell-key={`${day}-${cell.period}`}
          title={slotLines(cell.slot).join(' · ')}
          onClick={(event) => {
            if (event.target.closest('.grid-add-activity')) return // the hover button has its own click
            onActivate?.({
              day,
              period: cell.period,
              slot: cell.slot,
              element: event.currentTarget
            })
          }}
          onContextMenu={
            onCellContext
              ? (event) => {
                  event.preventDefault()
                  onCellContext({
                    day,
                    period: cell.period,
                    slot: cell.slot,
                    element: event.currentTarget,
                    client: { x: event.clientX, y: event.clientY }
                  })
                }
              : undefined
          }
        >
          <CellContent slot={cell.slot} linesFor={linesFor} />
          {overrideMarker && (
            <span
              className="grid-override-marker"
              title="Scheduled against a requested unavailability"
            >
              ⚠
            </span>
          )}
          {overlayViolation && (
            <span
              className={`grid-corner-marker grid-corner-${overlayViolation}`}
              title="This lecture sits on a requested-unavailability period"
            />
          )}
          {onAddActivity && kind !== 'activity' && (
            <button
              type="button"
              className="grid-add-activity"
              title="Add an activity in this period"
              aria-label={`Add an activity in ${day} P${cell.period}`}
              onClick={(event) => {
                event.stopPropagation()
                onAddActivity({
                  day,
                  period: cell.period,
                  slot: cell.slot,
                  element: event.currentTarget.closest('td')
                })
              }}
            >
              + Activity
            </button>
          )}
        </td>
      )
    }

    const width = cell.type === 'slot' ? cell.colSpan : 1
    if (showLunch && index + width === LUNCH_AFTER) {
      cells.push(
        <td key="lunch" rowSpan={totalLaneRows} className="grid-lunch">
          <span className="grid-lunch-label">LUNCH</span>
        </td>
      )
    }
  })

  return cells
}

export default function TimetableGrid({
  grid,
  focused = null,
  onActivate,
  onAddActivity,
  onCellContext,
  linesFor = slotLines,
  freeSet = null,
  availabilityOverlay = null,
  requestCells = null
}) {
  const focusedAnchor = focused ? slotCellAt(grid, focused.day, focused.period) : null
  const focusedSlotId = focusedAnchor?.slot.id ?? null

  return (
    <table className="sheet-grid">
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
            <PeriodHead key={period.no} period={period} />
          ))}
          <th
            scope="col"
            className="grid-head-lunch"
            aria-label={`LUNCH ${formatTimeRange12Hour(LUNCH.start, LUNCH.end)}`}
          />
          {AFTER_LUNCH.map((period) => (
            <PeriodHead key={period.no} period={period} />
          ))}
        </tr>
      </thead>

      <tbody>
        {grid.days.map((day, dayIndex) =>
          day.rows.map((row, laneIndex) => (
            <tr key={`${day.day}-${laneIndex}`} className={laneIndex === 0 ? 'grid-day-start' : undefined}>
              {laneIndex === 0 && (
                <th scope="row" rowSpan={day.laneCount} className="grid-day-name">
                  {day.label}
                </th>
              )}
              {rowCells(
                row,
                day.day,
                laneIndex,
                dayIndex === 0 && laneIndex === 0,
                grid.totalLaneRows,
                focused,
                focusedSlotId,
                onActivate,
                onAddActivity,
                onCellContext,
                linesFor,
                freeSet,
                availabilityOverlay,
                requestCells
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
