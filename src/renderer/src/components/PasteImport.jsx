import { useState } from 'react'

function parseRows(text, columns, existingCodes) {
  const existing = new Set(existingCodes.map((code) => String(code).trim().toLowerCase()))
  const seen = new Map()
  const parsed = []

  String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      if (!line.trim()) return

      const cells = line.split('\t')
      const values = {}
      columns.forEach((col, columnIndex) => {
        const raw = (cells[columnIndex] ?? '').trim()
        values[col.key] = col.normalize ? col.normalize(raw) : raw
      })

      if (columns.some((col) => col.key === 'kind')) {
        values.kind = (values.kind || 'classroom').toLowerCase()
      }

      const errors = []
      for (const col of columns) {
        if (col.required && !values[col.key]) errors.push(`${col.label} is required`)
        if (
          col.options &&
          values[col.key] &&
          !col.options.some((option) => option.value === values[col.key])
        ) {
          errors.push(
            `${col.label} must be ${col.options.map((option) => option.value).join(' or ')}`
          )
        }
      }

      const key = String(values.code || '').trim().toLowerCase()
      if (key) {
        if (existing.has(key)) {
          errors.push('Code already exists')
        } else if (seen.has(key)) {
          errors.push(`Duplicate of line ${seen.get(key)}`)
        } else {
          seen.set(key, index + 1)
        }
      }

      parsed.push({ line: index + 1, values, errors })
    })

  return parsed
}

export default function PasteImport({ title, columns, existingCodes, onImport, onClose }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState([])
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)

  const handleTextChange = (value) => {
    setText(value)
    setRows(parseRows(value, columns, existingCodes))
    setResults(null)
  }

  const validRows = rows.filter((row) => row.errors.length === 0)

  async function runImport() {
    if (!validRows.length || busy) return
    setBusy(true)
    try {
      const responses = await onImport(validRows.map((row) => row.values))
      const byLine = {}
      validRows.forEach((row, index) => {
        byLine[row.line] = responses[index] || { ok: false, error: 'No response from the app.' }
      })
      setResults({
        imported: responses.filter((response) => response.ok).length,
        total: validRows.length,
        byLine
      })
    } catch (error) {
      setResults({
        imported: 0,
        total: validRows.length,
        byLine: Object.fromEntries(
          validRows.map((row) => [row.line, { ok: false, error: error.message }])
        )
      })
    } finally {
      setBusy(false)
    }
  }

  function statusFor(row) {
    if (row.errors.length > 0) return { kind: 'error', text: row.errors.join('; ') }
    const result = results?.byLine[row.line]
    if (result) {
      return result.ok
        ? { kind: 'ok', text: 'Imported' }
        : { kind: 'error', text: result.error }
    }
    return { kind: 'ready', text: 'Ready' }
  }

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="dialog-hint">
          Copy rows from Excel and paste them below: {columns.map((col) => col.label).join(', ')},
          one row per line, columns separated by tabs.
        </p>

        <textarea
          className="paste-textarea"
          value={text}
          onChange={(event) => handleTextChange(event.target.value)}
          placeholder={columns.map((col) => col.label).join('    ')}
          rows={7}
          spellCheck={false}
          autoFocus
          disabled={busy || Boolean(results)}
        />

        {rows.length > 0 && (
          <div className="paste-preview">
            <table className="paste-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  {columns.map((col) => (
                    <th key={col.key} scope="col">
                      {col.label}
                    </th>
                  ))}
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = statusFor(row)
                  return (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      {columns.map((col) => (
                        <td key={col.key}>{row.values[col.key] || '—'}</td>
                      ))}
                      <td className={`paste-status paste-status-${status.kind}`}>{status.text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="dialog-actions">
          <span className="dialog-summary">
            {results
              ? `Imported ${results.imported} of ${results.total} row(s).`
              : `${validRows.length} of ${rows.length} row(s) ready to import.`}
          </span>
          <button type="button" className="button button-secondary" onClick={onClose}>
            {results ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="button"
            onClick={runImport}
            disabled={busy || Boolean(results) || validRows.length === 0}
          >
            {busy ? 'Importing…' : `Import ${validRows.length} row(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
