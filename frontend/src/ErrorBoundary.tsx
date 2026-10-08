import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode; popup?: boolean }> {
  state = { failed: false }

  static reportError(_error: unknown, info: { componentStack?: string | null }) {
    // Error messages can contain submitted code; component locations are enough to diagnose a crash.
    console.error('ICARUS screen failed', info.componentStack)
  }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    if (this.props.popup) void window.icarus?.setPopupThinking(false)
      .catch(() => console.error('Could not resize the ICARUS recovery screen'))
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="screen-error" role="alert">
      <h1>ICARUS could not display this screen.</h1>
      <p>Reload to try again. Your saved connection and project notes are kept.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload ICARUS</button>
    </main>
  }
}
