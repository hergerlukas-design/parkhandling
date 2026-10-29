import { usePageTitle } from '../components/usePageTitle'

const TITLES = { impressum: 'Impressum', datenschutz: 'Datenschutz' } as const

export function LegalPage({ kind }: { kind: keyof typeof TITLES }) {
  usePageTitle(TITLES[kind])

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{TITLES[kind]}</h1>
      <p className="mt-4 rounded-xl border border-accent-strong/40 bg-accent/15 p-4 font-medium">
        Diese Seite wird vor Go-live ergänzt.
      </p>
      {kind === 'datenschutz' && (
        <div className="mt-6 space-y-3 text-ink-soft">
          <h2 className="text-lg font-semibold text-ink">Vorläufiger Hinweis zum Anfrageformular</h2>
          <p>
            Die Angaben im Anfrageformular (Reisedaten, Stellplatzwunsch, Kennzeichen, Name, E-Mail, optional Telefon
            und Nachricht) werden ausschließlich zur Bearbeitung Ihrer Anfrage verwendet.
          </p>
          <p>
            Diese Seite setzt keine Cookies und bindet keine Tracking-Dienste oder Schriftarten von Drittanbietern ein.
            Zur Zuordnung von Werbekampagnen werden Kampagnenparameter aus dem Link (UTM) nur für die Dauer der
            Browser-Sitzung im Sitzungsspeicher Ihres Browsers gehalten und mit der Anfrage übermittelt.
          </p>
        </div>
      )}
    </div>
  )
}
