// Notizen aus dem Browser-Speicher (localStorage) in die Datei übernehmen: Markierungen, die schon
// in der Datei stehen (gleiche id), bleiben unverändert; neue werden angehängt und bekommen bei
// belegter Nummer die nächste freie.
import type { ReviewFile, ReviewMark } from './types.ts'

/** Markierungen aus `other`, die in `file` noch fehlen */
export function missingMarks(file: ReviewFile, other: ReviewFile): ReviewMark[] {
  const known = new Set(file.marks.map((m) => m.id))
  return other.marks.filter((m) => !known.has(m.id))
}

export function mergeMarks(file: ReviewFile, other: ReviewFile): ReviewFile {
  const used = new Set(file.marks.map((m) => m.nr))
  let next = Math.max(0, ...file.marks.map((m) => m.nr)) + 1
  const added = [...missingMarks(file, other)]
    .sort((a, b) => a.nr - b.nr)
    .map((m) => {
      if (used.has(m.nr)) m = { ...m, nr: next }
      used.add(m.nr)
      next = Math.max(next, m.nr + 1)
      return m
    })
  return { ...file, marks: [...file.marks, ...added] }
}
