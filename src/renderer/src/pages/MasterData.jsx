import { useEffect, useMemo, useState } from 'react'
import EditableTable from '../components/EditableTable'
import PasteImport from '../components/PasteImport'
import { normalizeSubjectCode } from '../lib/normalize'

const TABS = [
  {
    key: 'teachers',
    label: 'Teachers',
    singular: 'teacher',
    columns: [
      { key: 'code', label: 'Code', required: true, width: '18%' },
      { key: 'name', label: 'Name', required: true }
    ]
  },
  {
    key: 'subjects',
    label: 'Subjects',
    singular: 'subject',
    columns: [
      { key: 'code', label: 'Code', required: true, normalize: normalizeSubjectCode, width: '18%' },
      { key: 'name', label: 'Name', required: true }
    ]
  },
  {
    key: 'venues',
    label: 'Venues',
    singular: 'venue',
    columns: [
      { key: 'code', label: 'Code', required: true, width: '16%' },
      { key: 'name', label: 'Name' },
      {
        key: 'kind',
        label: 'Type',
        type: 'select',
        options: [
          { value: 'classroom', label: 'Classroom' },
          { value: 'lab', label: 'Lab' }
        ],
        width: '170px'
      }
    ],
    newRowDefaults: { kind: 'classroom' }
  }
]

export default function MasterData() {
  const [activeTab, setActiveTab] = useState('teachers')
  const [data, setData] = useState({ teachers: [], subjects: [], venues: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)

  const active = TABS.find((tab) => tab.key === activeTab)

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      try {
        const [teachers, subjects, venues] = await Promise.all([
          window.api.teachers.list(),
          window.api.subjects.list(),
          window.api.venues.list()
        ])
        if (cancelled) return
        const failed = [teachers, subjects, venues].find((response) => !response.ok)
        if (failed) setLoadError(failed.error)
        setData({
          teachers: teachers.ok ? teachers.data : [],
          subjects: subjects.ok ? subjects.data : [],
          venues: venues.ok ? venues.data : []
        })
      } catch (error) {
        if (!cancelled) setLoadError(error.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAll()
    return () => {
      cancelled = true
    }
  }, [])

  async function reload(tabKey) {
    const response = await window.api[tabKey].list()
    if (response.ok) {
      setData((previous) => ({ ...previous, [tabKey]: response.data }))
    } else {
      setLoadError(response.error)
    }
    return response
  }

  async function handleSave(tabKey, values) {
    const response = await window.api[tabKey].save(values)
    if (response.ok) await reload(tabKey)
    return response
  }

  async function handleDelete(tabKey, row) {
    const response = await window.api[tabKey].delete(row.id)
    if (response.ok) await reload(tabKey)
    return response
  }

  async function handleImport(tabKey, valuesList) {
    const results = []
    for (const values of valuesList) {
      const response = await window.api[tabKey].save(values)
      results.push(response.ok ? { ok: true } : { ok: false, error: response.error })
    }
    await reload(tabKey)
    return results
  }

  function validateCode(tabKey, values, row) {
    const code = String(values.code || '').trim().toLowerCase()
    if (!code) return ''
    const duplicate = data[tabKey].find(
      (entry) => entry.id !== row.id && String(entry.code).trim().toLowerCase() === code
    )
    return duplicate ? `Code "${values.code}" already exists.` : ''
  }

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = data[activeTab]
    if (!needle) return rows
    return rows.filter((row) =>
      [row.code, row.name, row.kind].some((value) =>
        String(value ?? '').toLowerCase().includes(needle)
      )
    )
  }, [data, activeTab, query])

  const searching = query.trim().length > 0

  return (
    <div>
      <h1>Master Data</h1>

      <div className="tabs" role="tablist" aria-label="Master data">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? 'tab tab-active' : 'tab'}
            onClick={() => {
              setActiveTab(tab.key)
              setQuery('')
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${active.label.toLowerCase()} by code, name or type`}
          aria-label={`Search ${active.label.toLowerCase()}`}
        />
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setPasteOpen(true)}
        >
          Paste from Excel
        </button>
      </div>

      {loadError && <p className="form-error">{loadError}</p>}

      {!loading && !searching && data[activeTab].length === 0 && (
        <div className="empty-state empty-state-inline">
          <p>
            No {active.singular}s yet. Type in the blank row below to add the first one.
          </p>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <EditableTable
          key={activeTab}
          columns={active.columns}
          rows={filteredRows}
          newRowDefaults={active.newRowDefaults}
          allowCreate={!searching}
          onSave={(values) => handleSave(activeTab, values)}
          onDelete={(row) => handleDelete(activeTab, row)}
          validateRow={(values, row) => validateCode(activeTab, values, row)}
        />
      )}

      {searching && (
        <p className="muted small">
          Clear the search box to add a new {active.singular}.
        </p>
      )}

      {pasteOpen && (
        <PasteImport
          title={`Paste from Excel — ${active.label}`}
          columns={active.columns}
          existingCodes={data[activeTab].map((row) => row.code)}
          onImport={(valuesList) => handleImport(activeTab, valuesList)}
          onClose={() => setPasteOpen(false)}
        />
      )}
    </div>
  )
}
