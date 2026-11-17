import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { OWL, bounceCount, candlesIn, eveningOf, gridEvening, londonHoursOf, pathOf } from './owl'

const T0 = Date.UTC(2025, 0, 6) / 1000 // Monday 2025-01-06
/** One candle per price move: from `a` to `b` in one minute. */
const legs = (prices: number[], t0 = T0): OHLCCandle[] =>
  prices.slice(1).map((p, n) => {
    const o = prices[n]
    return { time: t0 + n * 60, open: o, high: Math.max(o, p), low: Math.min(o, p), close: p }
  })

describe('owl study: clock and candles', () => {
  it('an evening is 18:05 to 24:00 New York, in winter and in summer', () => {
    const w = eveningOf(T0)
    expect(new Date(w.from * 1000).toISOString()).toBe('2025-01-06T23:05:00.000Z')
    expect(new Date(w.to * 1000).toISOString()).toBe('2025-01-07T05:00:00.000Z')
    const s = eveningOf(Date.UTC(2025, 6, 7) / 1000)
    expect(new Date(s.from * 1000).toISOString()).toBe('2025-07-07T22:05:00.000Z')
    expect(new Date(s.to * 1000).toISOString()).toBe('2025-07-08T04:00:00.000Z')
  })
  it('London hours are 07:00 to 16:30 London time', () => {
    const w = londonHoursOf(Date.UTC(2025, 6, 7) / 1000)
    expect(new Date(w.from * 1000).toISOString()).toBe('2025-07-07T06:00:00.000Z')
    expect(new Date(w.to * 1000).toISOString()).toBe('2025-07-07T15:30:00.000Z')
  })
  it('a window with too few minutes sits out', () => {
    const w = eveningOf(T0)
    const all: OHLCCandle[] = Array.from({ length: 355 }, (_, n) => ({
      time: w.from + n * 60,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }))
    expect(candlesIn(all, 0, w)).toHaveLength(355)
    expect(candlesIn(all.slice(0, 300), 0, w)).toBeNull()
  })
  it('inside a candle the low comes first when it closed up, the high first when it closed down', () => {
    expect(pathOf({ time: 0, open: 5, high: 8, low: 4, close: 7 })).toEqual([5, 4, 8, 7])
    expect(pathOf({ time: 0, open: 5, high: 8, low: 4, close: 4.5 })).toEqual([5, 8, 4, 4.5])
  })
})

describe('owl study, part 1: the bounce count', () => {
  it('a zigzag is all bounces', () => {
    expect(bounceCount(legs([100, 101, 100, 101, 100]))).toEqual({
      steps: 4,
      bounces: 3,
      onward: 0,
    })
  })
  it('a straight run is all onward steps, also inside one candle', () => {
    expect(bounceCount(legs([100, 101, 102, 103]))).toEqual({ steps: 3, bounces: 0, onward: 2 })
    expect(bounceCount(legs([100, 103.2]))).toEqual({ steps: 3, bounces: 0, onward: 2 })
  })
  it('a move that does not reach the next level is no step', () => {
    expect(bounceCount(legs([100, 100.9, 99.1, 100.5]))).toEqual({
      steps: 0,
      bounces: 0,
      onward: 0,
    })
  })
})

describe('owl study, part 2: a grid with the passive numbers', () => {
  const cost = 0.2
  it('one dollar up: the buy side takes its dollar, the sell side adds a bigger trade, the end closes the rest', () => {
    const r = gridEvening(legs([100, 101]), OWL.startMoney, cost)
    expect(r.closes).toBe(1)
    expect(r.stopped).toBe(false)
    // Buy: 2 oz won $1 each less costs; a new 2 oz buy at 101 closes flat less costs.
    // Sell: 2 oz from 100 lose $1 each; the added 2.714 oz from 101 close flat; all pay costs.
    const sellOz = 2 + 2 * OWL.factor
    expect(r.pnl).toBeCloseTo(2 * (1 - cost) - 2 * cost - 2 - sellOz * cost, 9)
    expect(r.maxOz).toBeCloseTo(sellOz, 9)
  })
  it('a run against one side hits the account stop, and in caution a closed side does not start again', () => {
    // A $100 account: caution at -$2, stop at -$4. Price runs from 100 to 102.
    const r = gridEvening(legs([100, 101, 102]), 100, cost)
    const sellOz = 2 + 2 * OWL.factor + 2 * OWL.factor ** 2
    expect(r.stopped).toBe(true)
    expect(r.closes).toBe(2)
    expect(r.pnl).toBeCloseTo(2 * 2 * (1 - cost) - (2 * 2 + 2 * OWL.factor) - sellOz * cost, 9)
    expect(r.pnl).toBeLessThan(-4)
  })
  it('added trades never pass the 0.5 lot cap', () => {
    const r = gridEvening(legs([100, 130]), 1e9, cost)
    expect(r.stopped).toBe(false)
    // 30 added sells: the sizes grow by 1.357 until they reach 50 ounces.
    let oz = 0
    let size: number = OWL.firstOz
    for (let n = 0; n <= 30; n++) {
      oz += size
      size = Math.min(OWL.maxOz, size * OWL.factor)
    }
    expect(r.maxOz).toBeCloseTo(oz, 6)
  })
  it('a quiet evening that never moves a dollar costs only the costs of the two first trades', () => {
    const r = gridEvening(legs([100, 100.4, 99.7, 100.1]), OWL.startMoney, cost)
    expect(r.closes).toBe(0)
    expect(r.pnl).toBeCloseTo(2 * (100.1 - 100) - 2 * (100.1 - 100) - 4 * cost, 9)
  })
})
