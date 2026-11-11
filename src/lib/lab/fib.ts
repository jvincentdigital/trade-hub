// John's Fibonacci method as a bot. His words and settings: project memory
// "John's style" (2026-11-10) and docs/strategy-lab.md.
//
// SELL: after a big drop, anchor 1 at the top of the last bullish candle
// before the drop and 0 at the bottom of the drop. Sell the pullback into
// 0.786-0.886. Stop just beyond 1, half off at 0, the rest at -0.272.
// BUY is the mirror (1 at the bottom of the last bearish candle before a big
// rise, 0 at its top). Pure, tested.
//
// "Big move" (the impulse), defined so a computer can find it on closed
// candles only:
//   - the candle just closed made the lowest low (sell) or highest high (buy)
//     of the last N = 12 candles;
//   - walking back from it, "1" is the high of the most recent bullish candle
//     (sell) that no later bullish candle tops, and that is at least k x ATR(14)
//     above the low (the ATR read just before that candle, so the move itself
//     does not inflate it). A small bounce inside the drop is skipped because
//     the move from it is too small; a bearish wick above it does not move 1,
//     as in John's rule. Buys mirror this with bearish candles and lows.
// While armed, a new low moves 0 down (no entry on that candle), a trade past
// 1 cancels the setup, and it expires 24 candles after it formed.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { confirms } from './candles'
import type { LabEntry } from './engine'

/** John's TradingView levels (the 1 line is hidden on his charts). */
export const JOHN_FIB_LEVELS = [0, 0.5, 0.618, 0.786, 0.886, 1, 2, -0.272, -0.414, -0.702] as const

/** Price of a Fibonacci level: 0 and 1 are the anchors, so 0.786 is 78.6% of the way back from 0 to 1. */
export const fibLevel = (one: number, zero: number, x: number) => zero + x * (one - zero)

export const IMPULSE_BARS = 12
export const SETUP_EXPIRY_BARS = 24
/**
 * The swing version (added 2026-11-11 after checking John's two USD/JPY
 * examples on real candles, where each swing took 4 to 6 weeks of daily
 * candles): the impulse may take 40 candles, the setup lives 60 candles, and
 * "1" is the swing extreme (the highest high of those 40 candles before a
 * sell's low, the lowest low before a buy's high).
 */
export const SWING_IMPULSE_BARS = 40
export const SWING_EXPIRY_BARS = 60
/** "Just beyond 1": a quarter of an ATR past it. */
export const STOP_PAD_ATR = 0.25

export interface Impulse {
  direction: 'down' | 'up'
  /** Fib 1 and 0. */
  one: number
  zero: number
  /** Candle of the 1 anchor and the candle that set 0. */
  oneIdx: number
  zeroIdx: number
  atr: number
}

/**
 * Is there a fresh impulse ending at candle j? Down: candle j made the
 * lowest low of the last `bars`, and walking back, the last bullish candle
 * not topped by a later bullish candle is at least k x ATR above that low.
 */
export function impulseAt(
  c: OHLCCandle[],
  atr: number[],
  j: number,
  dir: 'down' | 'up',
  k: number,
  bars = IMPULSE_BARS,
  anchor: 'candle' | 'extreme' = 'candle',
): Impulse | null {
  const from = j - bars + 1
  if (from < 1) return null
  const down = dir === 'down'
  // Candle j must set the extreme of the window.
  for (let x = from; x < j; x++) {
    if (down ? c[x].low <= c[j].low : c[x].high >= c[j].high) return null
  }
  const zero = down ? c[j].low : c[j].high
  if (anchor === 'extreme') {
    // "1" = the swing extreme of the window before j.
    let o = -1
    for (let x = from; x < j; x++)
      if (o < 0 || (down ? c[x].high > c[o].high : c[x].low < c[o].low)) o = x
    if (o < 1) return null
    const lvl = down ? c[o].high : c[o].low
    const a0 = atr[o - 1]
    return a0 > 0 && Math.abs(lvl - zero) >= k * a0
      ? { direction: dir, one: lvl, zero, oneIdx: o, zeroIdx: j, atr: a0 }
      : null
  }
  // The most extreme "other way" candle seen so far, walking back from j.
  let best = down ? -Infinity : Infinity
  for (let x = j - 1; x >= from; x--) {
    const other = down ? c[x].close > c[x].open : c[x].close < c[x].open
    if (!other) continue
    const lvl = down ? c[x].high : c[x].low
    if (down ? lvl < best : lvl > best) continue
    best = lvl
    const a0 = atr[x - 1]
    if (a0 > 0 && Math.abs(lvl - zero) >= k * a0)
      return { direction: dir, one: lvl, zero, oneIdx: x, zeroIdx: j, atr: a0 }
  }
  return null
}

