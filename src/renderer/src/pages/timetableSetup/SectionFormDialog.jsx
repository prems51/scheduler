import { useState } from 'react'
import Modal from '../../components/Modal'

export default function SectionFormDialog({
  section,
  timetableId,
  venues,
  defaultSemester = null,
  onClose,
  onSaved
}) {
  const editing = Boolean(section?.id)
  const [form, setForm] = useState({
    semester: section?.semester ?? defaultSemester ?? 5,
    name: section?.name ?? '',
    class_oc: section?.class_oc ?? '',
    counselors: section?.counselors ?? '',
    default_venue_id: section?.default_venue_id ?? ''
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))

  async function save() {
    if (!String(form.name).trim()) {
      setError('Section name is required (for example B).')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = {
        timetable_id: timetableId,
        semester: Number(form.semester),
        name: String(form.name).trim(),
        class_oc: form.class_oc.trim() || null,
        counselors: form.counselors.trim() || null,
        default_venue_id: form.default_venue_id ? Number(form.default_venue_id) : null
      }
      if (editing) payload.id = section.id
      const response = await window.api.sections.save(payload)
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
      title={editing ? `Edit section Sem ${section.semester} - ${section.name}` : 'Add section'}
      onClose={onClose}
      footer={
        <>
          <span className="dialog-summary" />
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add section'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="form-field form-field-small">
          <span>Semester</span>
          <select className="input" value={form.semester} onChange={update('semester')}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((semester) => (
              <option key={semester} value={semester}>
                {semester}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field form-field-small">
          <span>Section</span>
          <input type="text" className="input" value={form.name} onChange={update('name')} placeholder="B" />
        </label>
        <label className="form-field">
          <span>Class O.C.</span>
          <input
            type="text"
            className="input"
            value={form.class_oc}
            onChange={update('class_oc')}
            placeholder="Ms. Prachi Gupta"
          />
        </label>
        <label className="form-field form-field-wide">
          <span>Counselors (comma separated)</span>
          <input
            type="text"
            className="input"
            value={form.counselors}
            onChange={update('counselors')}
            placeholder="Ms. Deepali Agarwal, Mr. Mohd. Ilyas"
          />
        </label>
        <label className="form-field">
          <span>Default venue</span>
          <select className="input" value={form.default_venue_id} onChange={update('default_venue_id')}>
            <option value="">No default venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.code}
                {venue.name ? ` — ${venue.name}` : ''} ({venue.kind})
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
