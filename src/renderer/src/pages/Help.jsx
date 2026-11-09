import { Link } from 'react-router-dom'

const STEPS = [
  {
    title: 'Master Data',
    to: '/master-data',
    body: 'Type in the teachers, subjects and rooms once. Every later screen picks them from these lists.'
  },
  {
    title: 'Timetable Setup',
    to: '/timetable-setup',
    body: 'Create a timetable for the term, add its sections, and say which subjects and teachers each section has.'
  },
  {
    title: 'Master Timetable',
    to: '/master-timetable',
    body: 'Place classes in the grid. If a teacher, room or section has a cannot/prefer-not time, record it on the Constraints page first.'
  },
  {
    title: 'Faculty and venue views',
    to: '/faculty-timetables',
    body: 'Review the generated faculty and venue timetables before sharing anything.'
  },
  {
    title: 'Export',
    to: '/export',
    body: 'Write the Excel or PDF files the department needs, for one section or for everyone.'
  }
]

export default function Help() {
  return (
    <div className="help-page">
      <h1>Help</h1>
      <p className="help-intro">
        Five steps take you from an empty app to a printable timetable. You can come back to any step
        at any time; nothing is final until you export it.
      </p>

      <ol className="help-steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className="help-step">
            <span className="help-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="help-step-body">
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              <Link className="button-link" to={step.to}>
                Open {step.title}
              </Link>
            </div>
          </li>
        ))}
      </ol>

      <section className="help-card help-card-optional">
        <h2>Before step 3: timing requests</h2>
        <p>
          Constraints are optional but useful. Open <Link to="/constraints">Constraints</Link> to mark
          the times a teacher, room or section cannot use, or would prefer to avoid. The Master
          Timetable warns you when a class lands on one of those cells.
        </p>
      </section>

      <section className="help-card">
        <h2>If something goes wrong</h2>
        <p>
          Timetable Manager makes an automatic backup when it starts and keeps the last 14 daily
          copies. Use <Link to="/settings">Settings</Link> to save a backup to a pen drive, or to restore
          an earlier copy. Restoring always makes a safety copy of the current timetable first.
        </p>
        <p className="muted small">
          Still stuck? Open Settings and use “Open backups folder”, then send the newest backup file
          and the log from the logs folder to whoever supports the app.
        </p>
      </section>
    </div>
  )
}