export interface FibOptions {
  /** Impulse size in ATRs. */
  k: number
  /** Entry level: 0.786 or 0.886 (or the zone edge a confirming candle must reach). */
  entry: number
  /** Wait for a reversal candle in the zone, then enter at the next open. */
  confirm?: boolean
  /** Per-candle confirmation series (confirmationSeries), needed with `confirm`. */
  confirmations?: Int8Array
  /** Spread at a price: a buy limit fills when the ASK (bid + spread) reaches it. */
  spreadOf?: (price: number) => number
  /** Only fill on candles where this returns true (London session, London direction, trend). */
  allow?: (i: number, long: boolean) => boolean
  /** Precomputed ATR(14) (atrSeries). */
  atr?: number[]
  /** Swing version: SWING_IMPULSE_BARS, SWING_EXPIRY_BARS and the swing extreme as 1. */
  swing?: boolean
}

interface Armed extends Impulse {
  armedAt: number
}

/** Every trade John's Fib would plan on these candles (both directions). */
export function johnsFib(c: OHLCCandle[], o: FibOptions): LabEntry[] {
  const atr = o.atr ?? atrSeries(c, 14)
  const bars = o.swing ? SWING_IMPULSE_BARS : IMPULSE_BARS
  const expiry = o.swing ? SWING_EXPIRY_BARS : SETUP_EXPIRY_BARS
  const anchor = o.swing ? 'extreme' : 'candle'
  const out: LabEntry[] = []
  for (const dir of ['down', 'up'] as const) {
    const long = dir === 'up'
    let s: Armed | null = null
    for (let j = 1; j < c.length; j++) {
      const b = c[j]
      if (s && j > s.armedAt) {
        let entered = false
        const extends0 = long ? b.high > s.zero : b.low < s.zero
        if (extends0) {
          s.zero = long ? b.high : b.low
          s.zeroIdx = j
        } else {
          const lvl = fibLevel(s.one, s.zero, o.entry)
          const pad = STOP_PAD_ATR * s.atr
          const stop = long ? s.one - pad : s.one + pad
          const target1 = s.zero
          const target = fibLevel(s.one, s.zero, -0.272)
          const allowed = !o.allow || o.allow(j, long)
          if (!o.confirm) {
            // Limit order at the level: a sell fills when the bid reaches it,
            // a buy when the ask does; a candle opening past it fills at the open.
            const spread = o.spreadOf ? o.spreadOf(b.open) : 0
            const touched = long ? b.low + spread <= lvl : b.high >= lvl
            if (touched && allowed) {
              const price = long ? Math.min(lvl, b.open + spread) : Math.max(lvl, b.open)
              out.push({
                i: j,
                kind: 'limit',
                price,
                direction: long ? 'long' : 'short',
                stop,
                target,
                target1,
                part1: 0.5,
                signalTime: b.time,
              })
              entered = true
            }
          } else {
            const touched = long ? b.low <= lvl : b.high >= lvl
            const beyondOne = long ? b.low < s.one : b.high > s.one
            if (
              touched &&
              !beyondOne &&
              allowed &&
              o.confirmations &&
              confirms(o.confirmations, j, long) &&
              j + 1 < c.length
            ) {
              out.push({
                i: j + 1,
                kind: 'market',
                direction: long ? 'long' : 'short',
                stop,
                target,
                target1,
                part1: 0.5,
                signalTime: b.time,
              })
              entered = true
            }
          }
        }
        const broken = long ? b.low < s.one : b.high > s.one
        if (entered || broken || j - s.armedAt >= expiry) s = null
      }
      if (!s) {
        const imp = impulseAt(c, atr, j, dir, o.k, bars, anchor)
        if (imp) s = { ...imp, armedAt: j }
      }
    }
  }
  return out.sort((a, b) => a.i - b.i)
}
