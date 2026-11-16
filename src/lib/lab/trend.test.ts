import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { labMarket } from './markets'
import { trendTrades } from './trend'

const DAY = 86_400
const M = labMarket('GBPUSD')
const P = { n: 3, x: 2, stopAtr: 2 }
// Monday 2026-01-05 00:00 UTC, so no candle sits on a weekend gap.
const T0 = Date.UTC(2026, 0, 5) / 1000
/** Candles from [open, high, low, close] rows, one a day. */
const bars = (rows: number[][]): OHLCCandle[] =>
  rows.map(([open, high, low, close], i) => ({ time: T0 + i * DAY, open, high, low, close }))
const flat = (p: number) => [p, p + 1, p - 1, p]
const atr = (n: number) => Array(n).fill(2)

describe('trendTrades (no costs)', () => {
  it('buys the open after a close above the 3-candle high and leaves after a close under the 2-candle low', () => {
    const c = bars([
      flat(100),
      flat(100),
      flat(100),
      [100, 103, 100, 103], // closes above 101: signal
      [103, 108, 106, 108], // fill at 103, stop 99
      [108, 112, 107, 112],
      [112, 113, 105, 105.5], // closes under min(106, 107): leave
      [105, 106, 104, 105], // exit at the open 105
      flat(105),
    ])
    const [t] = trendTrades(c, atr(c.length), P, M, DAY, 0)
    expect(t).toMatchObject({ direction: 'long', entry: 103, stop: 99, exit: 105, why: 'channel' })
    expect(t.entryTime).toBe(c[4].time)
    expect(t.exitTime).toBe(c[7].time)
    expect(t.r).toBeCloseTo(0.5)
  })

  it('a stop-out costs 1R, and a gap past the stop fills at the open', () => {
    const base = [flat(100), flat(100), flat(100), [100, 103, 100, 103]]
    const hit = bars([...base, [103, 104, 98, 100], flat(100)])
    expect(trendTrades(hit, atr(6), P, M, DAY, 0)[0]).toMatchObject({ why: 'stop', exit: 99 })
    expect(trendTrades(hit, atr(6), P, M, DAY, 0)[0].r).toBeCloseTo(-1)
    const gap = bars([...base, [103, 104, 102, 103], [97, 98, 96, 97], flat(97)])
    const [g] = trendTrades(gap, atr(7), P, M, DAY, 0)
    expect(g).toMatchObject({ why: 'stop', exit: 97 })
    expect(g.r).toBeCloseTo(-1.5)
  })

  it('sells a close below the 3-candle low', () => {
    const c = bars([
      flat(100),
      flat(100),
      flat(100),
      [100, 100, 97, 97],
      [97, 97, 92, 92],
      flat(92),
    ])
    const [t] = trendTrades(c, atr(c.length), P, M, DAY, 0)
    expect(t).toMatchObject({ direction: 'short', entry: 97, stop: 101 })
  })

  it('the luck value is half the gap to the mirrored trade', () => {
    const c = bars([
      flat(100),
      flat(100),
      flat(100),
      [100, 103, 100, 103],
      [103, 108, 106, 108], // the mirrored short (stop 107) is stopped here: -1R
      [108, 112, 107, 112],
      [112, 113, 105, 105.5],
      [105, 106, 104, 105],
      flat(105),
    ])
    const [t] = trendTrades(c, atr(c.length), P, M, DAY, 0)
    expect(t.d).toBeCloseTo((0.5 - -1) / 2)
  })

  it('one position at a time: no second entry while the first runs', () => {
    const c = bars([
      flat(100),
      flat(100),
      flat(100),
      [100, 103, 100, 103],
      [103, 108, 103, 108],
      [108, 112, 108, 112], // another breakout close, but the trade is open
      [112, 116, 112, 116],
      flat(116),
    ])
    expect(trendTrades(c, atr(c.length), P, M, DAY, 0)).toHaveLength(1)
  })
})

describe('trendTrades (with costs)', () => {
  it('costs make the same trade worse', () => {
    const c = bars(
      [
        flat(100),
        flat(100),
        flat(100),
        [100, 103, 100, 103],
        [103, 108, 106, 108],
        [108, 112, 107, 112],
        [112, 113, 105, 105.5],
        [105, 106, 104, 105],
        flat(105),
      ].map((r) => r.map((v) => v / 100)),
    )
    const a = Array(c.length).fill(0.02)
    const free = trendTrades(c, a, P, M, DAY, 0)[0]
    const paid = trendTrades(c, a, P, M, DAY, 1)[0]
    expect(paid.r).toBeLessThan(free.r)
    expect(paid.entry).toBeGreaterThan(free.entry)
    expect(paid.nights).toBeGreaterThan(0)
  })
})
