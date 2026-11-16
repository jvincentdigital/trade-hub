// John's Fib anchor study (docs/fib-anchor-study.md). Five ways to place "1"
// and five ways to enter at his 0.786 to 0.886 area, with the Fib drawn on one
// chart and the entries read on a smaller one (his 4-hour Fib, 1-hour entries).
// "0", the size test, the stop and the setup's life are the same for every
// anchor, so only the anchor differs. Pure, tested. Play money research only.
//
// SELL wording (BUY is the mirror). A setup starts when a closed candle j of
// the Fib chart makes the lowest low of the last `bars` candles; 0 = that low.
//   A  the lab's rule (fib.ts): the high of the most recent up candle that no
//      later up candle tops.
//   D  the swing extreme: the highest high of the window.
// The "first big candle of the move" f = the first DOWN candle at or after the
// swing-high candle whose body is at least BIG_BODY_ATR x ATR(14). It is the
// candle John anchored on in both drawn sells (USD/JPY daily 07-30, GBP/USD
// 4-hour 11-05 06:00 UTC).
//   B  the high of the last up candle before f (his written rule as first read).
//   C  the high of f (his USD/JPY screenshot: 163.738).
//   E  the OPEN of f (his screen recording: 1.3488 on GBP/USD, not the wick).
// Every anchor needs |1 - 0| >= k x ATR(14) read just before the anchor candle.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import type { LabEntry } from './engine'
import { fibLevel, impulseAt, STOP_PAD_ATR, type Impulse } from './fib'

export const ANCHORS = ['A', 'B', 'C', 'D', 'E'] as const
export type Anchor = (typeof ANCHORS)[number]

/** A "big" candle: body of at least this many ATRs (fits both of John's drawn sells: 0.87 and 6.13, with 0.67 before). */
export const BIG_BODY_ATR = 0.75
/** A "good strong candle": closes his way with a body of at least half an ATR (fixed in COMPARE.md before any run). */
export const STRONG_BODY_ATR = 0.5

export function anchorImpulse(
  c: OHLCCandle[],
  atr: number[],
  j: number,
  dir: 'down' | 'up',
  k: number,
  bars: number,
  anchor: Anchor,
): Impulse | null {
  if (anchor === 'A') return impulseAt(c, atr, j, dir, k, bars, 'candle')
  if (anchor === 'D') return impulseAt(c, atr, j, dir, k, bars, 'extreme')
  const from = j - bars + 1
  if (from < 1) return null
  const down = dir === 'down'
  for (let x = from; x < j; x++) {
    if (down ? c[x].low <= c[j].low : c[x].high >= c[j].high) return null
  }
  const zero = down ? c[j].low : c[j].high
  // The swing extreme of the window before j (as the lab's 'extreme').
  let o = -1
  for (let x = from; x < j; x++)
    if (o < 0 || (down ? c[x].high > c[o].high : c[x].low < c[o].low)) o = x
  if (o < 1) return null
  // The first big candle of the move, from the swing extreme to j.
  let f = -1
  for (let x = o; x <= j; x++) {
    const body = down ? c[x].open - c[x].close : c[x].close - c[x].open
    if (atr[x - 1] > 0 && body >= BIG_BODY_ATR * atr[x - 1]) {
      f = x
      break
    }
  }
  if (f < 0) return null
  let oneIdx = f
  let one: number
  if (anchor === 'C') one = down ? c[f].high : c[f].low
  else if (anchor === 'E') one = c[f].open
  else {
    oneIdx = -1
    for (let x = f - 1; x >= from; x--) {
      if (down ? c[x].close > c[x].open : c[x].close < c[x].open) {
        oneIdx = x
        break
      }
    }
    if (oneIdx < 1) return null
    one = down ? c[oneIdx].high : c[oneIdx].low
  }
  const a0 = atr[oneIdx - 1]
  if (!(a0 > 0) || !(down ? one - zero >= k * a0 : zero - one >= k * a0)) return null
  return { direction: dir, one, zero, oneIdx, zeroIdx: j, atr: a0 }
}

export const ENTRY_MODES = ['R786', 'R886', 'HALVES', 'CONF2', 'CONT'] as const
/**
 * R786 / R886: all at once, a resting order at that level (reversal).
 * HALVES: his "0.05 here and 0.05 here": the same size at 0.786 and at 0.886, one stop.
 * CONF2: price reached 0.786, then two strong candles in a row his way; in at the next open.
 * CONT: a candle closes beyond 0.786; trade WITH that move at the next open (against his trade).
 */
export type EntryMode = (typeof ENTRY_MODES)[number]
export const EXIT_MODES = ['XJ', 'X2R'] as const
/** XJ: half off at 0, the rest at -0.272 (CONT: the same distances mirrored). X2R: everything off at 2R. */
export type ExitMode = (typeof EXIT_MODES)[number]

export interface PlanOptions {
  anchor: Anchor
  k: number
  /** Look-back of the move and life of the setup, in Fib-chart candles. */
  bars: number
  expiry: number
  entry: EntryMode
  exit: ExitMode
  /** Length of a Fib-chart candle in seconds (it has closed once an entry candle opens at or after its end). */
  setupSec: number
  /** Spread at a price: a buy order at a level fills when the ASK reaches it. */
  spreadOf?: (price: number) => number
  atrSetup?: number[]
  atrEntry?: number[]
}

export interface FibPlan {
  entry: LabEntry
  /** Legs of one trade share a setup number. */
  setup: number
  /** This leg's planned distance to the stop, and the whole trade's (both halves). R of the trade = sum(leg R x dist) / total. */
  dist: number
  total: number
  one: number
  zero: number
}

