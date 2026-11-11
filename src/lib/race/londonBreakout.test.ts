import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { atrSeries, avgAsianRange, londonBreakout } from './londonBreakout'

// Synthetic candles around 1.3000. Wednesday 2026-11-11 is the trading day.
const DAY = 86_400
const WED = Date.UTC(2026, 10, 11) / 1000
const SAT = Date.UTC(2026, 10, 14) / 1000
const P = 1.3

const c = (time: number, o: number, h: number, l: number, cl: number): OHLCCandle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: cl,
})

/** 30 days of 1h candles, each +-half/2 around P, so every Asian range is `width` wide. */
function hourly(day: number, width = 0.002): OHLCCandle[] {
  const out: OHLCCandle[] = []
  for (let t = day - 30 * DAY; t < day + 12 * 3600; t += 3600)
    out.push(c(t, P, P + width / 2, P - width / 2, P))
  return out
}

/** Today's 24 Asian 15m candles: each `each` wide inside a range from P-half to P+half. */
function asia(day: number, half = 0.001, each?: number): OHLCCandle[] {
  return Array.from({ length: 24 }, (_, i) => {
    const t = day + i * 900
    if (each == null) return c(t, P, P + half, P - half, P)
    // Small candles stepping from the low to the high, so the range is wide but ATR small.
    const mid = P - half + each / 2 + ((2 * half - each) * i) / 23
    return c(t, mid, mid + each / 2, mid - each / 2, mid)
  })
}

/** A 15m candle in the London window, `k` slots after 06:00 UTC. */
const win = (day: number, k: number, o: number, h: number, l: number, cl: number) =>
  c(day + 6 * 3600 + k * 900, o, h, l, cl)

/** Seconds just after the candle `k` slots after 06:00 closed. */
const after = (day: number, k: number) => day + 6 * 3600 + (k + 1) * 900 + 30

