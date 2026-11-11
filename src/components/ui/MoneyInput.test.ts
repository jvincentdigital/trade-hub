import { describe, expect, it } from 'vitest'
import { parseMoney } from './MoneyInput'

describe('parseMoney', () => {
  it('reads plain and formatted amounts', () => {
    expect(parseMoney('1000')).toBe(1000)
    expect(parseMoney('$5,000')).toBe(5000)
    expect(parseMoney(' 250.50 ')).toBe(250.5)
  })
  it('an empty or zero box is not an amount (so it can be cleared while typing)', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('0')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
  })
})
