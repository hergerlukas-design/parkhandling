// Sicherungskopien von notes.json (landing/review/backup/): reine Hilfsfunktionen ohne Dateizugriff,
// genutzt vom Vite-Plugin (Schreiben/Wiederherstellen) und vom Werkzeug (Anzeige).
import { isReviewFile } from './types.ts'

/** So viele Sicherungen bleiben erhalten, ältere werden gelöscht */
export const MAX_BACKUPS = 100

export interface BackupInfo {
  /** Dateiname in review/backup/ */
  name: string
  /** Zeitpunkt der Sicherung (ISO) */
  savedAt: string
  /** Anzahl Markierungen insgesamt bzw. offen */
  marks: number
  open: number
}

const NAME_RE = /^notes-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?\.json$/

/** Dateiname aus dem Zeitpunkt, sortierbar; bei Gleichstand mit Zähler */
export function backupName(date: Date, taken: ReadonlySet<string>): string {
  const base = `notes-${date.toISOString().replace(/[:.]/g, '-')}`
  let name = `${base}.json`
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}.json`
  return name
}

export function isBackupName(name: string): boolean {
  return NAME_RE.test(name)
}

/** Zeitpunkt aus dem Dateinamen (ISO) oder null */
export function backupDate(name: string): string | null {
  const m = NAME_RE.exec(name)
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null
}

/**
 * Vor dem Überschreiben sichern, wenn die bisherige Datei Markierungen enthält und sich der Inhalt ändert.
 * Eine leere oder kaputte Datei lohnt keine Sicherung.
 */
export function shouldBackup(previous: string | null, next: string): boolean {
  if (previous === null || previous.trim() === next.trim()) return false
  try {
    const data: unknown = JSON.parse(previous)
    return isReviewFile(data) && data.marks.length > 0
  } catch {
    return false
  }
}

/** Dateinamen, die über die Höchstzahl hinausgehen (die ältesten) */
export function backupsToPrune(names: readonly string[], keep = MAX_BACKUPS): string[] {
  const sorted = names.filter(isBackupName).sort()
  return sorted.slice(0, Math.max(0, sorted.length - keep))
}

/** Kurzinfo zu einer Sicherung; null, wenn der Inhalt kein gültiges notes.json ist */
export function backupInfo(name: string, content: string): BackupInfo | null {
  const savedAt = backupDate(name)
  if (!savedAt) return null
  try {
    const data: unknown = JSON.parse(content)
    if (!isReviewFile(data)) return null
    return { name, savedAt, marks: data.marks.length, open: data.marks.filter((m) => m.status === 'offen').length }
  } catch {
    return null
  }
}
