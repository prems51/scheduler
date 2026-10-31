import { useState } from 'react'
import Modal from '../../components/Modal'
import SectionPicker from '../../components/SectionPicker'

export default function CopyAllocationsDialog({
  sections,
  targetSection,
  existingSubjectIds,
  onClose,
  onCopied
}) {
  const [sourceId, setSourceId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const candidates = sections.filter((section) => section.id !== targetSection.id)

  async function copy() {
    if (!sourceId) {
      setError('Choose a section to copy from.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await window.api.allocations.list(sourceId)
      if (!response.ok) {
        setError(response.error)
        return
      }

      const existing = new Set(existingSubjectIds)
      const toCopy = response.data.filter((allocation) => !existing.has(allocation.subject_id))
      let copied = 0
      const failures = []

      for (const allocation of toCopy) {
        const saved = await window.api.allocations.save(
          targetSection.id,
          allocation.subject_id,
          allocation.teacher_ids
        )
        if (saved.ok) copied += 1
        else failures.push(saved.error)
      }

      setResult({
        copied,
        skipped: response.data.length - toCopy.length,
        failures
      })
      await onCopied()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Copy allocations into Sem ${targetSection.semester} - ${targetSection.name}`}
      onClose={onClose}
      footer={
        result ? (
          <>
            <span className="dialog-summary" />
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <span className="dialog-summary" />
            <button type="button" className="button button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button" onClick={copy} disabled={busy || candidates.length === 0}>
              {busy ? 'Copying…' : 'Copy allocations'}
            </button>
          </>
        )
      }
    >
      <p className="dialog-hint">
        Subjects already allocated in this section are skipped; their teachers stay as they are.
      </p>

      {candidates.length === 0 ? (
        <p className="muted">This is the only section in the active timetable.</p>
      ) : (
        <label className="form-field">
          <span>Copy from</span>
          <SectionPicker
            sections={candidates}
            value={sourceId}
            onChange={setSourceId}
            disabled={Boolean(result)}
            ariaLabel="Section to copy allocations from"
            placeholder="Choose a section"
          />
        </label>
      )}

      {result && (
        <p className="dialog-result">
          Copied {result.copied} allocation(s)
          {result.skipped > 0 ? `, skipped ${result.skipped} already present` : ''}.
          {result.failures.length > 0 && ` ${result.failures.length} could not be copied: ${result.failures[0]}`}
        </p>
      )}

      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
