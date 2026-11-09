import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ActiveTimetableProvider } from './context/ActiveTimetableContext'
import { ToastProvider } from './context/ToastContext'
import Dashboard from './pages/Dashboard'
import MasterData from './pages/MasterData'
import TimetableSetup from './pages/TimetableSetup'
import MasterTimetable from './pages/MasterTimetable'
import Constraints from './pages/Constraints'
import FacultyTimetables from './pages/FacultyTimetables'
import VenueTimetables from './pages/VenueTimetables'
import Export from './pages/Export'
import Settings from './pages/Settings'
import Help from './pages/Help'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/master-data', label: 'Master Data' },
  { path: '/timetable-setup', label: 'Timetable Setup' },
  { path: '/constraints', label: 'Constraints' },
  { path: '/master-timetable', label: 'Master Timetable' },
  { path: '/faculty-timetables', label: 'Faculty Timetables' },
  { path: '/venue-timetables', label: 'Venue Timetables' },
  { path: '/export', label: 'Export' },
  { path: '/settings', label: 'Settings' },
  { path: '/help', label: 'Help' }
]

function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="sidebar-brand-title">Timetable Manager</span>
        <span className="sidebar-brand-subtitle">CSE Department · MIT Moradabad</span>
      </div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <ActiveTimetableProvider>
          <div className="app-shell">
            <Sidebar />
            <main className="app-content">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/master-data" element={<MasterData />} />
                <Route path="/timetable-setup" element={<TimetableSetup />} />
                <Route path="/constraints" element={<Constraints />} />
                <Route path="/master-timetable" element={<MasterTimetable />} />
                <Route path="/faculty-timetables" element={<FacultyTimetables />} />
                <Route path="/venue-timetables" element={<VenueTimetables />} />
                <Route path="/export" element={<Export />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/help" element={<Help />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </main>
          </div>
        </ActiveTimetableProvider>
      </HashRouter>
    </ToastProvider>
  )
}
