import { describe, expect, it } from 'vitest'
import { crossCandles, feedOf, hasIntraday } from './feeds'

const k = (time: number, open: number, high: number, low: number, close: number) => ({
  time,
  open,
  high,
  low,
  close,
})

describe('market feeds', () => {
  it('knows which markets have real intraday candles', () => {
    expect(feedOf('GBP-USD')).toBe('kraken')
    expect(feedOf('pax-gold')).toBe('kraken')
    expect(feedOf('GBP-JPY')).toBe('cross')
    expect(feedOf('USD-JPY')).toBe('ecb')
    expect(feedOf('NZD-USD')).toBe('ecb')
    expect(hasIntraday('EUR-GBP')).toBe(true)
    expect(hasIntraday('USD-JPY')).toBe(false)
  })
})

describe('crossCandles', () => {
  it('multiplies candles of the same start time (close exact, high/low approximated)', () => {
    const gbpusd = [k(900, 1.3, 1.31, 1.29, 1.305)]
    const usdjpy = [k(900, 150, 151, 149, 150.5)]
    const [x] = crossCandles(gbpusd, usdjpy)
    expect(x.time).toBe(900)
    expect(x.open).toBeCloseTo(195, 10)
    expect(x.close).toBeCloseTo(1.305 * 150.5, 10)
    expect(x.high).toBeCloseTo(1.31 * 151, 10)
    expect(x.low).toBeCloseTo(1.29 * 149, 10)
  })

  it('uses the newest daily rate already published, after its lag', () => {
    const day = 86_400
    const daily = [k(0, 150, 150, 150, 150), k(day, 160, 160, 160, 160)]
    const lag = 16 * 3600
    const m15 = [
      k(10 * 3600, 1, 1.1, 0.9, 1), // day 0 before 16:00: no rate yet, left out
      k(17 * 3600, 1, 1.1, 0.9, 1), // day 0 after 16:00: day 0 rate
      k(day + 3600, 1, 1.1, 0.9, 1.05), // day 1 morning: still day 0 rate
      k(day + 17 * 3600, 1, 1.1, 0.9, 1), // day 1 after 16:00: day 1 rate
    ]
    const out = crossCandles(m15, daily, lag)
    expect(out.map((c) => c.time)).toEqual([17 * 3600, day + 3600, day + 17 * 3600])
    expect(out[0].high).toBeCloseTo(1.1 * 150, 10)
    expect(out[1].close).toBeCloseTo(1.05 * 150, 10)
    expect(out[2].low).toBeCloseTo(0.9 * 160, 10)
  })
})
