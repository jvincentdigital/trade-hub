// Three confirmations (docs/confluence-study.md): the trend filter that sits
// on top of the Fib plans of fibAnchors.ts. The level and the bounce are
// planFib's own entry modes (R786, CONF2). Pure, tested.

import type { OHLCCandle } from '../types/market'
import type { FibPlan } from './fibAnchors'

/** EMA of the closes, seeded with the first close; one value per candle. */
export function emaSeries(c: OHLCCandle[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let e = NaN
  for (const b of c) {
    e = Number.isNaN(e) ? b.close : b.close * k + e * (1 - k)
    out.push(e)
  }
  return out
}

/**
 * Plans whose direction agrees with the trend on the Fib chart: at the last
 * `setup` candle that closed before the plan's entry candle opens, the fast
 * EMA is above the slow one for a buy and under it for a sell. A plan before
 * `slow` setup candles have closed is dropped (the averages are not warm).
 */
export function withTrend(
  plans: FibPlan[],
  setup: OHLCCandle[],
  entry: OHLCCandle[],
  setupSec: number,
  fast: number,
  slow: number,
): FibPlan[] {
  const f = emaSeries(setup, fast)
  const s = emaSeries(setup, slow)
  let p = -1
  return [...plans]
    .sort((a, b) => a.entry.i - b.entry.i)
    .filter((plan) => {
      const t = entry[plan.entry.i].time
      while (p + 1 < setup.length && setup[p + 1].time + setupSec <= t) p++
      if (p < slow - 1) return false
      return plan.entry.direction === 'long' ? f[p] > s[p] : f[p] < s[p]
    })
}
