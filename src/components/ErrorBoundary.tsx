import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../lib/errorReporting'

/** Fängt Absturz beim Rendern ab: Meldung an das Fehlerprotokoll und „Neu laden“ statt weißer Seite. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (info.componentStack) error.stack = `${error.stack ?? ''}\nKomponenten:${info.componentStack}`
    void reportError('react', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">Etwas ist schiefgelaufen</h1>
        <p className="max-w-md text-sm text-subtle">
          Der Fehler wurde gemeldet. Entwürfe von Protokollen und Fotos in der Warteschlange bleiben auf dem
          Gerät gespeichert.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="touch-target rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          Neu laden
        </button>
      </div>
    )
  }
}
