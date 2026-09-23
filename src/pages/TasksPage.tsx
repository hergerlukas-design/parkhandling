import { Page, Placeholder } from '../components/Page'

export function TasksPage() {
  return (
    <Page title="Aufgaben">
      <Placeholder step={7}>Kanban offen / in Arbeit / erledigt mit Fotos.</Placeholder>
    </Page>
  )
}
