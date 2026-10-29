import { describe, expect, it } from 'vitest'
import { backupDate, backupInfo, backupName, backupsToPrune, isBackupName, shouldBackup } from './backup'

const file = (marks: { status: string }[]) => JSON.stringify({ version: 1, marks })

describe('Sicherungen von notes.json', () => {
  it('Dateiname aus dem Zeitpunkt, bei Gleichstand mit Zähler', () => {
    const d = new Date('2026-10-29T06:12:33.123Z')
    expect(backupName(d, new Set())).toBe('notes-2026-10-29T06-12-33-123Z.json')
    expect(backupName(d, new Set(['notes-2026-10-29T06-12-33-123Z.json']))).toBe('notes-2026-10-29T06-12-33-123Z-2.json')
    expect(backupDate('notes-2026-10-29T06-12-33-123Z-2.json')).toBe('2026-10-29T06:12:33.123Z')
    expect(isBackupName('notes.json')).toBe(false)
    expect(isBackupName('../notes-2026-10-29T06-12-33-123Z.json')).toBe(false)
  })

  it('sichert nur, wenn vorher Markierungen da waren und sich etwas ändert', () => {
    const one = file([{ status: 'offen' }])
    expect(shouldBackup(null, one)).toBe(false)
    expect(shouldBackup(file([]), one)).toBe(false)
    expect(shouldBackup('kaputt', one)).toBe(false)
    expect(shouldBackup(one, `${one}\n`)).toBe(false)
    expect(shouldBackup(one, file([]))).toBe(true)
  })

  it('löscht nur die ältesten über der Höchstzahl', () => {
    const names = ['notes-2026-10-29T06-00-00-000Z.json', 'notes-2026-10-28T06-00-00-000Z.json', 'notes-2026-10-30T06-00-00-000Z.json', 'andere.txt']
    expect(backupsToPrune(names, 2)).toEqual(['notes-2026-10-28T06-00-00-000Z.json'])
    expect(backupsToPrune(names, 5)).toEqual([])
  })

  it('Kurzinfo zählt Markierungen', () => {
    const info = backupInfo('notes-2026-10-29T06-12-33-123Z.json', file([{ status: 'offen' }, { status: 'erledigt' }]))
    expect(info).toEqual({ name: 'notes-2026-10-29T06-12-33-123Z.json', savedAt: '2026-10-29T06:12:33.123Z', marks: 2, open: 1 })
    expect(backupInfo('notes-2026-10-29T06-12-33-123Z.json', 'kaputt')).toBeNull()
  })
})
