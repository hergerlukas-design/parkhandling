import { describe, expect, it } from 'vitest'
import { parseAppearance } from './appearance'

describe('parseAppearance', () => {
  it('erkennt den Website-Modus', () => {
    expect(parseAppearance('website')).toBe('website')
  })
  it('fällt bei allem anderen auf Standard zurück', () => {
    expect(parseAppearance(null)).toBe('standard')
    expect(parseAppearance(undefined)).toBe('standard')
    expect(parseAppearance('dunkel')).toBe('standard')
  })
})
