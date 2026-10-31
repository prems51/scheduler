import { useEffect, useRef } from 'react'

export default function Toast({ tone = 'info', title, messages = [], onClose, timeout = 6000 }) {
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!timeout) return
    const timer = setTimeout(() => closeRef.current?.(), timeout)
    return () => clearTimeout(timer)
  }, [timeout])

  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <div className="toast-header">
        <strong>{title}</strong>
        <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      </div>
      {messages.length > 0 && (
        <ul className="toast-messages">
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
