import { describe, expect, it } from 'vitest'
import { CROSS_TOL, crossCheck, dropClosedForex, forexClosed } from './candles'

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

describe('crossCheck', () => {
  const c = (time: number, open: number, high: number, low: number, close: number) => ({
    time,
    open,
    high,
    low,
    close,
  })
  // The second source sits 3 pips above the main one, as Yahoo does over Kraken.
  const second = [
    c(0, 1.3273, 1.3278, 1.327, 1.3275),
    c(900, 1.3275, 1.3279, 1.3271, 1.3272),
    c(1800, 1.3272, 1.3276, 1.3268, 1.327),
  ]
  const main = [
    c(0, 1.327, 1.3275, 1.3267, 1.3272),
    // the fake print of 2026-11-12: high 1.3471 with the market near 1.3272
    c(900, 1.3272, 1.3471, 1.3268, 1.3269),
    c(1800, 1.3269, 1.3273, 1.3265, 1.3267),
    c(2700, 1.3267, 1.327, 1.3264, 1.3266),
  ]

  it('pulls a fake wick back to the second source and leaves honest candles alone', () => {
    const r = crossCheck(main, second)
    expect(r.trimmed).toBe(1)
    expect(r.candles[0]).toEqual(main[0])
    expect(r.candles[2]).toEqual(main[2])
    // second high 1.3279, shifted 3 pips down, plus 0.04% of the price
    expect(r.candles[1].high).toBeCloseTo(1.3279 - 0.0003 + CROSS_TOL * 1.3272, 6)
    expect(r.candles[1]).toMatchObject({ open: 1.3272, low: 1.3268, close: 1.3269 })
  })

  it('reports candles the second source does not have and keeps them', () => {
    const r = crossCheck(main, second)
    expect(r.unmatched).toEqual([2700])
    expect(r.candles[3]).toEqual(main[3])
    expect(crossCheck(main, []).unmatched).toHaveLength(4)
  })

  it('clamps a fake close too, so the candle stays in one piece', () => {
    const r = crossCheck([main[0], c(900, 1.3272, 1.34, 1.3268, 1.34), main[2]], second)
    const k = r.candles[1]
    expect(k.close).toBe(k.high)
    expect(k.high).toBeLessThan(1.329)
  })
})
