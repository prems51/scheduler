import { useEffect, useState } from 'react'
import { useActiveTimetable } from '../context/ActiveTimetableContext'
import SectionPicker from '../components/SectionPicker'
import {
  describeExportError,
  describeExportSuccess
} from '../lib/exportResult'

const KIND_CHOICES = [
  {
    value: 'sections',
    kind: 'section',
    label: 'Sections',
    hint: 'One sheet per section, laid out like the department handout'
  },
  {
    value: 'faculty',
    kind: 'faculty',
    label: 'Faculty timetables',
    hint: 'One sheet per teacher, the generated faculty view'
  },
  {
    value: 'venues',
    kind: 'venue',
    label: 'Venue timetables',
    hint: 'One sheet per venue, the generated venue view'
  }
]

const FORMAT_LABELS = { excel: 'Excel', pdf: 'PDF', both: 'Excel + PDF' }

const nounFor = (what) => (what === 'sections' ? 'section' : what === 'faculty' ? 'teacher' : 'venue')

/** Small radiogroup shared by the three choices on the card. */
function RadioRow({ title, children }) {
  return (
    <div className="export-choice">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export default function Export() {
  const { activeTimetable, activeId } = useActiveTimetable()

  const [what, setWhat] = useState('sections')
  const [which, setWhich] = useState('all')
  const [mode, setMode] = useState('files') // files | combined
  const [format, setFormat] = useState('excel') // excel | pdf | both
  const [selectedId, setSelectedId] = useState(null)
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const choice = KIND_CHOICES.find((item) => item.value === what)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setEntries([])
    setSelectedId(null)
    setResult(null)
    setProgress(null)
    if (!activeId) return undefined

    async function load() {
      const response =
        what === 'sections'
          ? await window.api.sections.list(activeId)
          : await window.api.views.summary(activeId)
      if (cancelled) return
      if (!response.ok) {
        setError(response.error)
        return
      }
      setError('')
      const list = what === 'sections' ? response.data : response.data[choice.kind === 'faculty' ? 'teachers' : 'venues']
      setEntries(list)
      setSelectedId(list[0]?.id ?? null)
      setLoaded(true)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [what, activeId, choice.kind])

  function entryLabel(entry) {
    if (!entry) return '—'
    if (what === 'sections') {
      return `Sem ${entry.semester} - ${entry.name}`
    }
    if (what === 'faculty') {
      return `${entry.code} · ${entry.name || 'Unknown'} (${entry.periods} P/week)`
    }
    return `${entry.code}${entry.name ? ` · ${entry.name}` : ''} (${entry.periods} P/week)`
  }

  async function runAll() {
    const folderResponse = await window.api.exportData.chooseFolder()
    if (!folderResponse.ok) throw new Error(folderResponse.error)
    if (folderResponse.data.canceled) return null
    const dir = folderResponse.data.folder

    if (mode === 'combined') {
      const response = await window.api.exportData.combined(activeId, choice.kind, dir, format)
      if (!response.ok) throw new Error(response.error)
      if (response.data.failed) throw new Error(response.data.reason)
      return describeExportSuccess(
        {
          dir,
          files: response.data.files ?? [response.data.file],
          skipped: response.data.skipped ?? [],
          small: response.data.small ?? [],
          warnings: response.data.warnings ?? [],
          count: response.data.count
        },
        'combined',
        format
      )
    }

    const writable = entries.filter((entry) => (what === 'sections' ? true : entry.periods > 0))
    const files = []
    const skipped = []
    const small = []
    const warnings = []
    setProgress({ done: 0, total: writable.length })

    for (const [index, entry] of writable.entries()) {
      const response = await window.api.exportData.one(activeId, choice.kind, entry.id, dir, format)
      if (!response.ok) {
        const failure = new Error(
          describeExportError(response.error, { failedEntry: entryLabel(entry), writtenFiles: files })
        )
        failure.readable = failure.message
        throw failure
      }
      if (response.data.skipped) skipped.push(`${entryLabel(entry)} — ${response.data.reason}`)
      else files.push(...(response.data.files ?? [response.data.file]))
      if (response.data.small?.length) small.push(...response.data.small)
      if (response.data.warnings?.length) warnings.push(...response.data.warnings)
      setProgress({ done: index + 1, total: writable.length })
    }

    if (files.length === 0) {
      throw new Error('Nothing to export — every entry is empty.')
    }
    return describeExportSuccess({ dir, files, skipped, small, warnings }, 'files', format)
  }

  async function runOne() {
    const response = await window.api.exportData.single(choice.kind, activeId, selectedId, format)
    if (!response.ok) throw new Error(response.error)
    if (response.data.canceled) return null
    const filePath = response.data.filePath ?? ''
    return describeExportSuccess(
      {
        dir: filePath.replace(/[\\/][^\\/]+$/, ''),
        files: response.data.files ?? [response.data.file || filePath],
        small: response.data.small ?? [],
        warnings: response.data.warnings ?? []
      },
      'files',
      format
    )
  }

  async function run() {
    if (running) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const outcome = which === 'all' ? await runAll() : await runOne()
      if (outcome) setResult(outcome)
    } catch (caught) {
      setError(caught.readable ?? caught.message)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  async function openFolder() {
    if (!result?.dir) return
    const response = await window.api.exportData.openFolder(result.dir)
    if (response && response.ok === false) setError(response.error)
  }

  if (!activeTimetable) {
    return (
      <div>
        <h1>Export</h1>
        <div className="empty-state">
          <p>No timetable yet. Create one in Timetable Setup first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="export-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Timetable export</p>
          <h1>Export</h1>
        </div>

        <div className="export-summary" aria-live="polite">
          <span className="summary-label">Current choice</span>
          <strong>{choice.label}</strong>
          <span>
            {which === 'all'
              ? mode === 'combined'
                ? `One combined ${format === 'pdf' ? 'PDF' : format === 'both' ? 'workbook + PDF' : 'workbook'}`
                : 'All entries in a folder'
              : 'One file only'}
          </span>
        </div>
      </header>

      {error && (
        <p className="form-error export-error" role="alert" style={{ whiteSpace: 'pre-line' }}>
          {error}
        </p>
      )}

      <section className="export-card" aria-label="Timetable export">
        <header className="export-card-head">
          <div>
            <h2>
              {format === 'pdf'
                ? 'PDF document'
                : format === 'both'
                  ? 'Excel + PDF export'
                  : 'Excel workbook (.xlsx)'}
            </h2>
            <p className="muted small">{activeTimetable.title}</p>
          </div>
          <span className="export-badge">{FORMAT_LABELS[format]}</span>
        </header>

        <RadioRow title="What">
          {KIND_CHOICES.map((item) => (
            <label key={item.value} className="editor-radio">
              <input
                type="radio"
                name="export-what"
                value={item.value}
                checked={what === item.value}
                disabled={running}
                onChange={() => setWhat(item.value)}
              />
              <span>
                {item.label}
                <span className="muted small"> — {item.hint}</span>
              </span>
            </label>
          ))}
        </RadioRow>

        <RadioRow title="Which">
          <label className="editor-radio">
            <input
              type="radio"
              name="export-which"
              value="all"
              checked={which === 'all'}
              disabled={running}
              onChange={() => setWhich('all')}
            />
            <span>
              All — one file per entry in a folder you pick
              {which === 'all' && (
                <span className="muted small">
                  {' '}
                  (
                  {mode === 'combined'
                    ? 'or a single combined file, one sheet / page each'
                    : 'written one by one, with progress'}
                  )
                </span>
              )}
            </span>
          </label>
          <label className="editor-radio">
            <input
              type="radio"
              name="export-which"
              value="pick"
              checked={which === 'pick'}
              disabled={running}
              onChange={() => setWhich('pick')}
            />
            <span>Just one — with a Save as dialog</span>
          </label>

          {which === 'all' && (
            <div className="export-subchoice">
              <label className="editor-radio">
                <input
                  type="radio"
                  name="export-mode"
                  value="files"
                  checked={mode === 'files'}
                  disabled={running}
                  onChange={() => setMode('files')}
                />
                <span>
                  One {format === 'both' ? '.xlsx + .pdf pair' : format === 'pdf' ? 'PDF' : 'file'} per{' '}
                  {nounFor(what)}
                </span>
              </label>
              <label className="editor-radio">
                <input
                  type="radio"
                  name="export-mode"
                  value="combined"
                  checked={mode === 'combined'}
                  disabled={running}
                  onChange={() => setMode('combined')}
                />
                <span>
                  {format === 'pdf'
                    ? 'Single combined PDF (one page per entry)'
                    : format === 'both'
                      ? 'Single combined workbook + PDF (one sheet / page per entry)'
                      : 'Single combined workbook (one sheet per entry)'}
                </span>
              </label>
            </div>
          )}

          {which === 'pick' && (
            <div className="export-subchoice">
              {what === 'sections' ? (
                // Sections are grouped by semester, exactly as in Timetable Setup.
                <SectionPicker
                  sections={entries}
                  value={selectedId}
                  onChange={setSelectedId}
                  disabled={running || !loaded}
                  ariaLabel="Choose a section"
                />
              ) : (
                <select
                  className="input"
                  value={selectedId ?? ''}
                  disabled={running || !loaded}
                  onChange={(event) => setSelectedId(Number(event.target.value))}
                  aria-label={`Choose a ${what === 'faculty' ? 'teacher' : 'venue'}`}
                >
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entryLabel(entry)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </RadioRow>

        <RadioRow title="Format">
          {[
            { value: 'excel', label: 'Excel (.xlsx) — landscape A4, one page wide' },
            { value: 'pdf', label: 'PDF — one landscape A4 page per timetable' },
            { value: 'both', label: 'Both — the workbook and its PDF twin' }
          ].map((item) => (
            <label key={item.value} className="editor-radio">
              <input
                type="radio"
                name="export-format"
                value={item.value}
                checked={format === item.value}
                disabled={running}
                onChange={() => setFormat(item.value)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </RadioRow>

        <div className="export-runrow">
          <button type="button" className="button button-primary" onClick={run} disabled={running}>
            {running ? 'Exporting…' : 'Run'}
          </button>
          {progress && (
            <span className="muted small" role="status">
              {progress.done}/{progress.total} entries…
            </span>
          )}
        </div>
      </section>

      {result && (
        <section className="export-result" aria-label="Export result">
          <strong>{result.title}</strong>
          <ul>
            {result.messages.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
          <button type="button" className="button button-secondary" onClick={openFolder}>
            Open folder
          </button>
        </section>
      )}

      <p className="muted small export-hint">
        Layout and merges are built by the same engine that draws the on-screen grids, so both
        formats mirror the department handout: two lane rows per day, labs spanning periods, lunch
        merged down the sheet. The PDF is one landscape page per timetable, legend and signatures
        included.
      </p>
    </div>
  )
}
