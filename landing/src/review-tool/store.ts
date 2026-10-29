// Speichern der Notizen: im Dev-Server als Datei (landing/review/, über das Vite-Plugin),
// sonst ersatzweise im Browser (localStorage) mit Export als Datei.
import type { BackupInfo } from './backup'
import { EMPTY_FILE, isReviewFile, type ReviewFile } from './types'

export type StoreMode = 'datei' | 'browser'

const ENDPOINT = '/__review/notes'
const LOCAL_KEY = 'pf-review-notes'

function readLocal(): ReviewFile {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')
    return isReviewFile(parsed) ? parsed : EMPTY_FILE
  } catch {
    return EMPTY_FILE
  }
}

export async function loadNotes(): Promise<{ file: ReviewFile; mode: StoreMode }> {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' })
    const data: unknown = await res.json()
    if (res.ok && isReviewFile(data)) return { file: data, mode: 'datei' }
  } catch {
    // kein Dev-Server-Plugin → Browser
  }
  return { file: readLocal(), mode: 'browser' }
}

export async function saveNotes(file: ReviewFile): Promise<StoreMode> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    })
    if (res.ok) return 'datei'
  } catch {
    // weiter mit Browser-Speicher
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(file))
  } catch {
    // Speicher gesperrt – Export bleibt möglich
  }
  return 'browser'
}

/** Sicherungen in landing/review/backup/ (nur Dev-Server), neueste zuerst */
export async function loadBackups(): Promise<BackupInfo[]> {
  const res = await fetch('/__review/backups', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sicherungen nicht lesbar (${res.status})`)
  return ((await res.json()) as { backups: BackupInfo[] }).backups
}

/** Sicherung zurückspielen; die bisherige Fassung wird dabei selbst gesichert */
export async function restoreBackup(name: string): Promise<ReviewFile> {
  const res = await fetch('/__review/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = (await res.json()) as { file?: unknown; error?: string }
  if (!res.ok || !isReviewFile(data.file)) throw new Error(data.error ?? 'Wiederherstellen fehlgeschlagen')
  return data.file
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