describe('London breakout', () => {
  it('buys the first close above the Asian range, stop at the range middle when that is closer', () => {
    const m15 = [
      ...asia(WED),
      win(WED, 0, P, P + 0.0009, P - 0.0009, P + 0.0005),
      win(WED, 1, P + 0.0005, P + 0.0016, P - 0.0005, P + 0.0015),
    ]
    const r = londonBreakout(m15, hourly(WED), after(WED, 1))
    expect(r.signal?.direction).toBe('long')
    expect(r.signal?.entry).toBeCloseTo(P + 0.0015, 10)
    // ATR about 0.0019 > distance to the middle (0.0015): stop at the middle.
    expect(r.signal?.stop).toBeCloseTo(P, 10)
    expect(r.signal?.takeProfit).toBeCloseTo(P + 0.0015 + 2 * 0.0015, 10)
    expect(r.note).toMatch(/broke above/)
  })

  it('sells the first close below the range', () => {
    const m15 = [...asia(WED), win(WED, 0, P, P + 0.0005, P - 0.0016, P - 0.0015)]
    const r = londonBreakout(m15, hourly(WED), after(WED, 0))
    expect(r.signal?.direction).toBe('short')
    expect(r.signal?.stop).toBeCloseTo(P, 10)
    expect(r.signal?.takeProfit).toBeCloseTo(P - 0.0045, 10)
  })

  it('uses 1x ATR when that is closer than the middle of the range', () => {
    // Range 0.002 wide made of tiny candles: ATR far below the 0.0011 to the middle.
    const m15 = [
      ...asia(WED, 0.001, 0.0001),
      win(WED, 0, P + 0.0009, P + 0.00112, P + 0.00088, P + 0.0011),
    ]
    const r = londonBreakout(m15, hourly(WED), after(WED, 0))
    const atr = atrSeries(m15).at(-1)!
    expect(atr).toBeLessThan(0.0011)
    expect(r.signal?.direction).toBe('long')
    expect(P + 0.0011 - r.signal!.stop).toBeCloseTo(atr, 10)
  })

  it('never puts the stop closer than half an ATR', () => {
    // Wild window candles (wicks out, closes in) push ATR up; the break is just past the high.
    const wild = [0, 1, 2, 3].map((k) => win(WED, k, P, P + 0.005, P - 0.005, P))
    const brk = win(WED, 4, P, P + 0.0013, P - 0.0002, P + 0.0012)
    const m15 = [...asia(WED), ...wild, brk]
    const r = londonBreakout(m15, hourly(WED), after(WED, 4))
    const atr = atrSeries(m15).at(-1)!
    expect(0.0012).toBeLessThan(0.5 * atr)
    expect(r.signal!.entry - r.signal!.stop).toBeCloseTo(0.5 * atr, 10)
  })

  it('takes only the first break of the day', () => {
    const m15 = [
      ...asia(WED),
      win(WED, 0, P, P + 0.0016, P, P + 0.0015), // first break, up
      win(WED, 1, P + 0.0015, P + 0.0015, P - 0.0005, P),
      win(WED, 2, P, P, P - 0.0016, P - 0.0015), // second break, down: ignored
    ]
    const r = londonBreakout(m15, hourly(WED), after(WED, 2))
    expect(r.signal).toBeNull()
    expect(r.note).toMatch(/first break was at 06:00 UTC/)
  })

  it('waits while no candle has closed outside the range', () => {
    const m15 = [...asia(WED), win(WED, 0, P, P + 0.003, P - 0.003, P + 0.0005)]
    const r = londonBreakout(m15, hourly(WED), after(WED, 0))
    expect(r.signal).toBeNull()
    expect(r.note).toMatch(/no break yet/)
  })

  it('ignores a candle still forming and breaks after 10:00 UTC', () => {
    const forming = [...asia(WED), win(WED, 0, P, P + 0.0016, P, P + 0.0015)]
    expect(londonBreakout(forming, hourly(WED), WED + 6 * 3600 + 600).signal).toBeNull()
    const late = [...asia(WED), win(WED, 16, P, P + 0.0016, P, P + 0.0015)] // 10:00 UTC
    const r = londonBreakout(late, hourly(WED), after(WED, 16))
    expect(r.signal).toBeNull()
    expect(r.note).toMatch(/no break by 10:00/)
  })

  it('skips a range wider than 1.5x or narrower than 0.3x the 20-day average', () => {
    const wide = [...asia(WED, 0.0016), win(WED, 0, P, P + 0.004, P, P + 0.0035)]
    const w = londonBreakout(wide, hourly(WED), after(WED, 0))
    expect(w.signal).toBeNull()
    expect(w.note).toMatch(/too wide/)
    const narrow = [...asia(WED, 0.0002), win(WED, 0, P, P + 0.0006, P, P + 0.0005)]
    const n = londonBreakout(narrow, hourly(WED), after(WED, 0))
    expect(n.signal).toBeNull()
    expect(n.note).toMatch(/too narrow/)
  })

  it('does not trade on weekends or with a broken Asian range', () => {
    const sat = [...asia(SAT), win(SAT, 0, P, P + 0.0016, P, P + 0.0015)]
    expect(londonBreakout(sat, hourly(SAT), after(SAT, 0)).note).toMatch(/weekend/)
    const gappy = [...asia(WED).slice(0, 10), win(WED, 0, P, P + 0.0016, P, P + 0.0015)]
    expect(londonBreakout(gappy, hourly(WED), after(WED, 0)).note).toMatch(/incomplete/)
  })

  it('averages the Asian range over weekdays only', () => {
    const h1 = hourly(WED)
    // Make weekend Asian sessions tiny; the average must not move.
    for (const k of h1) {
      const d = new Date(k.time * 1000).getUTCDay()
      if (d === 0 || d === 6) {
        k.high = P + 0.00001
        k.low = P - 0.00001
      }
    }
    const a = avgAsianRange(h1, WED)
    expect(a?.days).toBe(20)
    expect(a?.avg).toBeCloseTo(0.002, 10)
    expect(avgAsianRange(h1.slice(-5 * 24), WED)).toBeNull()
  })
})
