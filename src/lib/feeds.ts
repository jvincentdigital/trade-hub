import { KRAKEN_PAIRS } from './kraken'
import type { OHLCCandle } from './types/market'

// Where each market's candles come from (docs/london-open.md). Pure: no fetch
// here, so client code can ask "does this market have intraday candles?".
//
// - kraken: real exchange candles (15m, 1h, 4h, 1d) from Kraken's free OHLC.
// - cross:  computed from two other markets (GBP/JPY = GBP/USD x USD/JPY).
// - ecb:    one daily rate from the ECB (Frankfurter), highs and lows estimated.

export type Feed = 'kraken' | 'cross' | 'ecb'

/**
 * GBP/JPY is not on Kraken. It is GBP/USD (Kraken, any candle size) times
 * USD/JPY from the ECB's daily rate, because Kraken's own USD/JPY book is far
 * too thin (bid 157.36 / ask 161.50 on 2026-11-10). So inside a day it moves
 * with the pound only; yen moves show up once a day, when the ECB rate does.
 * `lagSec`: the ECB publishes around 16:00 CET, so a day's rate is only used
 * from 16:00 UTC that day on (no peeking in older candles).
 */
export const CROSSES: Record<string, { a: string; b: string; lagSec: number; label: string }> = {
  'GBP-JPY': {
    a: 'GBP-USD',
    b: 'USD-JPY',
    lagSec: 16 * 3600,
    label: "computed from GBP/USD and USD/JPY (the ECB's daily rate)",
  },
}

export function feedOf(id: string): Feed {
  if (KRAKEN_PAIRS[id]) return 'kraken'
  if (CROSSES[id]) return 'cross'
  return 'ecb'
}

/** True when the market has real 15m/1h/4h candles (Kraken or a cross built on Kraken). */
export const hasIntraday = (id: string) => feedOf(id) !== 'ecb'

/**
 * `a` x `b`, one candle per candle of `a`. The `b` candle used is the newest
 * one that started at least `lagSec` before `a`'s candle.
 * - Same start time (both intraday): open x open and close x close are exact;
 *   high x high and low x low are an approximation (the two highs may not
 *   happen at the same moment, so the real high can be a bit lower).
 * - Older `b` (a daily rate): its close multiplies all four prices.
 * Candles of `a` before the first usable `b` are left out.
 */
export function crossCandles(a: OHLCCandle[], b: OHLCCandle[], lagSec = 0): OHLCCandle[] {
  const out: OHLCCandle[] = []
  let j = -1
  for (const c of a) {
    while (j + 1 < b.length && b[j + 1].time + lagSec <= c.time) j++
    if (j < 0) continue
    const k = b[j]
    const same = lagSec === 0 && k.time === c.time
    out.push({
      time: c.time,
      open: c.open * (same ? k.open : k.close),
      high: c.high * (same ? k.high : k.close),
      low: c.low * (same ? k.low : k.close),
      close: c.close * k.close,
    })
  }
  return out
}
