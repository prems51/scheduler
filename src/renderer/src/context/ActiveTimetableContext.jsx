import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'timetable-manager:active-timetable-id'

const ActiveTimetableContext = createContext(null)

export function ActiveTimetableProvider({ children }) {
  const [timetables, setTimetables] = useState([])
  const [activeId, setActiveId] = useState(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    const parsed = Number(stored)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshTimetables = useCallback(async () => {
    try {
      const response = await window.api.timetables.list()
      if (!response.ok) {
        setError(response.error)
        return response
      }
      setError('')
      setTimetables(response.data)
      setActiveId((previous) => {
        if (response.data.some((timetable) => timetable.id === previous)) return previous
        return response.data[0]?.id ?? null
      })
      return response
    } catch (error) {
      setError(error.message)
      return { ok: false, error: error.message }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshTimetables()
  }, [refreshTimetables])

  useEffect(() => {
    if (activeId) window.localStorage.setItem(STORAGE_KEY, String(activeId))
    else window.localStorage.removeItem(STORAGE_KEY)
  }, [activeId])

  const activeTimetable = timetables.find((timetable) => timetable.id === activeId) || null

  const value = {
    timetables,
    activeTimetable,
    activeId,
    setActiveId,
    refreshTimetables,
    loading,
    error
  }

  return <ActiveTimetableContext.Provider value={value}>{children}</ActiveTimetableContext.Provider>
}

export function useActiveTimetable() {
  const context = useContext(ActiveTimetableContext)
  if (!context) {
    throw new Error('useActiveTimetable must be used inside ActiveTimetableProvider')
  }
  return context
}
