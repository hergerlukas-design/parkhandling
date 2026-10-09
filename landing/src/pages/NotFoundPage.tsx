import { Link } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'

export function NotFoundPage() {
  usePageTitle('Seite nicht gefunden')
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">Seite nicht gefunden</h1>
      <p className="mt-3 text-ink-soft">Die aufgerufene Seite gibt es nicht.</p>
      <Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-ink px-6 font-semibold text-white">
        Zur Startseite
      </Link>
    </div>
  )
}
