import { describe, expect, it } from 'vitest'
import { astClock, londonOnSummerTime, londonStatus, untilText } from './london'

// Wednesday 2026-11-11 in UTC; Puerto Rico is UTC-4.
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m)

describe('London open strip', () => {
  it('counts down in the evening before (8:30 PM AST = 00:30 UTC)', () => {
    const s = londonStatus(at(11, 0, 30))
    expect(s).toEqual({
      phase: 'soon',
      startsAt: at(11, 6),
      frankfurtAt: at(11, 7),
      opensAt: at(11, 8),
    })
    expect(untilText(at(11, 6) - at(11, 0, 30))).toBe('5 h 30 min')
    expect(astClock(at(11, 6))).toBe('2:00 AM')
  })

  it('breakouts from 2:00, Frankfurt at 3:00, then London is open until 7:00 AM AST', () => {
    // 06:30 UTC = 2:30 AM AST: before Frankfurt (08:00 CET = 07:00 UTC in winter).
    expect(londonStatus(at(11, 6, 30))).toEqual({
      phase: 'preopen',
      frankfurtAt: at(11, 7),
      opensAt: at(11, 8),
    })
    expect(astClock(at(11, 7))).toBe('3:00 AM')
    expect(londonStatus(at(11, 7, 10))).toEqual({ phase: 'frankfurt', opensAt: at(11, 8) })
    expect(astClock(at(11, 8))).toBe('4:00 AM')
    expect(londonStatus(at(11, 9))).toEqual({
      phase: 'open',
      endsAt: at(11, 11),
      breakoutsUntil: at(11, 10),
    })
    expect(astClock(at(11, 11))).toBe('7:00 AM')
  })

  it('hidden in the afternoon and over the weekend', () => {
    expect(londonStatus(at(11, 12))).toBeNull() // 8 AM AST: session over, next one is 18 h away
    expect(londonStatus(at(11, 19))).toMatchObject({ phase: 'soon', startsAt: at(12, 6) }) // 3 PM AST
    expect(londonStatus(at(14, 9))).toBeNull() // Saturday
    expect(londonStatus(at(15, 20))).toMatchObject({ phase: 'soon', startsAt: at(16, 6) }) // Sunday 4 PM AST
    expect(londonStatus(at(13, 12))).toBeNull() // Friday after the session
  })

  it('knows when London is on summer time (the hours here are the winter ones)', () => {
    expect(londonOnSummerTime(at(11, 8))).toBe(false) // November: GMT
    expect(londonOnSummerTime(Date.UTC(2027, 2, 27, 12))).toBe(false) // Sat 27 Mar 2027
    expect(londonOnSummerTime(Date.UTC(2027, 2, 29, 8))).toBe(true) // Mon 29 Mar 2027: BST
  })

  it('writes short waits', () => {
    expect(untilText(45 * 60_000)).toBe('45 min')
    expect(untilText(10_000)).toBe('1 min')
  })
})
