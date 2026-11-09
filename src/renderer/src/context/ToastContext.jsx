import { createContext, useCallback, useContext, useRef, useState } from 'react'
import Toast from '../components/Toast'

const ToastContext = createContext(null)

/** One toast stack for the whole app, rendered with the existing Toast style. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)

  const dismiss = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback((tone, title, messages = [], timeout = 6000) => {
    const id = nextId.current
    nextId.current += 1
    setToasts((previous) => [...previous.slice(-2), { id, tone, title, messages, timeout }])
    return id
  }, [])

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack" aria-label="Notifications">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              tone={toast.tone}
              title={toast.title}
              messages={toast.messages}
              timeout={toast.timeout}
              onClose={() => dismiss(toast.id)}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
