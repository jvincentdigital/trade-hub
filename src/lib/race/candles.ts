import type { OHLCCandle } from '../types/market'
import type { RuleTimeframe } from '../rules/schema'

export const TF_HOURS: Record<RuleTimeframe, number> = { '1h': 1, '4h': 4, '1d': 24 }

/**
 * Merge 1h candles into bigger ones (4h, 1d) on UTC boundaries. Gives the same
 * candles as bucketing the raw hourly prices, so the race fetches each coin
 * once and every strategy reuses it.
 */
export function resample(hourly: OHLCCandle[], hours: number): OHLCCandle[] {
  if (hours <= 1) return hourly
  const size = hours * 3600
  const out: OHLCCandle[] = []
  for (const c of hourly) {
    const t = Math.floor(c.time / size) * size
    const last = out[out.length - 1]
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close })
    }
  }
  return out
}

/** Drop a candle that has not finished yet (its period ends after `nowSec`). */
export function closedOnly(candles: OHLCCandle[], hours: number, nowSec: number): OHLCCandle[] {
  const last = candles[candles.length - 1]
  return last && last.time + hours * 3600 > nowSec ? candles.slice(0, -1) : candles
}
