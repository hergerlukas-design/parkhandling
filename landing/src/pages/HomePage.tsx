import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'
import { type Tariff, fetchTariffs } from '../lib/api'
import { formatEuro } from '../lib/booking'

const STEPS = [
  { title: 'Zeitraum & Tarif wählen', text: 'Anreise, Abholung und Tarif angeben. Der Preis richtet sich nach der Dauer.' },
  { title: 'Mit PayPal bezahlen', text: 'Die Zahlung läuft über PayPal, auch mit Kreditkarte möglich.' },
  { title: 'Bestätigung per E-Mail', text: 'Nach der Zahlung ist Ihre Buchung bestätigt. Die Bestätigung kommt per E-Mail.' },
]

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true">
      <path d="M4 10.5 8 14.5 16 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TariffCard({ tariff, highlight }: { tariff: Tariff; highlight: boolean }) {
  const points = tariff.included_text.split(', ')
  return (
    <article
      className={`flex flex-col rounded-2xl border bg-card p-5 shadow-sm ${
        highlight ? 'border-accent-strong ring-2 ring-accent' : 'border-line'
      }`}
    >
      <span className="mb-2 self-start rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-accent">
        {tariff.parking_type === 'indoor' ? 'Indoor' : tariff.parking_type === 'outdoor_cover' ? 'Outdoor mit Plane' : 'Outdoor'}
      </span>
      <h3 className="text-lg font-semibold">{tariff.label}</h3>
      <p className="mt-1 text-sm text-ink-soft">Shuttle zum Terminal: {tariff.shuttle_text}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-soft">5–8 Tage</dt>
        <dd className="text-right font-semibold">{formatEuro(tariff.price_week)}</dd>
        <dt className="text-ink-soft">9–15 Tage</dt>
        <dd className="text-right font-semibold">{formatEuro(tariff.price_holiday)}</dd>
        <dt className="text-ink-soft">16–30 Tage</dt>
        <dd className="text-right font-semibold">{formatEuro(tariff.price_month)}</dd>
      </dl>
      <ul className="mt-3 space-y-1.5 text-sm">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <Check />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        <Link
          to={`/anfrage?tarif=${tariff.code}`}
          aria-label={`${tariff.label} buchen`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-ink px-4 text-sm font-semibold hover:bg-ink hover:text-white"
        >
          Jetzt buchen
        </Link>
      </div>
    </article>
  )
}

export function HomePage() {
  usePageTitle('Parken am Flughafen')
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetchTariffs()
      .then(setTariffs)
      .catch(() => setFailed(true))
  }, [])

  return (
    <>
      <section className="bg-ink text-white" data-review="startseite-hero" data-review-label="Startseite: Hero">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-8 md:pb-16 md:pt-12">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">Flughafen München</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight md:text-5xl">
            Sicher parken, entspannt fliegen.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-white/80">
            Hallenstellplatz oder Außenstellplatz, Shuttle zum Terminal und auf Wunsch eine Fahrzeugaufbereitung,
            während Sie unterwegs sind.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/anfrage"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-6 text-base font-semibold text-ink hover:bg-white"
            >
              Jetzt buchen
            </Link>
            <span className="text-sm text-white/70">Online bezahlen mit PayPal · Bestätigung per E-Mail · buchbar bis 12 Stunden vor Anreise</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10" aria-labelledby="tarife" data-review="startseite-tarife" data-review-label="Startseite: Tarife">
        <h2 id="tarife" className="text-2xl font-bold">
          Unsere Tarife
        </h2>
        <p className="mt-1 text-ink-soft">Der Preis richtet sich nach der Dauer Ihrer Reise.</p>
        {failed && <p className="mt-5 text-danger">Die Tarife konnten gerade nicht geladen werden. Bitte laden Sie die Seite neu.</p>}
        {!failed && !tariffs && <p className="mt-5 text-ink-soft">Tarife werden geladen …</p>}
        {tariffs && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tariffs.map((t) => (
              <TariffCard key={t.code} tariff={t} highlight={t.code === 'premium'} />
            ))}
          </div>
        )}
        <p className="mt-4 text-sm text-ink-soft">
          In allen Tarifen enthalten: Annahme und Ausgabe sowie ParkHandling. Lieber ohne Shuttle? Mit unserem{' '}
          <strong>Hol- &amp; Bringservice</strong> holen wir Ihr Fahrzeug ab und bringen es zurück. Einfach im Buchungsformular angeben.
        </p>
      </section>

      <section className="border-y border-line bg-card" aria-labelledby="ablauf" data-review="startseite-ablauf" data-review-label="Startseite: So funktioniert's">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <h2 id="ablauf" className="text-2xl font-bold">
            So funktioniert&apos;s
          </h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink font-bold text-accent">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm text-ink-soft">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 text-center" data-review="startseite-cta" data-review-label="Startseite: Abschluss">
        <h2 className="text-2xl font-bold">Jetzt Zeitraum wählen</h2>
        <p className="mt-1 text-ink-soft">Buchbar für 5 bis 30 Tage.</p>
        <Link
          to="/anfrage"
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-ink px-6 font-semibold text-white hover:bg-ink-soft"
        >
          Zur Buchung
        </Link>
      </section>
    </>
  )
}
