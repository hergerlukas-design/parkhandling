import { describe, expect, it } from 'vitest'
import { pageCount } from './pushClient'

describe('pageCount', () => {
  it('teilt in Seiten zu 10', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(10)).toBe(1)
    expect(pageCount(11)).toBe(2)
    expect(pageCount(57)).toBe(6)
  })
})
