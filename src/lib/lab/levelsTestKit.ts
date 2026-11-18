// Levels study: helpers for the unit tests (hand-made candles and a context
// with a fixed ATR in force). Not part of the engine.

import type { Bars, MarketCosts } from './harmonicFind'
import { levelsContext, type LevelsCtx } from './levelsWatch'

/** Monday 2015-01-05 12:00 UTC (07:00 New York). */
export const T = Date.UTC(2015, 0, 5, 12) / 1000

/** Test costs in plain units with exact binary fractions. */
export const TESTC: MarketCosts = {
  market: 'EURUSD',
  pip: 1,
  pen: 0.25,
  slip: 0.125,
  comm: 0,
  spreadAt: () => 0.5,
}

/** [high, low] or [high, low, close] or [open, high, low, close]; one minute apart from T unless a time is given. */
export type Row = number[]
export function barsOf(rows: Row[], times?: number[]): Bars {
  const o: number[] = []
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  for (const r of rows) {
    // [high, low]: open and close in the middle; [high, low, close]: opens at the close.
    const [op, hi, lo, cl] =
      r.length === 2
        ? [(r[0] + r[1]) / 2, r[0], r[1], (r[0] + r[1]) / 2]
        : r.length === 3
          ? [r[2], r[0], r[1], r[2]]
          : r
    o.push(op)
    h.push(hi)
    l.push(lo)
    c.push(cl)
  }
  const time = times ?? rows.map((_, i) => T + 60 * i)
  return {
    n: rows.length,
    time: Float64Array.from(time),
    open: Float64Array.from(o),
    high: Float64Array.from(h),
    low: Float64Array.from(l),
    close: Float64Array.from(c),
  }
}

/** A context whose ATR in force is `atr` on every day (10: g = 2.5, distances 1, 2.5, 5, 10). */
export function ctxOf(b: Bars, atr = 10, costs = TESTC): LevelsCtx {
  const base = levelsContext(b, 'EURUSD')
  return { ...base, inForce: new Float64Array(base.days.n).fill(atr), f15: 0, costs }
}