interface Live extends Impulse {
  armed: number
  id: number
  leg1: boolean
  /** Entry-chart candle of the first fill or of the first touch (CONF2). */
  mark: number
}

/**
 * Every trade the method plans. Setups come from closed `setup` candles;
 * fills are read on `entry` candles (pass the same array twice for one chart).
 * While a setup waits, a new low moves 0 (no entry on that candle), a trade
 * past 1 cancels it, and it dies `expiry` Fib-chart candles after it formed.
 * With the same chart, anchor A, R786 or R886 and XJ this is fib.ts's johnsFib.
 */
export function planFib(setup: OHLCCandle[], entry: OHLCCandle[], o: PlanOptions): FibPlan[] {
  const atrS = o.atrSetup ?? atrSeries(setup, 14)
  const atrE = o.atrEntry ?? atrSeries(entry, 14)
  const out: FibPlan[] = []
  let ids = 0
  const strong = (i: number, long: boolean) => {
    const b = entry[i]
    const body = long ? b.close - b.open : b.open - b.close
    return atrE[i - 1] > 0 && body >= STRONG_BODY_ATR * atrE[i - 1]
  }
  for (const dir of ['down', 'up'] as const) {
    const long = dir === 'up'
    const sgn = long ? 1 : -1
    let s: Live | null = null
    let p = -1
    for (let i = 0; i < entry.length; i++) {
      const b = entry[i]
      while (p + 1 < setup.length && setup[p + 1].time + o.setupSec <= b.time) {
        p++
        if (!s) {
          const imp = anchorImpulse(setup, atrS, p, dir, o.k, o.bars, o.anchor)
          if (imp) s = { ...imp, armed: p, id: ids++, leg1: false, mark: -1 }
        }
      }
      if (!s) continue
      let done = false
      const extends0 = !s.leg1 && (long ? b.high > s.zero : b.low < s.zero)
      if (extends0) {
        s.zero = long ? b.high : b.low
      } else {
        const one = s.one
        const zero = s.zero
        const l786 = fibLevel(one, zero, 0.786)
        const l886 = fibLevel(one, zero, 0.886)
        const stop = one - sgn * STOP_PAD_ATR * s.atr
        const ext = fibLevel(one, zero, -0.272)
        const spread = o.spreadOf ? o.spreadOf(b.open) : 0
        const reach = (lvl: number) => (long ? b.low + spread <= lvl : b.high >= lvl)
        const fillAt = (lvl: number) =>
          long ? Math.min(lvl, b.open + spread) : Math.max(lvl, b.open)
        const base = { direction: long ? 'long' : 'short', stop, signalTime: b.time } as const
        /** Targets for a reversal planned from `ref`. */
        const targets = (ref: number) =>
          o.exit === 'XJ'
            ? { target: ext, target1: zero, part1: 0.5 }
            : { target: ref + sgn * 2 * Math.abs(stop - ref) }
        const limit = (lvl: number, ref: number, total: number) => {
          out.push({
            entry: { i, kind: 'limit', price: fillAt(lvl), ...base, ...targets(ref) },
            setup: s!.id,
            dist: Math.abs(stop - lvl),
            total,
            one,
            zero,
          })
        }
        if (o.entry === 'R786' || o.entry === 'R886') {
          const lvl = o.entry === 'R786' ? l786 : l886
          if (reach(lvl)) {
            limit(lvl, lvl, Math.abs(stop - lvl))
            done = true
          }
        } else if (o.entry === 'HALVES') {
          const total = Math.abs(stop - l786) + Math.abs(stop - l886)
          if (s.leg1 && i > s.mark && (long ? b.high >= zero : b.low <= zero)) done = true
          if (!done && !s.leg1 && reach(l786)) {
            limit(l786, l786, total)
            s.leg1 = true
            s.mark = i
          }
          if (!done && s.leg1 && reach(l886)) {
            limit(l886, l786, total)
            done = true
          }
        } else if (o.entry === 'CONF2') {
          const beyondOne = long ? b.low < one : b.high > one
          const touched = long ? b.low <= l786 : b.high >= l786
          if (s.mark < 0 && touched && !beyondOne) s.mark = i
          if (
            s.mark >= 0 &&
            i - 1 >= s.mark &&
            !beyondOne &&
            strong(i - 1, long) &&
            strong(i, long) &&
            i + 1 < entry.length
          ) {
            const ref = entry[i + 1].open
            if (long ? ref > stop : ref < stop)
              out.push({
                entry: { i: i + 1, kind: 'market', ...base, ...targets(ref) },
                setup: s.id,
                dist: Math.abs(stop - ref),
                total: Math.abs(stop - ref),
                one,
                zero,
              })
            done = true
          }
        } else if ((long ? b.close < l786 : b.close > l786) && i + 1 < entry.length) {
          // CONT: the pullback closed beyond 0.786, so trade with it (a sell setup becomes a buy).
          const ref = entry[i + 1].open
          const d = Math.abs(stop - l786)
          out.push({
            entry: {
              i: i + 1,
              kind: 'market',
              direction: long ? 'short' : 'long',
              stop: ref + sgn * d,
              signalTime: b.time,
              ...(o.exit === 'XJ'
                ? {
                    target: ref - sgn * Math.abs(l786 - ext),
                    target1: ref - sgn * Math.abs(l786 - zero),
                    part1: 0.5,
                  }
                : { target: ref - sgn * 2 * d }),
            },
            setup: s.id,
            dist: d,
            total: d,
            one,
            zero,
          })
          done = true
        }
      }
      const broken = long ? b.low < s.one : b.high > s.one
      if (done || broken || p + 1 - s.armed >= o.expiry) s = null
    }
  }
  return out.sort((a, b) => a.entry.i - b.entry.i)
}
