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
