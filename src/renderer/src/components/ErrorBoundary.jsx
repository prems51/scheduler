import { Component } from 'react'

/**
 * The last line of defence: if any page throws while rendering, the app shows a
 * calm recovery screen instead of a blank white window. The user can copy the
 * details for support and reload without touching their timetable data.
 */
export default class ErrorBoundary extends Component {
  state = { error: null, info: null, copied: false }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    try {
      window.api?.logs?.error({
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
        versions: window.api?.versions || null
      })
    } catch {
      // A failed log request must not replace the recovery screen with another error.
    }
  }

  detailsText() {
    const { error, info } = this.state
    const versions = [
      `Electron ${window.api?.versions?.electron ?? 'unknown'}`,
      `Chrome ${window.api?.versions?.chrome ?? 'unknown'}`,
      `Node ${window.api?.versions?.node ?? 'unknown'}`
    ].join(', ')
    return [
      'Timetable Manager — error details',
      versions,
      '',
      error?.stack || error?.message || String(error),
      info?.componentStack ? `\nComponent stack:${info.componentStack}` : ''
    ].join('\n')
  }

  async copyDetails() {
    const text = this.detailsText()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    this.setState({ copied: true })
    window.setTimeout(() => this.setState({ copied: false }), 3000)
  }

  render() {
    const { error, info, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-boundary">
        <div className="error-card" role="alert">
          <p className="error-eyebrow">Timetable Manager</p>
          <h1>Something went wrong on this screen</h1>
          <p>
            Your saved timetable has not been changed. You can reload the app and carry on. If this
            keeps happening, copy the details below and make a backup from Settings before restarting.
          </p>
          <div className="error-actions">
            <button type="button" className="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
            <button type="button" className="button button-secondary" onClick={() => this.copyDetails()}>
              {copied ? 'Copied!' : 'Copy details'}
            </button>
          </div>
          <details className="error-details">
            <summary>Technical details</summary>
            <pre>{`${error.stack || error.message}${info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ''}`}</pre>
          </details>
        </div>
      </div>
    )
  }
}
