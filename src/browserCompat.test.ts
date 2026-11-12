import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

describe('Browser-Kompatibilität (ältere iOS-Geräte)', () => {
  it('nutzt keinen Regex-Lookbehind – Safari < 16.4 zeigt sonst nur eine weiße Seite', () => {
    const lookbehind = ['(?<', '=', '|', '(?<', '!'] // nicht als Literal, damit dieser Test sich nicht selbst findet
    const patterns = [lookbehind[0] + lookbehind[1], lookbehind[3] + lookbehind[4]]
    const hits = sourceFiles(join(__dirname))
      .filter((file) => patterns.some((p) => readFileSync(file, 'utf8').includes(p)))
    expect(hits).toEqual([])
  })
})
