const ICONS = {
  teacher: (
    <>
      <circle cx="8" cy="5.2" r="2.5" />
      <path d="M3.2 13.2c0-2.3 2.1-3.8 4.8-3.8s4.8 1.5 4.8 3.8" />
    </>
  ),
  venue: (
    <>
      <path d="M3.6 13.4V3.4h8.8v10" />
      <path d="M2.2 13.4h11.6" />
      <path d="M6.2 6.4h.01M9.8 6.4h.01M6.2 9.4h.01M9.8 9.4h.01" />
    </>
  ),
  section: (
    <>
      <rect x="2.9" y="2.9" width="4.4" height="4.4" rx="0.7" />
      <rect x="8.7" y="2.9" width="4.4" height="4.4" rx="0.7" />
      <rect x="2.9" y="8.7" width="4.4" height="4.4" rx="0.7" />
      <rect x="8.7" y="8.7" width="4.4" height="4.4" rx="0.7" />
    </>
  ),
  lunch: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.8v3.3l2.2 1.3" />
    </>
  ),
  range: (
    <>
      <path d="M2.4 8h11.2" />
      <path d="M4.4 3.6 8 8l-3.6 4.4M11.6 3.6 8 8l3.6 4.4" />
    </>
  ),
  constraint: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.8v3.6l2.4 1.4" />
    </>
  )
}

export function ProblemIcon({ type }) {
  const icon = ICONS[type] || ICONS.section
  const tone = ICONS[type] ? type : 'section'
  return (
    <span className={`problem-icon problem-icon-${tone}`} aria-hidden="true">
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
    </span>
  )
}

export default function ProblemList({ problems = [], className = '' }) {
  if (problems.length === 0) return null

  return (
    <ul className={`problem-list ${className}`.trim()}>
      {problems.map((problem, index) => (
        <li
          key={`${problem.type}-${index}`}
          className={`problem-item${
            problem.level === 'warning'
              ? ' problem-item-warning'
              : problem.level === 'error'
                ? ' problem-item-error'
                : ''
          }`}
        >
          <ProblemIcon type={problem.type} />
          <span className="problem-message">{problem.message}</span>
        </li>
      ))}
    </ul>
  )
}
