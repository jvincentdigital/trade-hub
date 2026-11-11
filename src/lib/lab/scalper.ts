// Consolidation scalper (John, 2026-11-10: "range edges + reversal candle,
// tight stop, quick target; stop when the range breaks"). Pure, tested.
//
// - Range: the high and low of the 20 candles before the signal candle.
// - Squeeze: the Bollinger band width (20, 2) of the candle before is in the
//   lowest `squeeze` share of its last 200 values (0.2 = lowest 20%).
// - Fade the edges: a buy when the signal candle reaches the bottom 15% of the
//   range, closes back inside it (and below the middle) and is a bullish
//   reversal candle (candles.ts); a sell at the top, mirrored. Enter at the
//   next open.
// - Stop just past the edge (or the candle's own wick): a quarter ATR beyond.
// - Target: the middle of the range, or the far edge (90% of the way across).
// - Skip when the target is less than 1x the stop distance away.
// - Breakout: a close more than half an ATR outside the range ends it; no
//   fades for the next 20 candles, so a new range has to form.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { confirms } from './candles'
import type { LabEntry } from './engine'

export const RANGE_BARS = 20
export const BB_BARS = 20
export const SQUEEZE_LOOKBACK = 200
const EDGE_ZONE = 0.15
const STOP_PAD_ATR = 0.25
const BREAK_ATR = 0.5
const MIN_RR = 1

/** Bollinger band width (4 standard deviations / mean) per candle, NaN until warm. */
export function bbWidth(c: OHLCCandle[], n = BB_BARS): number[] {
  const out = new Array<number>(c.length).fill(NaN)
  let sum = 0
  let sq = 0
  for (let i = 0; i < c.length; i++) {
    sum += c[i].close
    sq += c[i].close * c[i].close
    if (i >= n) {
      sum -= c[i - n].close
      sq -= c[i - n].close * c[i - n].close
    }
    if (i >= n - 1) {
      const mean = sum / n
      const sd = Math.sqrt(Math.max(0, sq / n - mean * mean))
      out[i] = mean > 0 ? (4 * sd) / mean : NaN
    }
  }
  return out
}

/** Share of the last `lookback` widths (including this one) that are at or below this one. */
export function squeezeRank(width: number[], lookback = SQUEEZE_LOOKBACK): number[] {
  const out = new Array<number>(width.length).fill(NaN)
  for (let i = lookback - 1; i < width.length; i++) {
    const w = width[i]
    if (!Number.isFinite(w)) continue
    let below = 0
    let n = 0
    for (let x = i - lookback + 1; x <= i; x++) {
      if (!Number.isFinite(width[x])) continue
      n++
      if (width[x] <= w) below++
    }
    out[i] = n ? below / n : NaN
  }
  return out
}

export interface Range {
  high: number
  low: number
}

/** The range of the `bars` candles before candle j. */
export function rangeBefore(c: OHLCCandle[], j: number, bars = RANGE_BARS): Range | null {
  if (j < bars) return null
  let high = -Infinity
  let low = Infinity
  for (let x = j - bars; x < j; x++) {
    if (c[x].high > high) high = c[x].high
    if (c[x].low < low) low = c[x].low
  }
  return high > low ? { high, low } : null
}

export interface ScalperOptions {
  /** 0 = target the middle of the range, 1 = the far edge. */
  far: 0 | 1
  /** Squeeze threshold, 0.2 or 0.35. */
  squeeze: number
  confirmations: Int8Array
  atr?: number[]
  /** Precomputed squeeze ranks (squeezeRank(bbWidth(c))). */
  ranks?: number[]
}

export function scalper(c: OHLCCandle[], o: ScalperOptions): LabEntry[] {
  const atr = o.atr ?? atrSeries(c, 14)
  const ranks = o.ranks ?? squeezeRank(bbWidth(c))
  const out: LabEntry[] = []
  let blockedUntil = -1
  for (let j = RANGE_BARS; j < c.length - 1; j++) {
    const r = rangeBefore(c, j)
    const a = atr[j]
    if (!r || !(a > 0)) continue
    const b = c[j]
    if (b.close > r.high + BREAK_ATR * a || b.close < r.low - BREAK_ATR * a) {
      blockedUntil = j + RANGE_BARS
      continue
    }
    if (j <= blockedUntil || !(ranks[j - 1] <= o.squeeze)) continue
    const w = r.high - r.low
    const mid = r.low + w / 2
    for (const long of [true, false]) {
      const atEdge = long ? b.low <= r.low + EDGE_ZONE * w : b.high >= r.high - EDGE_ZONE * w
      const backInside = long ? b.close > r.low && b.close < mid : b.close < r.high && b.close > mid
      if (!atEdge || !backInside || !confirms(o.confirmations, j, long)) continue
      const stop = long
        ? Math.min(r.low, b.low) - STOP_PAD_ATR * a
        : Math.max(r.high, b.high) + STOP_PAD_ATR * a
      const target = o.far ? (long ? r.low + 0.9 * w : r.high - 0.9 * w) : mid
      const risk = Math.abs(b.close - stop)
      if (Math.abs(target - b.close) < MIN_RR * risk) continue
      out.push({
        i: j + 1,
        kind: 'market',
        direction: long ? 'long' : 'short',
        stop,
        target,
        signalTime: b.time,
      })
      break
    }
  }
  return out
}
