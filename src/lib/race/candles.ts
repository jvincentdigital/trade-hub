import type { OHLCCandle } from '../types/market'
import type { RuleTimeframe } from '../rules/schema'

export const TF_HOURS: Record<RuleTimeframe, number> = { '1h': 1, '4h': 4, '1d': 24 }

/** Drop a candle that has not finished yet (its period ends after `nowSec`). */
export function closedOnly(candles: OHLCCandle[], hours: number, nowSec: number): OHLCCandle[] {
  const last = candles[candles.length - 1]
  return last && last.time + hours * 3600 > nowSec ? candles.slice(0, -1) : candles
}
