import { useState } from 'react'
import Modal from '../../components/Modal'

export default function TimetableFormDialog({ timetable, onClose, onSaved }) {
  const editing = Boolean(timetable?.id)
  const [form, setForm] = useState({
    title: timetable?.title ?? '',
    effective_from: timetable?.effective_from ?? '',
    coordinator: timetable?.coordinator ?? '',
    convener: timetable?.convener ?? ''
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))

  async function save() {
    if (!form.title.trim()) {
      setError('Timetable title is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        title: form.title.trim(),
        effective_from: form.effective_from || null,
        coordinator: form.coordinator.trim() || null,
        convener: form.convener.trim() || null
      }
      if (editing) payload.id = timetable.id
      const response = await window.api.timetables.save(payload)
      if (!response.ok) {
        setError(response.error)
        return
      }
      onSaved(response.data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Edit timetable' : 'New timetable'}
      onClose={onClose}
      footer={
        <>
          <span className="dialog-summary" />
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create timetable'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>Title</span>
          <input
            type="text"
            className="input"
            value={form.title}
            onChange={update('title')}
            placeholder="Students Timetable 2026-27 (Odd Semester)"
          />
        </label>
        <label className="form-field">
          <span>Effective from</span>
          <input type="date" className="input" value={form.effective_from} onChange={update('effective_from')} />
        </label>
        <label className="form-field">
          <span>Coordinator</span>
          <input
            type="text"
            className="input"
            value={form.coordinator}
            onChange={update('coordinator')}
            placeholder="Ms. Kanchan"
          />
        </label>
        <label className="form-field">
          <span>Convener</span>
          <input
            type="text"
            className="input"
            value={form.convener}
            onChange={update('convener')}
            placeholder="Dr. Lalit Mohan Trivedi"
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
