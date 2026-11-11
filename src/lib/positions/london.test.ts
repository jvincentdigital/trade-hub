import { describe, expect, it } from 'vitest'
import { astClock, londonStatus, untilText } from './london'

// Wednesday 2026-11-11 in UTC; Puerto Rico is UTC-4.
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m)

describe('London open strip', () => {
  it('counts down in the evening before (8:30 PM AST = 00:30 UTC)', () => {
    const s = londonStatus(at(11, 0, 30))
    expect(s).toEqual({ phase: 'soon', startsAt: at(11, 6) })
    expect(untilText(at(11, 6) - at(11, 0, 30))).toBe('5 h 30 min')
    expect(astClock(at(11, 6))).toBe('2:00 AM')
  })

  it('Frankfurt first, then London is open until 7:00 AM AST', () => {
    expect(londonStatus(at(11, 6, 10))).toEqual({ phase: 'frankfurt', opensAt: at(11, 8) })
    expect(londonStatus(at(11, 9))).toEqual({
      phase: 'open',
      endsAt: at(11, 11),
      breakoutsUntil: at(11, 10),
    })
    expect(astClock(at(11, 11))).toBe('7:00 AM')
  })

  it('hidden in the afternoon and over the weekend', () => {
    expect(londonStatus(at(11, 12))).toBeNull() // 8 AM AST: session over, next one is 18 h away
    expect(londonStatus(at(11, 19))).toEqual({ phase: 'soon', startsAt: at(12, 6) }) // 3 PM AST
    expect(londonStatus(at(14, 9))).toBeNull() // Saturday
    expect(londonStatus(at(15, 20))).toEqual({ phase: 'soon', startsAt: at(16, 6) }) // Sunday 4 PM AST
    expect(londonStatus(at(13, 12))).toBeNull() // Friday after the session
  })

  it('writes short waits', () => {
    expect(untilText(45 * 60_000)).toBe('45 min')
    expect(untilText(10_000)).toBe('1 min')
  })
})
