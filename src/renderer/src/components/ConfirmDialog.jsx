import Modal from './Modal'

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  busy = false,
  error = ''
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <span className="dialog-summary" />
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-text">{message}</p>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
