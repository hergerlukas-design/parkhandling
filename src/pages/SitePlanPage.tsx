import { Page, Placeholder } from '../components/Page'

export function SitePlanPage() {
  return (
    <Page title="Lageplan">
      <Placeholder step={5}>
        Halle als Regalraster (E3 oben bis E1 unten) und Außenflächen als Reihen, eingefärbt nach
        Abholdatum, mit Detailpanel.
      </Placeholder>
    </Page>
  )
}
