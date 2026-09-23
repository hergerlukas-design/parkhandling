import { Page, Placeholder } from '../components/Page'
import { formatDate } from '../lib/format'

export function TodayPage() {
  return (
    <Page title={`Heute · ${formatDate(new Date())}`}>
      <Placeholder step={10}>
        Ankünfte und Abholungen als Zeitleiste, offene Aufgaben, Umsetz-Konflikte und Kapazität
        Halle/Außen.
      </Placeholder>
    </Page>
  )
}
