import { useState } from 'react'
import Modal from '../../components/Modal'

export default function DuplicateTimetableDialog({ timetable, onClose, onDuplicated }) {
  const [title, setTitle] = useState(`${timetable.title} (copy)`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function duplicate() {
    if (!title.trim()) {
      setError('Enter a title for the new timetable.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await window.api.timetables.duplicate(timetable.id, title.trim())
      if (!response.ok) {
        setError(response.error)
        return
      }
      onDuplicated(response.data)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Duplicate timetable"
      onClose={onClose}
      footer={
        <>
          <span className="dialog-summary" />
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={duplicate} disabled={busy}>
            {busy ? 'Copying…' : 'Create copy'}
          </button>
        </>
      }
    >
      <p className="dialog-text">
        This creates a new timetable from <strong>{timetable.title}</strong>. It copies the sections,
        subject allocations, classes, merged lectures and availability requests. Teachers, subjects
        and venues are shared, not copied.
      </p>
      <label className="form-field form-field-wide">
        <span>New term title</span>
        <input
          type="text"
          className="input"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setError('')
          }}
          placeholder="Students Timetable 2026-27 (Even Semester)"
          autoFocus
        />
      </label>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
