import { describe, expect, it } from 'vitest'
import { dropClosedForex, forexClosed } from './candles'

const utc = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h, min) / 1000

describe('forex weekend', () => {
  it('shuts Friday 17:00 to Sunday 17:00 New York time (EST in November: 22:00 UTC)', () => {
    expect(forexClosed(utc(11, 13, 21, 59))).toBe(false) // Fri 16:59 New York
    expect(forexClosed(utc(11, 13, 22))).toBe(true) // Fri 17:00
    expect(forexClosed(utc(11, 14, 12))).toBe(true) // Saturday
    expect(forexClosed(utc(11, 15, 21, 45))).toBe(true) // Sun 16:45
    expect(forexClosed(utc(11, 15, 22))).toBe(false) // Sun 17:00: the reopen
    expect(forexClosed(utc(11, 16, 8))).toBe(false) // Monday London open
  })

  it('follows US summer time (EDT in July: 21:00 UTC)', () => {
    expect(forexClosed(utc(7, 10, 20, 59))).toBe(false)
    expect(forexClosed(utc(7, 10, 21))).toBe(true)
    expect(forexClosed(utc(7, 12, 21))).toBe(false)
  })

  it('drops candles that start inside the closed span, keeps the reopen candle', () => {
    const c = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1 })
    const kept = dropClosedForex([
      c(utc(11, 13, 21, 45)),
      c(utc(11, 13, 22)),
      c(utc(11, 14, 0)),
      c(utc(11, 15, 22)),
    ]).map((k) => k.time)
    expect(kept).toEqual([utc(11, 13, 21, 45), utc(11, 15, 22)])
  })
})
