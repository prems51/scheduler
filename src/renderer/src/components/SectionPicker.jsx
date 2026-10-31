import { groupSectionsBySemester } from '../lib/sectionGroups'

/**
 * The one section dropdown of the app: sections grouped under "Semester 5",
 * "Semester 3", … exactly like the setup page. Used by Export and by the
 * "copy allocations" dialog so no screen invents its own order.
 */
export default function SectionPicker({
  sections = [],
  value = null,
  onChange,
  disabled = false,
  ariaLabel = 'Section',
  placeholder = null,
  className = 'input'
}) {
  const groups = groupSectionsBySemester(sections)

  return (
    <select
      className={className}
      value={value ?? ''}
      disabled={disabled || groups.length === 0}
      aria-label={ariaLabel}
      onChange={(event) =>
        onChange(event.target.value === '' ? null : Number(event.target.value))
      }
    >
      {placeholder !== null && <option value="">{placeholder}</option>}
      {groups.map((group) => (
        <optgroup key={group.semester} label={group.label}>
          {group.sections.map((section) => (
            <option key={section.id} value={section.id}>
              Sem {section.semester} - {section.name}
              {section.allocation_count !== undefined ? ` · ${section.allocation_count} subject(s)` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
