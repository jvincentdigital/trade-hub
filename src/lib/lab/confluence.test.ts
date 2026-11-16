import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { emaSeries, withTrend } from './confluence'
import type { FibPlan } from './fibAnchors'

const H = 3600
const bars = (closes: number[], step = H): OHLCCandle[] =>
  closes.map((close, i) => ({ time: i * step, open: close, high: close, low: close, close }))
const plan = (i: number, direction: 'long' | 'short'): FibPlan => ({
  entry: { i, kind: 'market', direction, stop: 0, target: 0, signalTime: 0 },
  setup: i,
  dist: 1,
  total: 1,
  one: 0,
  zero: 0,
})

describe('emaSeries', () => {
  it('starts at the first close and moves toward new closes', () => {
    const e = emaSeries(bars([10, 10, 20]), 3)
    expect(e[0]).toBe(10)
    expect(e[1]).toBe(10)
    expect(e[2]).toBe(15) // k = 0.5
  })
})

describe('withTrend', () => {
  // Rising closes: the fast EMA sits above the slow one.
  const up = bars(Array.from({ length: 12 }, (_, i) => 100 + i))

  it('keeps buys in an uptrend and drops sells', () => {
    const kept = withTrend([plan(10, 'long'), plan(10, 'short')], up, up, H, 2, 4)
    expect(kept.map((p) => p.entry.direction)).toEqual(['long'])
  })

  it('keeps sells in a downtrend', () => {
    const down = bars(Array.from({ length: 12 }, (_, i) => 100 - i))
    const kept = withTrend([plan(10, 'long'), plan(10, 'short')], down, down, H, 2, 4)
    expect(kept.map((p) => p.entry.direction)).toEqual(['short'])
  })

  it('drops a plan before the slow average has enough closed candles', () => {
    expect(withTrend([plan(3, 'long')], up, up, H, 2, 4)).toEqual([])
    expect(withTrend([plan(4, 'long')], up, up, H, 2, 4)).toHaveLength(1)
  })

  it('reads the trend only from Fib-chart candles that closed before the entry', () => {
    // Fib chart in 4-hour candles: down for 6, then one big up candle still forming at the entry.
    const setup = bars([100, 99, 98, 97, 96, 95, 120], 4 * H)
    const entry = bars(
      Array.from({ length: 28 }, () => 100),
      H,
    )
    // Entry at hour 25 is inside the 7th Fib candle (hours 24 to 28): it must not count.
    expect(withTrend([plan(25, 'short')], setup, entry, 4 * H, 2, 4)).toHaveLength(1)
    expect(withTrend([plan(25, 'long')], setup, entry, 4 * H, 2, 4)).toHaveLength(0)
  })
})
