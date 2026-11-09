import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../context/ToastContext'

function fileName(path) {
  return String(path ?? '').split(/[\\/]/).pop() || path
}

export default function Settings() {
  const { notify } = useToast()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState('')

  const loadInfo = useCallback(async () => {
    setLoading(true)
    try {
      const response = await window.api.backups.info()
      if (response.ok) setInfo(response.data)
      else notify('error', 'Could not read backup settings', [response.error])
    } catch (error) {
      notify('error', 'Could not read backup settings', [error.message])
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    loadInfo()
  }, [loadInfo])

  async function backupNow() {
    setBackingUp(true)
    try {
      const response = await window.api.backups.now()
      if (!response.ok) {
        notify('error', 'Backup failed', [response.error])
        return
      }
      if (response.data.canceled) return
      notify('success', 'Backup saved', [response.data.path])
    } catch (error) {
      notify('error', 'Backup failed', [error.message])
    } finally {
      setBackingUp(false)
    }
  }

  async function chooseRestore() {
    setChoosing(true)
    setRestoreError('')
    try {
      const picked = await window.api.backups.pickRestore()
      if (!picked.ok) {
        notify('error', 'Could not choose a backup', [picked.error])
        return
      }
      if (picked.data.canceled) return

      const inspected = await window.api.backups.inspect(picked.data.path)
      if (!inspected.ok) {
        notify('error', 'That file cannot be restored', [inspected.error])
        return
      }
      setRestoreTarget(inspected.data)
    } catch (error) {
      notify('error', 'Could not read that backup', [error.message])
    } finally {
      setChoosing(false)
    }
  }

  async function confirmRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    setRestoreError('')
    try {
      const response = await window.api.backups.restore(restoreTarget.path)
      if (!response.ok) {
        setRestoreError(response.error)
        return
      }
      setRestoreTarget(null)
      notify('info', 'Backup restored', ['The app will restart in a moment.'])
    } catch (error) {
      setRestoreError(error.message)
    } finally {
      setRestoring(false)
    }
  }

  async function openFolder() {
    try {
      const response = await window.api.backups.openFolder()
      if (!response.ok) notify('error', 'Could not open the backups folder', [response.error])
    } catch (error) {
      notify('error', 'Could not open the backups folder', [error.message])
    }
  }

  const restoredCounts = restoreTarget?.counts

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <p className="muted">
        Backups protect the timetable file if a laptop is lost, a file is damaged, or an experiment
        needs to be undone.
      </p>

      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>Backup now</h2>
            <p className="muted small">Save a complete copy wherever you like — a pen drive is a good choice.</p>
          </div>
          <button
            type="button"
            className="button button-small"
            onClick={backupNow}
            disabled={backingUp}
          >
            {backingUp ? 'Saving…' : 'Backup now'}
          </button>
        </div>
        <p className="settings-note">
          A backup is also made automatically when the app starts. The last 14 daily backups are kept
          in the app's Backups folder.
        </p>
        {loading ? (
          <p className="muted small">Loading backup details…</p>
        ) : (
          <div className="settings-backup-info">
            <p>
              <span className="settings-label">Backups folder</span>
              <code>{info?.folder ?? 'Unavailable'}</code>
            </p>
            <p>
              <span className="settings-label">Last automatic backup</span>
              {info?.lastAutomatic ? fileName(info.lastAutomatic) : 'None yet'}
            </p>
            {info?.lastSafety && (
              <p>
                <span className="settings-label">Last pre-restore safety copy</span>
                {fileName(info.lastSafety)}
              </p>
            )}
          </div>
        )}
        <div className="settings-actions">
          <button type="button" className="button button-secondary button-small" onClick={openFolder}>
            Open backups folder
          </button>
        </div>
      </section>

      <section className="settings-card settings-card-danger">
        <div className="settings-card-head">
          <div>
            <h2>Restore a backup</h2>
            <p className="muted small">
              Replace the current timetable with an earlier backup. A safety copy is made first.
            </p>
          </div>
          <button
            type="button"
            className="button button-danger-outline button-small"
            onClick={chooseRestore}
            disabled={choosing || restoring}
          >
            {choosing ? 'Checking…' : 'Restore backup…'}
          </button>
        </div>
        <p className="settings-note">
          Only restore files that came from this app. The chosen file is checked before anything is
          changed, and the app restarts afterwards.
        </p>
      </section>

      {restoreTarget && (
        <ConfirmDialog
          title="Restore this backup?"
          message={`Replace the current timetable with ${fileName(restoreTarget.path)}? It contains ${restoredCounts.sections} section(s) and ${restoredCounts.slots} class(es) for ${restoredCounts.timetables} timetable(s). A safety copy of the current data will be saved first, then the app will restart.`}
          confirmLabel="Restore and restart"
          busy={restoring}
          error={restoreError}
          onCancel={() => {
            setRestoreTarget(null)
            setRestoreError('')
          }}
          onConfirm={confirmRestore}
        />
      )}
    </div>
  )
}
