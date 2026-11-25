import { describe, expect, it } from 'vitest'
import { parseAppearance } from './appearance'

describe('parseAppearance', () => {
  it('behält eine gespeicherte Wahl', () => {
    expect(parseAppearance('website')).toBe('website')
    expect(parseAppearance('standard')).toBe('standard')
  })
  it('nimmt ohne Wahl das Website-Design', () => {
    expect(parseAppearance(null)).toBe('website')
    expect(parseAppearance(undefined)).toBe('website')
    expect(parseAppearance('dunkel')).toBe('website')
  })
})
