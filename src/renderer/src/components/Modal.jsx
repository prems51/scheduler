import { useEffect, useRef } from 'react'

export default function Modal({ title, children, footer, onClose, wide = false }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    const focusable = dialogRef.current?.querySelector('input, select, textarea')
    if (focusable) focusable.focus()
  }, [])

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={wide ? 'dialog dialog-wide' : 'dialog'} ref={dialogRef}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-actions">{footer}</div>}
      </div>
    </div>
  )
}
