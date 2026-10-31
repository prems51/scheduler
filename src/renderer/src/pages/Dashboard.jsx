import { useState } from 'react'

export default function Dashboard() {
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  async function runDbCheck() {
    setBusy(true)
    try {
      setResult(await window.api.teachers.list())
    } catch (error) {
      setResult({ ok: false, error: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Dashboard</h1>

      {/* Temporary phase-2 check: proves preload -> IPC -> SQLite works. */}
      <section className="db-check">
        <button type="button" className="button" onClick={runDbCheck} disabled={busy}>
          {busy ? 'Checking…' : 'DB check (temporary)'}
        </button>
        {result && <pre className="db-check-output">{JSON.stringify(result, null, 2)}</pre>}
      </section>
    </div>
  )
}
