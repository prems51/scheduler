import { Fragment, useEffect, useRef, useState } from 'react'

const NEW_ROW_KEY = '__new__'

function draftFromRow(row, rowKey, columns, defaults) {
  const draft = {}
  for (const col of columns) {
    draft[col.key] =
      rowKey === NEW_ROW_KEY
        ? (defaults[col.key] ?? '')
        : (row?.[col.key] ?? '')
  }
  return draft
}

function optionLabel(col, value) {
  const option = (col.options || []).find((entry) => entry.value === value)
  return option ? option.label : value
}

/**
 * Spreadsheet-style table: click a cell, type, Enter saves and moves down,
 * Tab moves right, Esc cancels. The last row is blank and adds on Enter.
 *
 * columns: [{ key, label, required?, type?: 'text'|'select', options?, normalize?, width? }]
 * onSave(values) -> Promise<{ ok, error? }>
 * onDelete(row)  -> Promise<{ ok, error? }>
 * validateRow(values, row) -> string (extra validation, e.g. duplicate code)
 */
export default function EditableTable({
  columns,
  rows,
  onSave,
  onDelete,
  newRowDefaults = {},
  validateRow,
  allowCreate = true
}) {
  const [editingKey, setEditingKey] = useState(null)
  const [activeCol, setActiveCol] = useState(null)
  const [draft, setDraft] = useState({})
  const [rowErrors, setRowErrors] = useState({})
  const [confirmKey, setConfirmKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const [focusRequest, setFocusRequest] = useState({ rowKey: null, colKey: null, nonce: 0 })
  const cellRefs = useRef({})

  const orderedKeys = [...rows.map((row) => String(row.id))]
  if (allowCreate) orderedKeys.push(NEW_ROW_KEY)

  useEffect(() => {
    const { rowKey, colKey, nonce } = focusRequest
    if (!rowKey || nonce === 0) return
    const element = cellRefs.current[`${rowKey}|${colKey}`]
    if (element) {
      element.focus()
      if (typeof element.select === 'function' && element.tagName === 'INPUT') element.select()
    }
  }, [focusRequest])

  const requestFocus = (rowKey, colKey) =>
    setFocusRequest((previous) => ({ rowKey, colKey, nonce: previous.nonce + 1 }))

  const setRowError = (rowKey, message) =>
    setRowErrors((previous) => ({ ...previous, [rowKey]: message }))

  const clearRowError = (rowKey) =>
    setRowErrors((previous) => {
      if (!previous[rowKey]) return previous
      const next = { ...previous }
      delete next[rowKey]
      return next
    })

  const valuesForRow = (row, rowKey) =>
    draftFromRow(row, rowKey, columns, newRowDefaults)

  const normalizeDraft = () => {
    const values = {}
    for (const col of columns) {
      values[col.key] = col.normalize
        ? col.normalize(draft[col.key])
        : String(draft[col.key] ?? '').trim()
    }
    return values
  }

  function validate(values, row) {
    for (const col of columns) {
      if (col.required && !String(values[col.key] ?? '').trim()) {
        return `${col.label} is required.`
      }
    }
    if (validateRow) return validateRow(values, row) || ''
    return ''
  }

  function startEdit(row, rowKey, colKey) {
    if (busy) return
    if (editingKey) {
      // Save the row being left; stay put if it is invalid.
      commitRow('none').then((saved) => {
        if (saved) openRow(row, rowKey, colKey)
      })
      return
    }
    openRow(row, rowKey, colKey)
  }

  function openRow(row, rowKey, colKey) {
    setEditingKey(rowKey)
    setDraft(valuesForRow(row, rowKey))
    setActiveCol(colKey)
    clearRowError(rowKey)
    requestFocus(rowKey, colKey)
  }

  async function commitRow(direction) {
    if (!editingKey || busy) return false
    const rowKey = editingKey
    const row = rowKey === NEW_ROW_KEY ? {} : rows.find((entry) => String(entry.id) === rowKey)
    if (!row) {
      setEditingKey(null)
      setDraft({})
      return true
    }

    const values = normalizeDraft()

    // An untouched blank row is not an error - just leave it.
    if (
      rowKey === NEW_ROW_KEY &&
      columns.every((col) => !String(values[col.key] ?? '').trim())
    ) {
      setEditingKey(null)
      setDraft({})
      return true
    }

    // Nothing changed on an existing row: just leave edit mode.
    if (row.id && columns.every((col) => String(values[col.key]) === String(row[col.key] ?? ''))) {
      setEditingKey(null)
      setDraft({})
      return true
    }

    const problem = validate(values, row)
    if (problem) {
      setRowError(rowKey, problem)
      return false
    }

    const payload = row.id ? { id: row.id, ...values } : values
    setBusy(true)
    let response
    try {
      response = await onSave(payload)
    } catch (error) {
      response = { ok: false, error: error.message }
    } finally {
      setBusy(false)
    }

    if (!response || response.ok !== true) {
      setRowError(rowKey, response?.error || 'Could not save this row.')
      return false
    }

    clearRowError(rowKey)
    moveAfterSave(rowKey, row, direction)
    return true
  }

  function moveAfterSave(rowKey, row, direction) {
    if (direction === 'none') {
      setEditingKey(null)
      setDraft({})
      return
    }

    const orderedIndex = orderedKeys.indexOf(rowKey)
    let targetKey = orderedKeys[orderedIndex + 1] ?? null
    let targetCol = direction === 'down' ? activeCol : columns[0]?.key

    // Adding a record leaves a fresh blank row ready to type into.
    if (rowKey === NEW_ROW_KEY && allowCreate) {
      targetKey = NEW_ROW_KEY
      targetCol = columns[0]?.key
    }

    if (!targetKey) {
      setEditingKey(null)
      setDraft({})
      return
    }

    const targetRow =
      targetKey === NEW_ROW_KEY
        ? {}
        : rows.find((entry) => String(entry.id) === targetKey) || {}

    setEditingKey(targetKey)
    setDraft(draftFromRow(targetRow, targetKey, columns, newRowDefaults))
    setActiveCol(targetCol)
    requestFocus(targetKey, targetCol)
  }

  function cancelEdit() {
    if (!editingKey) return
    clearRowError(editingKey)
    setEditingKey(null)
    setDraft({})
    setActiveCol(null)
  }

  function handleKeyDown(event, rowKey, colKey, colIndex) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitRow('down')
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (colIndex < columns.length - 1) {
        const nextCol = columns[colIndex + 1].key
        setActiveCol(nextCol)
        requestFocus(rowKey, nextCol)
      } else {
        commitRow('right')
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }
  }

  async function removeRow(row, rowKey) {
    setBusy(true)
    let response
    try {
      response = await onDelete(row)
    } catch (error) {
      response = { ok: false, error: error.message }
    } finally {
      setBusy(false)
    }

    setConfirmKey(null)
    if (!response || response.ok !== true) {
      setRowError(rowKey, response?.error || 'Could not delete this record.')
      return
    }
    clearRowError(rowKey)
    if (editingKey === rowKey) cancelEdit()
  }

  function renderCell(row, rowKey, col, colIndex) {
    const isEditingRow = editingKey === rowKey
    const value = isEditingRow ? (draft[col.key] ?? '') : (row[col.key] ?? '')

    if (isEditingRow) {
      const common = {
        ref: (element) => {
          cellRefs.current[`${rowKey}|${col.key}`] = element
        },
        value,
        className: activeCol === col.key ? 'cell-input cell-input-active' : 'cell-input',
        onFocus: () => setActiveCol(col.key),
        onKeyDown: (event) => handleKeyDown(event, rowKey, col.key, colIndex)
      }

      if (col.type === 'select') {
        return (
          <select
            {...common}
            onChange={(event) => setDraft((previous) => ({ ...previous, [col.key]: event.target.value }))}
          >
            {(col.options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )
      }

      return (
        <input
          {...common}
          type="text"
          spellCheck={false}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, [col.key]: event.target.value }))
          }
        />
      )
    }

    const display = col.type === 'select' ? optionLabel(col, value) : value

    return (
      <button
        type="button"
        className="cell-button"
        onClick={() => startEdit(row, rowKey, col.key)}
        title="Click to edit"
      >
        {display || (rowKey === NEW_ROW_KEY ? null : <span className="cell-empty">—</span>)}
      </button>
    )
  }

  return (
    <table className="data-table">
      <colgroup>
        {columns.map((col) => (
          <col key={col.key} style={col.width ? { width: col.width } : undefined} />
        ))}
        <col style={{ width: '120px' }} />
      </colgroup>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} scope="col">
              {col.label}
            </th>
          ))}
          <th scope="col" className="table-actions">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && !allowCreate && (
          <tr>
            <td colSpan={columns.length + 1} className="table-empty">
              No records.
            </td>
          </tr>
        )}

        {rows.map((row) => {
          const rowKey = String(row.id)
          const hasError = Boolean(rowErrors[rowKey])
          return (
            <Fragment key={rowKey}>
              <tr
                className={editingKey === rowKey ? 'row-editing' : hasError ? 'row-invalid' : undefined}
              >
                {columns.map((col, index) => (
                  <td key={col.key}>{renderCell(row, rowKey, col, index)}</td>
                ))}
                <td className="table-actions">
                  {confirmKey === rowKey ? (
                    <span className="confirm-inline">
                      <span className="confirm-text">Delete?</span>
                      <button
                        type="button"
                        className="table-action table-action-danger"
                        onClick={() => removeRow(row, rowKey)}
                        disabled={busy}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="table-action"
                        onClick={() => setConfirmKey(null)}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="table-action"
                      onClick={() => {
                        setConfirmKey(rowKey)
                        clearRowError(rowKey)
                      }}
                      aria-label={`Delete ${row.code || 'record'}`}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
              {hasError && (
                <tr className="table-error-row">
                  <td colSpan={columns.length + 1}>{rowErrors[rowKey]}</td>
                </tr>
              )}
            </Fragment>
          )
        })}

        {allowCreate && (
          <Fragment>
            <tr className={editingKey === NEW_ROW_KEY ? 'row-editing row-new' : 'row-new'}>
              {columns.map((col, index) => (
                <td key={col.key}>{renderCell({}, NEW_ROW_KEY, col, index)}</td>
              ))}
              <td className="table-actions">
                <span className="row-new-hint">New row</span>
              </td>
            </tr>
            {rowErrors[NEW_ROW_KEY] && (
              <tr className="table-error-row">
                <td colSpan={columns.length + 1}>{rowErrors[NEW_ROW_KEY]}</td>
              </tr>
            )}
          </Fragment>
        )}
      </tbody>
    </table>
  )
}
