import { useEffect, useState } from 'react'
import { Card, Page } from '../components/Page'

/** Sehr einfacher Markdown-Renderer für CHANGELOG.md (Überschriften, Listen, Absätze). */
function renderChangelog(md: string) {
  const blocks: React.ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="mb-3 list-disc space-y-1 pl-5 text-sm text-subtle">
          {list.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*[-*] /.test(line)) {
      list.push(line.replace(/^\s*[-*] /, '').replace(/\*\*|`/g, ''))
      continue
    }
    flush()
    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={blocks.length} className="mt-4 mb-2 text-lg font-semibold first:mt-0">
          {line.slice(3)}
        </h2>,
      )
    } else if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={blocks.length} className="mb-1 text-sm font-semibold text-muted">
          {line.slice(4)}
        </h3>,
      )
    } else if (line && !line.startsWith('# ')) {
      blocks.push(
        <p key={blocks.length} className="mb-2 text-sm text-subtle">
          {line}
        </p>,
      )
    }
  }
  flush()
  return blocks
}

export function ChangelogPage() {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Immer vom Server laden, damit auch Änderungen einer noch nicht installierten Version sichtbar sind.
    fetch(`/CHANGELOG.md?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setText)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <Page title="Änderungsprotokoll">
      <Card>
        {error && <p className="text-sm text-danger">Konnte nicht geladen werden ({error}).</p>}
        {!error && text === null && <p className="text-sm text-muted">Lädt …</p>}
        {text && renderChangelog(text)}
      </Card>
    </Page>
  )
}
