import { Link } from 'react-router'
import { usePageTitle } from '../components/usePageTitle'
import type { ParkingType } from '../lib/inquiry'

interface Offer {
  title: string
  badge?: string
  text: string
  points: string[]
  parking?: ParkingType
}

const PARKING: Offer[] = [
  {
    title: 'Park & Fly Halle',
    badge: 'Premium · Indoor',
    text: 'Ihr Fahrzeug steht überdacht in unserer Halle, geschützt vor Wetter, Hagel und Laub.',
    points: ['Überdachter Stellplatz', 'Ideal für längere Reisen', 'Auf Wunsch mit Aufbereitung'],
    parking: 'indoor',
  },
  {
    title: 'Außen mit Abdeckplane',
    text: 'Außenstellplatz, Ihr Fahrzeug wird mit einer Abdeckplane geschützt.',
    points: ['Schutz vor Schmutz und Sonne', 'Gutes Preis-Leistungs-Verhältnis'],
    parking: 'outdoor_cover',
  },
  {
    title: 'Außen ohne Plane',
    text: 'Der unkomplizierte Außenstellplatz für alle, die einfach günstig parken möchten.',
    points: ['Schnell angefragt', 'Für kurze und lange Reisen'],
    parking: 'outdoor',
  },
]

const EXTRAS: Offer[] = [
  {
    title: 'Shuttle zum Terminal',
    text: 'Wir bringen Sie zum Flughafen und holen Sie nach der Landung wieder ab.',
    points: ['Stündlich innerhalb der Betriebszeiten', 'Abholung nach Ihrer Landung'],
  },
  {
    title: 'Fahrzeugaufbereitung',
    badge: 'Zusatzleistung',
    text: 'Während Sie verreist sind, reinigen und pflegen wir Ihr Fahrzeug innen und außen.',
    points: ['Innen- und Außenreinigung', 'Sauber zurück nach der Reise'],
  },
]

const STEPS = [
  { title: 'Anfrage senden', text: 'Reisedaten, Stellplatzart und Wünsche angeben. Dauert etwa zwei Minuten.' },
  { title: 'Angebot erhalten', text: 'Wir prüfen die Verfügbarkeit und melden uns per E-Mail mit Ihrem Preis.' },
  { title: 'Bestätigen & losfliegen', text: 'Erst mit Ihrer Bestätigung wird gebucht. Die Anfrage ist unverbindlich.' },
]

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true">
      <path d="M4 10.5 8 14.5 16 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function OfferCard({ offer, highlight = false }: { offer: Offer; highlight?: boolean }) {
  return (
    <article
      className={`flex flex-col rounded-2xl border bg-card p-5 shadow-sm ${
        highlight ? 'border-accent-strong ring-2 ring-accent' : 'border-line'
      }`}
    >
      {offer.badge && (
        <span className="mb-2 self-start rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-accent">
          {offer.badge}
        </span>
      )}
      <h3 className="text-lg font-semibold">{offer.title}</h3>
      <p className="mt-1 text-ink-soft">{offer.text}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {offer.points.map((p) => (
          <li key={p} className="flex gap-2">
            <Check />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="text-sm font-semibold">Preis auf Anfrage</span>
        {offer.parking && (
          <Link
            to={`/anfrage?stellplatz=${offer.parking}`}
            aria-label={`${offer.title} anfragen`}
            className="inline-flex min-h-11 items-center rounded-lg border border-ink px-4 text-sm font-semibold hover:bg-ink hover:text-white"
          >
            Anfragen
          </Link>
        )}
      </div>
    </article>
  )
}

export function HomePage() {
  usePageTitle('Parken am Flughafen')

  return (
    <>
      <section className="bg-ink text-white">
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
              Jetzt unverbindlich anfragen
            </Link>
            <span className="text-sm text-white/70">Preise auf Anfrage · Antwort per E-Mail</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10" aria-labelledby="stellplaetze">
        <h2 id="stellplaetze" className="text-2xl font-bold">
          Unsere Stellplätze
        </h2>
        <p className="mt-1 text-ink-soft">Wählen Sie, wie Ihr Fahrzeug während der Reise stehen soll.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {PARKING.map((o, i) => (
            <OfferCard key={o.title} offer={o} highlight={i === 0} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-10" aria-labelledby="leistungen">
        <h2 id="leistungen" className="text-2xl font-bold">
          Dazu buchbar
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {EXTRAS.map((o) => (
            <OfferCard key={o.title} offer={o} />
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Lieber ohne Shuttle? Mit unserem <strong>Hol- &amp; Bringservice</strong> holen wir Ihr Fahrzeug ab und
          bringen es zurück. Einfach im Formular mit angeben.
        </p>
      </section>

      <section className="border-y border-line bg-card" aria-labelledby="ablauf">
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

      <section className="mx-auto max-w-5xl px-4 py-12 text-center">
        <h2 className="text-2xl font-bold">Reise geplant?</h2>
        <p className="mt-1 text-ink-soft">Senden Sie uns Ihre Daten, wir melden uns mit einem Angebot.</p>
        <Link
          to="/anfrage"
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-ink px-6 font-semibold text-white hover:bg-ink-soft"
        >
          Zur Anfrage
        </Link>
      </section>
    </>
  )
}
