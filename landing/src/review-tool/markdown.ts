// Markdown-Ausgabe der Notizen für Claude Code (landing/review/NOTES.md).
// Reine Funktion ohne DOM/Node, wird im Browser (Download) und im Vite-Plugin (Datei) genutzt.
import { KIND_LABEL, type ReviewFile, type ReviewMark } from './types.ts'

function quote(text: string): string {
  return `„${text.replace(/\s+/g, ' ').trim()}“`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function markBlock(m: ReviewMark, screenshots: ReadonlySet<string>): string {
  const lines = [`### #${m.nr} · \`${m.page}\` · ${KIND_LABEL[m.kind]}`, '', `**Notiz:** ${m.note.trim() || '(leer)'}`, '']
  if (m.context.section) lines.push(`- Abschnitt: ${m.context.section}`)
  if (m.context.heading) lines.push(`- Überschrift darüber: ${quote(m.context.heading)}`)
  if (m.quote) lines.push(`- Markierter Text: ${quote(m.quote)}`)
  if (m.context.elements.length > 0) {
    lines.push('- Markierte Elemente:')
    for (const el of m.context.elements)
      lines.push(`  - \`${el.tag}\`${el.text ? ` ${quote(el.text)}` : ''} – \`${el.selector}\``)
  }
  lines.push(
    `- Bildschirm: ${m.viewport.width} × ${m.viewport.height} px, Bereich x ${Math.round(m.box.x)}, y ${Math.round(m.box.y)}, ` +
      `${Math.round(m.box.w)} × ${Math.round(m.box.h)} px`,
  )
  lines.push(`- Erstellt: ${formatDate(m.createdAt)}`)
  if (screenshots.has(m.id)) lines.push('', `![Markierung #${m.nr}](screens/${m.nr}.png)`)
  return lines.join('\n')
}

/**
 * @param screenshots IDs der Markierungen, für die `review/screens/<nr>.png` existiert
 */
export function toMarkdown(file: ReviewFile, appVersion: string, screenshots: ReadonlySet<string> = new Set()): string {
  const open = file.marks.filter((m) => m.status === 'offen').sort((a, b) => a.nr - b.nr)
  const done = file.marks.filter((m) => m.status === 'erledigt').sort((a, b) => a.nr - b.nr)
  const out = [
    '# Review-Notizen Landingpage',
    '',
    '> Erzeugt vom Markier-Werkzeug (`npm run dev` in `landing/`, Knopf „Markieren“ unten links).',
    '> Nicht von Hand bearbeiten – Änderungen im Werkzeug machen. Rohdaten: `notes.json`.',
    '',
    '## Anleitung für Claude Code',
    '',
    'Setze die **offenen** Punkte in `landing/` um. Zu jedem Punkt gibt es die Seite, die Notiz, den',
    'markierten Text bzw. die markierten Elemente (Text und CSS-Pfad zum Suchen im Code) und, falls',
    'vorhanden, einen Screenshot mit der Markierung (rot = Stift, gelb = Text, gestrichelt = Element).',
    'Danach in `notes.json` beim Punkt `"status": "erledigt"` setzen, die Version in `landing/package.json`',
    'nach SemVer erhöhen und `landing/CHANGELOG.md` ergänzen. Unklare Punkte nicht raten, sondern nachfragen.',
    '',
    `Stand: landing ${appVersion} · ${open.length} offen · ${done.length} erledigt`,
    '',
    '## Offen',
    '',
    open.length === 0 ? '_Keine offenen Punkte._' : open.map((m) => markBlock(m, screenshots)).join('\n\n'),
  ]
  if (done.length > 0) {
    out.push('', '## Erledigt', '')
    for (const m of done) out.push(`- #${m.nr} \`${m.page}\`: ${m.note.replace(/\s+/g, ' ').trim()}`)
  }
  return `${out.join('\n')}\n`
}
