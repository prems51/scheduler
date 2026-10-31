import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Searchable single-select.
 * options: [{ value, label, secondary? }]
 */
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'Type to search…',
  ariaLabel,
  autoFocus = false
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const selected = options.find((option) => option.value === value) || null

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) =>
      `${option.label} ${option.secondary || ''}`.toLowerCase().includes(needle)
    )
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const handleClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  function choose(option) {
    onChange(option.value)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((previous) => Math.min(previous + 1, Math.max(filtered.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((previous) => Math.max(previous - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      if (open && filtered[highlight]) {
        event.preventDefault()
        choose(filtered[highlight])
      }
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        setOpen(false)
        event.stopPropagation()
      }
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="search-select" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={open ? query : selected?.label || ''}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />

      {open && (
        <ul className="search-select-list" role="listbox">
          {filtered.length === 0 && <li className="search-select-empty">No matches</li>}
          {filtered.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={
                  index === highlight ? 'search-select-option is-highlighted' : 'search-select-option'
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setHighlight(index)}
              >
                <span className="search-select-label">{option.label}</span>
                {option.secondary && (
                  <span className="search-select-secondary">{option.secondary}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
