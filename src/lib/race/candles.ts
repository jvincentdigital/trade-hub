import type { OHLCCandle } from '../types/market'
import type { RuleTimeframe } from '../rules/schema'

export const TF_HOURS: Record<RuleTimeframe, number> = { '1h': 1, '4h': 4, '1d': 24 }

/** Drop a candle that has not finished yet (its period ends after `nowSec`). */
export function closedOnly(candles: OHLCCandle[], hours: number, nowSec: number): OHLCCandle[] {
  const last = candles[candles.length - 1]
  return last && last.time + hours * 3600 > nowSec ? candles.slice(0, -1) : candles
}

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
})

/**
 * True while the real forex market is shut: Friday 17:00 to Sunday 17:00 New
 * York time (22:00 to 22:00 UTC in winter, 21:00 to 21:00 in summer; Intl
 * follows US daylight saving). Kraken's forex books keep printing then, thinly,
 * so the race neither opens nor closes forex trades on those prints.
 */
export function forexClosed(sec: number): boolean {
  const parts = NY.formatToParts(new Date(sec * 1000))
  const day = parts.find((p) => p.type === 'weekday')?.value
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  return day === 'Sat' || (day === 'Fri' && hour >= 17) || (day === 'Sun' && hour < 17)
}

/** Forex candles that start while the market is shut, left out. The Sunday reopen candle stays. */
export const dropClosedForex = (candles: OHLCCandle[]): OHLCCandle[] =>
  candles.filter((c) => !forexClosed(c.time))

/** How far past the second source's range a price may sit: 0.04%, about 5 pips on GBP/USD. */
export const CROSS_TOL = 0.0004

export interface CrossChecked {
  candles: OHLCCandle[]
  /** Candles whose prices were pulled back into the second source's range. */
  trimmed: number
  /** Start times of candles the second source does not have (left as they were). */
  unmatched: number[]
}

/**
 * Candles from a thin feed trimmed to what a second source also saw (John,
 * 2026-11-16). Kraken's GBP/USD book printed a high of 1.3471 on 2026-11-12
 * while the market's high was about 1.3272; the spike cap left 1.3318, and
 * John's London v1 built its only trade on that move. Each candle with a
 * same-time candle in `second` gets its four prices clamped into that
 * candle's low-to-high range, widened by `tol` of the price. The two feeds
 * sit a few pips apart all the time (Kraken about 3 under Yahoo), so `second`
 * is first shifted by the median difference of the closes. Pure, tested.
 */
export function crossCheck(
  main: OHLCCandle[],
  second: OHLCCandle[],
  tol = CROSS_TOL,
): CrossChecked {
  const byTime = new Map(second.map((c) => [c.time, c]))
  const diffs = main
    .flatMap((c) => (byTime.has(c.time) ? [c.close - byTime.get(c.time)!.close] : []))
    .sort((a, b) => a - b)
  const shift = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  let trimmed = 0
  const unmatched: number[] = []
  const candles = main.map((c) => {
    const s = byTime.get(c.time)
    if (!s) {
      unmatched.push(c.time)
      return c
    }
    const lo = s.low + shift - tol * s.close
    const hi = s.high + shift + tol * s.close
    const fit = (v: number) => Math.min(hi, Math.max(lo, v))
    const out = { ...c, open: fit(c.open), high: fit(c.high), low: fit(c.low), close: fit(c.close) }
    if (out.open !== c.open || out.high !== c.high || out.low !== c.low || out.close !== c.close)
      trimmed++
    return out
  })
  return { candles, trimmed, unmatched }
}
