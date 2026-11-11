// Strategy lab: candle confirmation (John's books: morning/evening star,
// engulfing, pin bars, hammers) and small indicator helpers. Uses the
// race's own detectors (src/lib/patterns) on a short window per candle, so a
// year of 5-minute candles stays fast (detectAll copies the whole history at
// every candle). Pure, tested.

import type { OHLCCandle } from '../types/market'
import type { PatternResult } from '../types/market'
import * as P from '../patterns/patterns'
import { ema } from '../scanner/mmConfluence'

const body = (c: OHLCCandle) => Math.abs(c.close - c.open)
const range = (c: OHLCCandle) => c.high - c.low

/** Pin bar: the rejection wick is at least 2x the body and 60% of the candle, the other wick at most 25%. */
export function pinBar(c: OHLCCandle): 'bullish' | 'bearish' | null {
  const r = range(c)
  if (!(r > 0)) return null
  const upper = c.high - Math.max(c.open, c.close)
  const lower = Math.min(c.open, c.close) - c.low
  const b = body(c)
  if (lower >= 2 * b && lower >= 0.6 * r && upper <= 0.25 * r) return 'bullish'
  if (upper >= 2 * b && upper >= 0.6 * r && lower <= 0.25 * r) return 'bearish'
  return null
}

export const CONFIRM_NAMES = {
  bullish: [
    'Morning Star',
    'Bullish Engulfing',
    'Hammer',
    'Inverted Hammer',
    'Dragonfly Doji',
    'Piercing Line',
    'Tweezer Bottom',
    'Pin bar',
  ],
  bearish: [
    'Evening Star',
    'Bearish Engulfing',
    'Shooting Star',
    'Hanging Man',
    'Gravestone Doji',
    'Dark Cloud Cover',
    'Tweezer Top',
    'Pin bar',
  ],
}

/** Reversal patterns on candle i (the detectors only read the last 3 candles of history). */
export function confirmationsAt(candles: OHLCCandle[], i: number): PatternResult[] {
  const c = candles[i]
  if (i < 2 || !c || range(c) === 0) return []
  const p1 = candles[i - 1]
  const p2 = candles[i - 2]
  const hist = candles.slice(Math.max(0, i - 5), i)
  const hits = [
    P.detectHammer(c, hist),
    P.detectInvertedHammer(c, hist),
    P.detectHangingMan(c, hist),
    P.detectShootingStar(c, hist),
    P.detectDragonflyDoji(c),
    P.detectGravestoneDoji(c),
  ]
  if (range(p1) > 0)
    hits.push(
      P.detectBullishEngulfing(c, p1),
      P.detectBearishEngulfing(c, p1),
      P.detectPiercingLine(c, p1),
      P.detectDarkCloudCover(c, p1),
      P.detectTweezers(c, p1),
    )
  if (range(p1) > 0 && range(p2) > 0)
    hits.push(P.detectMorningStar(c, p1, p2), P.detectEveningStar(c, p1, p2))
  return hits.filter((h): h is PatternResult => !!h)
}

/** Per candle: +1 bullish confirmation, -1 bearish, 2 both, 0 none. */
export function confirmationSeries(candles: OHLCCandle[]): Int8Array {
  const out = new Int8Array(candles.length)
  for (let i = 0; i < candles.length; i++) {
    let bull = false
    let bear = false
    for (const h of confirmationsAt(candles, i)) {
      if (h.type === 'bullish') bull = true
      if (h.type === 'bearish') bear = true
    }
    const pin = pinBar(candles[i])
    if (pin === 'bullish') bull = true
    if (pin === 'bearish') bear = true
    out[i] = bull && bear ? 2 : bull ? 1 : bear ? -1 : 0
  }
  return out
}

/** Does candle i confirm a trade in this direction? */
export const confirms = (series: Int8Array, i: number, long: boolean) =>
  series[i] === 2 || series[i] === (long ? 1 : -1)

/** EMA aligned to candle indexes (NaN until warm). */
export function emaAligned(values: number[], period: number): number[] {
  const raw = ema(values, period)
  return [...Array<number>(values.length - raw.length).fill(NaN), ...raw]
}

/**
 * Higher-timeframe trend for each lower-timeframe candle: +1 when the last
 * HIGHER candle that had closed by this candle's close was above its EMA,
 * -1 below, 0 unknown. Never reads a higher candle still forming.
 */
export function htfTrend(
  ltf: OHLCCandle[],
  ltfSec: number,
  htf: OHLCCandle[],
  htfSec: number,
  period = 50,
): Int8Array {
  const e = emaAligned(
    htf.map((c) => c.close),
    period,
  )
  const out = new Int8Array(ltf.length)
  let h = -1
  for (let i = 0; i < ltf.length; i++) {
    const closeAt = ltf[i].time + ltfSec
    while (h + 1 < htf.length && htf[h + 1].time + htfSec <= closeAt) h++
    if (h < 0 || !Number.isFinite(e[h])) continue
    out[i] = htf[h].close > e[h] ? 1 : htf[h].close < e[h] ? -1 : 0
  }
  return out
}
