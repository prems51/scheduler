import { useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import SearchSelect from '../../components/SearchSelect'

export default function AllocationDialog({
  section,
  allocation,
  subjects,
  teachers,
  existingSubjectIds,
  onClose,
  onSaved
}) {
  const editing = Boolean(allocation?.id)
  const [subjectId, setSubjectId] = useState(allocation?.subject_id ?? null)
  const [teacherIds, setTeacherIds] = useState(allocation?.teacher_ids ?? [])
  const [teacherFilter, setTeacherFilter] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const subjectOptions = useMemo(
    () => subjects.map((subject) => ({ value: subject.id, label: `${subject.code} — ${subject.name}` })),
    [subjects]
  )

  const teachersById = useMemo(
    () => Object.fromEntries(teachers.map((teacher) => [teacher.id, teacher])),
    [teachers]
  )

  const visibleTeachers = useMemo(() => {
    const needle = teacherFilter.trim().toLowerCase()
    if (!needle) return teachers
    return teachers.filter((teacher) =>
      `${teacher.code} ${teacher.name}`.toLowerCase().includes(needle)
    )
  }, [teachers, teacherFilter])

  const duplicate =
    subjectId &&
    existingSubjectIds.includes(subjectId) &&
    (!editing || allocation.subject_id !== subjectId)

  function toggleTeacher(teacherId) {
    setTeacherIds((previous) =>
      previous.includes(teacherId)
        ? previous.filter((id) => id !== teacherId)
        : [...previous, teacherId]
    )
  }

  async function save() {
    if (!subjectId) {
      setError('Choose a subject.')
      return
    }
    if (duplicate) {
      setError('This subject is already allocated to this section.')
      return
    }
    if (teacherIds.length === 0) {
      setError('Choose at least one teacher.')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (editing && allocation.subject_id !== subjectId) {
        const removed = await window.api.allocations.delete(allocation.id)
        if (!removed.ok) {
          setError(removed.error)
          return
        }
      }
      const response = await window.api.allocations.save(section.id, subjectId, teacherIds)
      if (!response.ok) {
        setError(response.error)
        return
      }
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${editing ? 'Edit' : 'Add'} subject — Sem ${section.semester} - ${section.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="dialog-summary" />
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add allocation'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field form-field-wide">
          <span>Subject</span>
          <SearchSelect
            options={subjectOptions}
            value={subjectId}
            onChange={(value) => {
              setSubjectId(value)
              setError('')
            }}
            placeholder="Search by subject code or name…"
            ariaLabel="Subject"
            autoFocus
          />
          {duplicate && (
            <span className="field-hint field-hint-error">
              This subject is already allocated to this section.
            </span>
          )}
        </div>

        <div className="form-field form-field-wide">
          <span>Teachers</span>
          <div className="chips">
            {teacherIds.length === 0 && <span className="muted small">No teacher selected yet.</span>}
            {teacherIds.map((teacherId) => {
              const teacher = teachersById[teacherId]
              return (
                <span key={teacherId} className="chip" title={teacher?.name}>
                  {teacher?.code ?? teacherId}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => toggleTeacher(teacherId)}
                    aria-label={`Remove ${teacher?.name ?? 'teacher'}`}
                  >
                    ✕
                  </button>
                </span>
              )
            })}
          </div>
          <input
            type="text"
            className="input"
            value={teacherFilter}
            onChange={(event) => setTeacherFilter(event.target.value)}
            placeholder="Search teachers…"
          />
          <div className="teacher-options">
            {visibleTeachers.map((teacher) => {
              const selected = teacherIds.includes(teacher.id)
              return (
                <button
                  key={teacher.id}
                  type="button"
                  className={selected ? 'teacher-option is-selected' : 'teacher-option'}
                  onClick={() => toggleTeacher(teacher.id)}
                  aria-pressed={selected}
                >
                  <span className="teacher-option-code">{teacher.code}</span>
                  <span className="teacher-option-name">{teacher.name}</span>
                </button>
              )
            })}
            {visibleTeachers.length === 0 && <p className="muted small">No teacher matches.</p>}
          </div>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
