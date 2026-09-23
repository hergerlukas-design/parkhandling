export const APP_VERSION: string = __APP_VERSION__
export const BUILD_TIME: string = __BUILD_TIME__

export interface SemVer {
  major: number
  minor: number
  patch: number
}

export type UpdateKind = 'none' | 'patch' | 'minor' | 'major'

export function parseSemver(value: string): SemVer | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** < 0 wenn a älter als b, 0 bei Gleichheit, > 0 wenn a neuer als b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch
}

/** Art des Updates von `current` auf `next`. `major` bedeutet Pflicht-Update. */
export function updateKind(current: string, next: string): UpdateKind {
  const pc = parseSemver(current)
  const pn = parseSemver(next)
  if (!pc || !pn || compareSemver(next, current) <= 0) return 'none'
  if (pn.major !== pc.major) return 'major'
  if (pn.minor !== pc.minor) return 'minor'
  return 'patch'
}
