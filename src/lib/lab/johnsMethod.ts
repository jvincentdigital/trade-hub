// John's Method (JM), the official code for the spec
// ~/jvd-outputs/2026-11-12/johns-method/SPEC.md (section numbers in the
// comments point there). Pure: candles and news in, signals, trades and
// scores out, no IO. The runner is scripts/lab/johns-method.ts.
//
// In short (UTC unless it says London or New York): 8 markets, 1-hour BID
// candles, 4-hour and daily built on the 17:00 New York close. The Fib is
// drawn on the 4-hour (entries on the 1-hour) or on the daily (entries on the
// 4-hour). After a big move (v1's impulse test, k = 2, 12 candles) 1 = the
// open of the first candle of the move after the last opposite candle (his
// answer A) and 0 = the end of the move, which follows the move on closed
// entry candles. A closed entry candle that reaches 0.786 without passing 1
// is the signal; the trade opens at the next 1-hour open. One stop past 1 by
// half a Fib-chart ATR, half off at 0, the rest at -0.272. Two halves (0.786,
// 0.886) and one double down after two strong candles, or all at once (the
// control). Exits are walked on 1-hour candles, the stop first.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { seeded } from './control'
import { fibLevel, impulseAt } from './fib'
import { labMarket } from './markets'
import type { NewsEvent } from './news'
import { directionTest } from './stats'
import { DAY, HOUR, MIN, dayStart, londonOffset, nyOffset, utcHour, utcWeekday } from './time'

// ── Fixed numbers (section 3, "Everything else is fixed") ────────────────

export const JM = {
  k: 2,
  impulseBars: 12,
  atrPeriod: 14,
  zone1: 0.786,
  zone2: 0.886,
  tp2Level: -0.272,
  tp3Level: -0.414,
  stopPadAtr: 0.5,
  costFloorX: 10,
  rrMin: 1.5,
  noChase: 0.9,
  strongBody: 0.5,
  ladderLife: 24,
  holdFibCandles: 30,
  fillWait: 2 * HOUR,
  fullRisk: 0.02,
  halfRisk: 0.01,
  startMoney: 10_000,
  maxOpen: 5,
  maxOpenRisk: 0.1,
  sameSideMax: 2,
  marginFloor: 0.5,
  swingSide: 5,
  linesWindow: 250,
  linesKeep: 3,
  newsPad: 30 * MIN,
  /** The design-year pick (section 3). */
  pickMinTrades: 30,
  pickMaxDrawdown: 0.25,
  pickWithinR: 2,
  maxCandidates: 3,
} as const

const utc = (y: number, mo: number, d: number, h = 0) => Date.UTC(y, mo - 1, d, h) / 1000

/** Design year 1: 2024-11-11 00:00 UTC; year 2: 2025-11-11 00:00; the design years end 2026-11-11 00:00 (section 4). */
export const DESIGN_Y1 = utc(2024, 11, 11)
export const DESIGN_Y2 = utc(2025, 11, 11)
export const DESIGN_END = utc(2026, 11, 11)
/** Design warm-up may read candles from here, for indicators only. */
export const DESIGN_WARMUP = utc(2023, 9, 1)
/** The exam: 2019-01-01 22:00 UTC up to 2024-11-11 00:00. */
export const EXAM_FROM = utc(2019, 1, 1, 22)
export const EXAM_TO = DESIGN_Y1
/** The news list starts here: earlier fills are "unknown" (2.11). */
export const NEWS_FROM = utc(2024, 11, 1)
export const FREEZE_FILE = 'docs/johns-method-freeze.md'

// ── Markets and costs (2.2) ───────────────────────────────────────────────

export type JmMarketId =
  | 'EURUSD'
  | 'GBPUSD'
  | 'USDJPY'
  | 'AUDUSD'
  | 'USDCHF'
  | 'USDCAD'
  | 'NZDUSD'
  | 'XAUUSD'

/** Table order of 2.2: the order when several markets act in the same hour. */
export const JM_MARKETS: JmMarketId[] = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'AUDUSD',
  'USDCHF',
  'USDCAD',
  'NZDUSD',
  'XAUUSD',
]

export interface JmMarket {
  id: JmMarketId
  label: string
  /** Spread and slip in price units, or shares of the price when `pct` (gold). */
  spread: number
  slip: number
  pct: boolean
  /** Fee per side, a share of the position value. */
  fee: number
  leverage: number
  /** Swap a year on the position value, [long, short]. Always a charge. */
  swap: [number, number]
  /** Priced in the other currency (USDJPY, USDCHF, USDCAD): amounts are divided by the price. */
  usdBase: boolean
  /** News currencies in our list (2.2). */
  news: string[]
  /** F8's round number. */
  round: number
  /** One pip in price units (null for gold). */
  pip: number | null
}

const fromLab = (id: 'EURUSD' | 'GBPUSD' | 'USDJPY') => {
  const m = labMarket(id)
  return { spread: m.spread, slip: m.slippage, fee: m.fee, leverage: m.leverage, swap: m.swap }
}

const pair5 = (
  id: JmMarketId,
  label: string,
  spread: number,
  swap: [number, number],
  usdBase: boolean,
): JmMarket => ({
  id,
  label,
  spread,
  slip: 0.00002,
  pct: false,
  fee: 0.000025,
  leverage: 30,
  swap,
  usdBase,
  news: ['USD'],
  round: 0.01,
  pip: 0.0001,
})

export const JM_MARKET: Record<JmMarketId, JmMarket> = {
  EURUSD: {
    id: 'EURUSD',
    label: 'EUR/USD',
    ...fromLab('EURUSD'),
    pct: false,
    usdBase: false,
    news: ['EUR', 'USD'],
    round: 0.01,
    pip: 0.0001,
  },
  GBPUSD: {
    id: 'GBPUSD',
    label: 'GBP/USD',
    ...fromLab('GBPUSD'),
    pct: false,
    usdBase: false,
    news: ['GBP', 'USD'],
    round: 0.01,
    pip: 0.0001,
  },
  USDJPY: {
    id: 'USDJPY',
    label: 'USD/JPY',
    ...fromLab('USDJPY'),
    pct: false,
    usdBase: true,
    news: ['USD', 'JPY'],
    round: 1,
    pip: 0.01,
  },
  AUDUSD: pair5('AUDUSD', 'AUD/USD', 0.0001, [0.015, 0.005], false),
  USDCHF: pair5('USDCHF', 'USD/CHF', 0.00013, [0.005, 0.04], true),
  USDCAD: pair5('USDCAD', 'USD/CAD', 0.00014, [0.005, 0.02], true),
  NZDUSD: pair5('NZDUSD', 'NZD/USD', 0.00015, [0.015, 0.005], false),
  // v1's gold costs (0.040% a round trip), never labMarket('XAUUSD').
  XAUUSD: {
    id: 'XAUUSD',
    label: 'Gold',
    spread: 0.0003,
    slip: 0.0000125,
    pct: true,
    fee: 0.0000375,
    leverage: 20,
    swap: [0.05, 0.01],
    usdBase: false,
    news: ['USD'],
    round: 50,
    pip: null,
  },
}

/** "USD-" when a BUY is a bet on the dollar going down (2.2). A SELL is the other side. */
export const dollarSide = (id: JmMarketId, long: boolean): 'USD+' | 'USD-' => {
  const buyIsDown = !JM_MARKET[id].usdBase
  return long === buyIsDown ? 'USD-' : 'USD+'
}

/** Cost multipliers of one fill or one candle's checks: spread, slip and fee (fee only for the double-cost pass). */
export interface Mult {
  spread: number
  slip: number
  fee: number
}
export const NORMAL: Mult = { spread: 1, slip: 1, fee: 1 }

/**
 * The hour costs of 2.2, from the start of the 1-hour candle: rollover
 * (21:00 and 22:00 UTC) spread x4 and slip x2, 23:00 and 00:00 UTC spread
 * x1.5, the first candle after a gap spread x8 and slip x5. The larger
 * number counts.
 */
export function hourMult(t: number, afterGap: boolean): Mult {
  let spread = 1
  let slip = 1
  const h = Math.floor(utcHour(t))
  if (h === 21 || h === 22) {
    spread = Math.max(spread, 4)
    slip = Math.max(slip, 2)
  }
  if (h === 23 || h === 0) spread = Math.max(spread, 1.5)
  if (afterGap) {
    spread = Math.max(spread, 8)
    slip = Math.max(slip, 5)
  }
  return { spread, slip, fee: 1 }
}

export const scaled = (a: Mult, s: number): Mult => ({
  spread: a.spread * s,
  slip: a.slip * s,
  fee: a.fee * s,
})

export const spreadOf = (m: JmMarket, p: number, x: Mult = NORMAL) =>
  (m.pct ? m.spread * p : m.spread) * x.spread
export const slipOf = (m: JmMarket, p: number, x: Mult = NORMAL) =>
  (m.pct ? m.slip * p : m.slip) * x.slip

/** One round trip at normal hours: C(p) = spread + 2 x slip + 2 x fee x p. */
export const roundTrip = (m: JmMarket, p: number) =>
  spreadOf(m, p) + 2 * slipOf(m, p) + 2 * m.fee * p

/** Market entry at bid open p: BUY pays p + spread + slip, SELL gets p - slip. */
export const entryFill = (m: JmMarket, long: boolean, p: number, x: Mult = NORMAL) =>
  long ? p + spreadOf(m, p, x) + slipOf(m, p, x) : p - slipOf(m, p, x)

/** Forced close at a bid price: BUY gets price - slip, SELL pays price + spread + slip. */
export const forcedFill = (m: JmMarket, long: boolean, p: number, x: Mult = NORMAL) =>
  long ? p - slipOf(m, p, x) : p + spreadOf(m, p, x) + slipOf(m, p, x)

export const stopHit = (m: JmMarket, long: boolean, b: OHLCCandle, stop: number, x: Mult) =>
  long ? b.low <= stop : b.high + spreadOf(m, b.high, x) >= stop

export function stopFill(m: JmMarket, long: boolean, b: OHLCCandle, stop: number, x: Mult) {
  if (long) return b.open < stop ? b.open - slipOf(m, b.open, x) : stop - slipOf(m, stop, x)
  const ask = b.open + spreadOf(m, b.open, x)
  return ask > stop ? ask + slipOf(m, b.open, x) : stop + slipOf(m, stop, x)
}

export const targetHit = (m: JmMarket, long: boolean, b: OHLCCandle, target: number, x: Mult) =>
  long ? b.high >= target : b.low + spreadOf(m, b.low, x) <= target

/** Risk per unit to a stop, in dollars (2.10): |E - stop| + slip + fee x (E + stop), divided by the stop for USD-base pairs. */
export function riskPerUnitUsd(m: JmMarket, E: number, stop: number) {
  const r = Math.abs(E - stop) + slipOf(m, stop) + m.fee * (E + stop)
  return m.usdBase ? r / stop : r
}

/** Position value in dollars of one unit at E. */
export const valuePerUnitUsd = (m: JmMarket, E: number) => (m.usdBase ? 1 : E)

/**
 * Swap nights a part is open across (2.2): each 17:00 New York, Monday to
 * Friday, strictly after the fill; Wednesday's counts 3. An exit inside a
 * 1-hour candle is after that candle's start, so a rollover at its start
 * counts; an exit at a candle's open does not.
 */
export function swapNights(entry: number, exit: number, exitInside: boolean): number {
  let n = 0
  for (let d = dayStart(entry) - DAY; d <= exit + DAY; d += DAY) {
    const wd = utcWeekday(d)
    if (wd === 0 || wd === 6) continue
    const r = d + (17 - nyOffset(d + 20 * HOUR)) * HOUR
    if (r <= entry) continue
    if (exitInside ? r > exit : r >= exit) continue
    n += wd === 3 ? 3 : 1
  }
  return n
}

// ── Candles (2.1) ─────────────────────────────────────────────────────────

export type JmPair = 'H4H1' | 'DH4'
export type JmExpiry = 'X1' | 'X2' | 'X3'
export type JmSizing = 'C' | 'U' | 'A'
export const JM_PAIRS: JmPair[] = ['H4H1', 'DH4']
export const JM_EXPIRIES: JmExpiry[] = ['X1', 'X2', 'X3']
export const JM_SIZINGS: JmSizing[] = ['C', 'U', 'A']

export const PAIR = {
  H4H1: { fibSec: 4 * HOUR, entSec: HOUR, per: 4, label: 'H4-H1' },
  DH4: { fibSec: DAY, entSec: 4 * HOUR, per: 6, label: 'D-H4' },
} as const

/** Longest hold, in entry candles: 30 Fib candles' worth. */
export const holdCandles = (pair: JmPair) => JM.holdFibCandles * PAIR[pair].per

export const variantName = (pair: JmPair, x: JmExpiry, s: JmSizing) => `JM-${pair}-${x}-${s}`

/** True range series (2.1). */
export function trueRanges(c: OHLCCandle[]): number[] {
  return c.map((b, i) => {
    const prev = c[i - 1]?.close
    return prev == null
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev))
  })
}

/** RSI(14) with Wilder's smoothing on closes. NaN until it exists. */
export function rsiWilder(c: OHLCCandle[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN)
  let g = 0
  let l = 0
  for (let i = 1; i < c.length; i++) {
    const ch = c[i].close - c[i - 1].close
    const up = Math.max(ch, 0)
    const dn = Math.max(-ch, 0)
    if (i <= n) {
      g += up / n
      l += dn / n
      if (i < n) continue
    } else {
      g = (g * (n - 1) + up) / n
      l = (l * (n - 1) + dn) / n
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return out
}

/** Index of the last candle closed at or before T (start + sec <= T), or -1. */
export function lastClosed(c: OHLCCandle[], sec: number, T: number): number {
  let lo = 0
  let hi = c.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (c[mid].time + sec <= T) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** Index of the first candle that starts at or after t (c.length if none). */
export function firstAtOrAfter(c: OHLCCandle[], t: number): number {
  let lo = 0
  let hi = c.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (c[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface Chart {
  c: OHLCCandle[]
  sec: number
  atr: number[]
  tr: number[]
  rsi: number[]
}

const chart = (c: OHLCCandle[], sec: number): Chart => ({
  c,
  sec,
  atr: atrSeries(c, JM.atrPeriod),
  tr: trueRanges(c),
  rsi: rsiWilder(c),
})

export interface JmData {
  m: JmMarket
  h1: Chart
  h4: Chart
  d1: Chart
  /** Hour cost multipliers per 1-hour candle. */
  mult: Mult[]
}

/**
 * One market's charts. 4-hour and daily come from the 1-hour candles on the
 * 17:00 New York close (`nyCloseBars`, passed in to keep this file IO free).
 */
export function prepareJm(
  id: JmMarketId,
  h1: OHLCCandle[],
  nyBars: (h1: OHLCCandle[], sec: number) => OHLCCandle[],
): JmData {
  const mult = h1.map((b, i) => hourMult(b.time, i === 0 || b.time - h1[i - 1].time > HOUR))
  return {
    m: JM_MARKET[id],
    h1: chart(h1, HOUR),
    h4: chart(nyBars(h1, 4 * HOUR), 4 * HOUR),
    d1: chart(nyBars(h1, DAY), DAY),
    mult,
  }
}

const fibChart = (d: JmData, pair: JmPair) => (pair === 'H4H1' ? d.h4 : d.d1)
const entChart = (d: JmData, pair: JmPair) => (pair === 'H4H1' ? d.h1 : d.h4)

/** ATR of chart `ch` at its last candle closed at or before T. */
export function atrAt(ch: Chart, T: number): number {
  const k = lastClosed(ch.c, ch.sec, T)
  return k >= 0 ? ch.atr[k] : NaN
}

// ── The move and the Fib (2.4) ────────────────────────────────────────────

export interface Setup {
  long: boolean
  one: number
  zero: number
  /** Fib candle indexes: x (last opposite candle), y (1's candle), j (armed on). */
  x: number
  y: number
  j: number
  atrRef: number
}

/**
 * v1's impulse test on Fib candle j (k = 2, 12 candles; `impulseAt`), plus
 * John's anchor A: 1 = the open of the first candle of the move after x, up
 * to j. No such candle, or the move from it under 2 x ATR[x-1]: no setup.
 */
export function impulseJM(c: OHLCCandle[], atr: number[], j: number, long: boolean): Setup | null {
  const imp = impulseAt(c, atr, j, long ? 'up' : 'down', JM.k, JM.impulseBars)
  if (!imp) return null
  const x = imp.oneIdx
  for (let y = x + 1; y <= j; y++) {
    const move = long ? c[y].close > c[y].open : c[y].close < c[y].open
    if (!move) continue
    const one = c[y].open
    const size = long ? imp.zero - one : one - imp.zero
    if (size >= JM.k * imp.atr) return { long, one, zero: imp.zero, x, y, j, atrRef: imp.atr }
    return null
  }
  return null
}

/** level(f) = zero + f x (one - zero). */
export const lvl = (s: { one: number; zero: number }, f: number) => fibLevel(s.one, s.zero, f)

/** Is the setup dead by its expiry rule (2.5)? */
export function expiryDead(
  x: JmExpiry,
  per: number,
  s: { w: number; travel: number; move: number; atrRef: number },
  atrNow: number,
): boolean {
  const ok = atrNow > 0
  if (x === 'X1') {
    const W = ok ? Math.min(72, Math.max(12, Math.floor((6 * s.move) / atrNow))) : 12
    return s.w >= per * W
  }
  if (x === 'X2') return s.travel >= 8 * s.move || s.w >= per * 72
  const W = ok ? Math.min(48, Math.max(12, Math.floor((24 * s.atrRef) / atrNow))) : 24
  return s.w >= per * W
}

/** The expiry limit in entry candles at this moment (reported; X2's travel is not in it). */
export function expiryLimit(
  x: JmExpiry,
  per: number,
  move: number,
  atrRef: number,
  atrNow: number,
) {
  if (x === 'X1') return per * Math.min(72, Math.max(12, Math.floor((6 * move) / atrNow)))
  if (x === 'X2') return per * 72
  return per * Math.min(48, Math.max(12, Math.floor((24 * atrRef) / atrNow)))
}

// ── Daily lines (2.3) and the filter answers (section 5) ──────────────────

export interface Lines {
  highs: number[]
  lows: number[]
  trend: 'up' | 'down' | 'mixed'
}

/** The last 3 confirmed daily swing highs and lows among the last 250 closed daily candles, at T. */
export function dailyLines(d1: Chart, T: number): Lines {
  const c = d1.c
  const last = lastClosed(c, DAY, T)
  const highs: number[] = []
  const lows: number[] = []
  const first = Math.max(JM.swingSide, last - JM.linesWindow + 1)
  // Newest first; a swing at s is confirmed when s + 5 has closed (s + 5 <= last).
  for (let s = last - JM.swingSide; s >= first; s--) {
    let hi = highs.length < JM.linesKeep
    let lo = lows.length < JM.linesKeep
    if (!hi && !lo) break
    for (let q = 1; q <= JM.swingSide && (hi || lo); q++) {
      if (c[s - q].high >= c[s].high || c[s + q].high >= c[s].high) hi = false
      if (c[s - q].low <= c[s].low || c[s + q].low <= c[s].low) lo = false
    }
    if (hi) highs.push(c[s].high)
    if (lo) lows.push(c[s].low)
  }
  let trend: Lines['trend'] = 'mixed'
  if (highs.length >= 2 && lows.length >= 2) {
    if (highs[0] < highs[1] && lows[0] < lows[1]) trend = 'down'
    else if (highs[0] > highs[1] && lows[0] > lows[1]) trend = 'up'
  }
  return { highs, lows, trend }
}

export interface Fields {
  lineDist: number | null
  lineAtTarget: boolean
  dailyTrend: Lines['trend']
  trend252: number | null
  /** F1 to F10 (index 0 to 9). A filter that cannot be worked out is false. */
  F: boolean[]
}

export const FILTER_NAMES = [
  'F1 near a daily line',
  'F2 with the daily trend',
  'F3 London or New York hours',
  'F4 loud market',
  'F5 stop-hunt wick',
  'F6 Asian range swept',
  'F7 RSI divergence',
  'F8 round number in the zone',
  'F9 dollar basket agrees',
  'F10 right side of the weekly open',
]

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** London 07:00 and New York hh:00 on the UTC day of t, as unix seconds. */
const london7 = (t: number) => dayStart(t) + (7 - londonOffset(t)) * HOUR
const nyAt = (t: number, h: number) => dayStart(t) + (h - nyOffset(t)) * HOUR

/** The dollar basket at T (F9): the average leg, +r for USD-base pairs, -r for the others. */
export type Basket = (T: number, id: JmMarketId) => number | null

export function makeBasket(data: JmData[]): Basket {
  const legs = data.filter((d) => d.m.id !== 'XAUUSD')
  return (T, id) => {
    const rs: number[] = []
    for (const d of legs) {
      if (d.m.id === id) continue
      const k = lastClosed(d.d1.c, DAY, T)
      if (k < 20) continue
      const r = Math.log(d.d1.c[k].close / d.d1.c[k - 20].close)
      rs.push(d.m.usdBase ? r : -r)
    }
    return rs.length >= 5 ? rs.reduce((a, b) => a + b, 0) / rs.length : null
  }
}

/** Every field of 2.3 and the 10 filter answers, from candles closed at or before T. */
export function signalFields(o: {
  d: JmData
  pair: JmPair
  long: boolean
  i: number
  T: number
  one: number
  zero: number
  fillTime: number | null
  basket?: Basket
}): Fields {
  const { d, long, T } = o
  const ent = entChart(d, o.pair)
  const e = ent.c
  const i = o.i
  const L786 = lvl(o, JM.zone1)
  const L886 = lvl(o, JM.zone2)
  const zLo = Math.min(L786, L886)
  const zHi = Math.max(L786, L886)
  const dk = lastClosed(d.d1.c, DAY, T)
  const atrD = dk >= 0 ? d.d1.atr[dk] : NaN
  const lines = dailyLines(d.d1, T)
  const all = [...lines.highs, ...lines.lows]
  let lineDist: number | null = null
  if (all.length && atrD > 0) {
    lineDist = Math.min(
      ...all.map((x) =>
        x >= zLo && x <= zHi ? 0 : Math.min(Math.abs(x - zLo), Math.abs(x - zHi)),
      ),
    )
    lineDist /= atrD
  }
  const targets = [o.zero, lvl(o, JM.tp2Level), lvl(o, JM.tp3Level)]
  const lineAtTarget =
    atrD > 0 && all.some((x) => targets.some((t) => Math.abs(x - t) <= 0.25 * atrD))
  const trend252 = dk >= 252 ? Math.sign(d.d1.c[dk].close - d.d1.c[dk - 252].close) : null

  const F = new Array<boolean>(10).fill(false)
  F[0] = lineDist != null && lineDist <= 0.5
  F[1] = lines.trend === (long ? 'up' : 'down')
  const f = o.fillTime
  if (f != null) F[2] = f >= london7(f) && f < nyAt(f, 17)
  if (dk >= 119 && atrD > 0) {
    const xs = d.d1.atr.slice(dk - 119, dk + 1)
    if (xs.every((x) => Number.isFinite(x))) F[3] = atrD >= median(xs)
  }
  // F5: a wick past the 20 candles before it that closes back (c = i or i - 1).
  for (const c of [i, i - 1]) {
    if (c - 20 < 0) continue
    let ext = long ? Infinity : -Infinity
    for (let q = c - 20; q < c; q++) ext = long ? Math.min(ext, e[q].low) : Math.max(ext, e[q].high)
    if (long ? e[c].low < ext && e[c].close > ext : e[c].high > ext && e[c].close < ext) F[4] = true
  }
  // F6: the Asian range of the fill's UTC day swept between 07:00 London and the fill.
  if (f != null && f >= london7(f) && f < nyAt(f, 12)) {
    const h1 = d.h1.c
    const day = dayStart(f)
    const l7 = london7(f)
    let aHi = -Infinity
    let aLo = Infinity
    let n = 0
    let sHi = -Infinity
    let sLo = Infinity
    for (let q = firstAtOrAfter(h1, day); q < h1.length && h1[q].time < f; q++) {
      const b = h1[q]
      if (b.time + HOUR > T) break
      if (b.time < l7) {
        aHi = Math.max(aHi, b.high)
        aLo = Math.min(aLo, b.low)
        n++
      } else {
        sHi = Math.max(sHi, b.high)
        sLo = Math.min(sLo, b.low)
      }
    }
    if (n >= 5) F[5] = long ? sLo < aLo : sHi > aHi
  }
  // F7: RSI divergence on entry closes.
  if (i - 30 >= 0) {
    const pick = (a: number, b: number) => {
      let best = a
      for (let q = a; q <= b; q++)
        if (long ? e[q].low <= e[best].low : e[q].high >= e[best].high) best = q
      return best
    }
    const a = pick(i - 2, i)
    const b = pick(i - 30, i - 6)
    const ra = ent.rsi[a]
    const rb = ent.rsi[b]
    if (Number.isFinite(ra) && Number.isFinite(rb))
      F[6] = long ? e[a].low < e[b].low && ra > rb : e[a].high > e[b].high && ra < rb
  }
  // F8: a round number between the zone's ends, padded by 0.1 x ATR_D.
  if (atrD > 0) {
    const lo = zLo - 0.1 * atrD
    const hi = zHi + 0.1 * atrD
    const R = d.m.round
    F[7] = Math.ceil(lo / R - 1e-9) * R <= hi + 1e-12
  }
  // F9: the dollar basket agrees with the trade's dollar side.
  const B = o.basket?.(T, d.m.id) ?? null
  if (B != null) F[8] = dollarSide(d.m.id, long) === 'USD+' ? B > 0 : B < 0
  // F10: the signal close on the right side of the weekly open.
  {
    const h1 = d.h1.c
    let sun = dayStart(T)
    while (utcWeekday(sun) !== 0) sun -= DAY
    let wk = sun + (17 - nyOffset(sun + 20 * HOUR)) * HOUR
    if (wk > T) {
      sun -= 7 * DAY
      wk = sun + (17 - nyOffset(sun + 20 * HOUR)) * HOUR
    }
    const q = firstAtOrAfter(h1, wk)
    if (q < h1.length && h1[q].time + HOUR <= T) {
      const wOpen = h1[q].open
      F[9] = long ? e[i].close > wOpen : e[i].close < wOpen
    }
  }
  return { lineDist, lineAtTarget, dailyTrend: lines.trend, trend252, F }
}

/** 'yes' when a red event for one of the market's news currencies is within 30 minutes of t (2.11). */
export function nearRedNews(m: JmMarket, t: number, news: NewsEvent[]): 'yes' | 'no' | 'unknown' {
  if (t < NEWS_FROM) return 'unknown'
  return news.some((e) => m.news.includes(e.currency) && Math.abs(e.time - t) <= JM.newsPad)
    ? 'yes'
    : 'no'
}

// ── Signals (2.5, 2.6) ────────────────────────────────────────────────────

export type SkipWhy =
  | 'market busy'
  | 'no fill candle'
  | 'cost floor'
  | 'targets on the wrong side'
  | 'plan under 1.5R'
  | 'chase'
  | 'both sides at once'
  | 'filter'
  | 'dollar bet'
  | 'account: 5 trades open'
  | 'account: margin'
  | 'account: open risk over 10%'

export interface JmSignal {
  market: JmMarketId
  long: boolean
  pair: JmPair
  expiry: JmExpiry
  /** Entry candle index (entry chart) and its start; T = its close. */
  i: number
  sigTime: number
  T: number
  armedAt: number
  xTime: number
  yTime: number
  jTime: number
  one: number
  zero: number
  atrRef: number
  atrF: number
  w: number
  travelOverMove: number
  moveAtr: number
  limit: number
  L786: number
  L886: number
  tp1: number
  tp2: number
  S: number
  open: number
  high: number
  low: number
  close: number
  /** The signal candle itself reached 0.886: both halves together. */
  reached886: boolean
  /** The fill candle (1-hour index), its bid open and the fill. */
  fillIdx: number | null
  fillTime: number | null
  p: number | null
  E1: number | null
  reward: number | null
  planRR: number | null
  /** First failed check of 2.6 (2 to 6), or null. */
  check: SkipWhy | null
  fields: Fields
}

/** The plan of a fill against a stop (2.6 check 5): reward = half to TP1 + half to TP2. */
export function plan(E: number, S: number, tp1: number, tp2: number) {
  const reward = 0.5 * Math.abs(E - tp1) + 0.5 * Math.abs(E - tp2)
  const dist = Math.abs(E - S)
  return { reward, dist, rr: dist > 0 ? reward / dist : 0 }
}

/** No chase (2.6 check 6): at E the reward and plan RR each at least 0.9 of their value at the reference close. */
export function noChase(
  m: JmMarket,
  long: boolean,
  E: number,
  close: number,
  S: number,
  tp1: number,
  tp2: number,
) {
  const ref = long ? close + spreadOf(m, close) : close
  const r0 = plan(ref, S, tp1, tp2)
  const r1 = plan(E, S, tp1, tp2)
  const side = long ? ref - S : S - ref
  return side > 0 && r1.reward >= JM.noChase * r0.reward && r1.rr >= JM.noChase * r0.rr
}

/** Both targets on the winning side of E. */
export const targetsOk = (long: boolean, E: number, tp1: number, tp2: number) =>
  long ? tp1 > E && tp2 > E : tp1 < E && tp2 < E

/** The fill candle of a decision at T: the first 1-hour candle starting at T or within 2 hours. */
export function fillCandle(h1: OHLCCandle[], T: number): number | null {
  const k = firstAtOrAfter(h1, T)
  return k < h1.length && h1[k].time - T <= JM.fillWait ? k : null
}

interface Tracker extends Setup {
  armedAt: number
  w: number
  travel: number
}

export interface SignalRun {
  signals: JmSignal[]
  armed: number
  diedPast1: number
  diedExpiry: number
}

/**
 * Every signal of one market and structure in [from, to): trackers start
 * empty at `from`, a setup arms only on a Fib candle that closes inside the
 * window, and only entry candles closed by `to` are read.
 */
export function findSignals(o: {
  d: JmData
  pair: JmPair
  expiry: JmExpiry
  from: number
  to: number
  basket?: Basket
}): SignalRun {
  const { d, pair, expiry, from, to } = o
  const m = d.m
  const P = PAIR[pair]
  const fib = fibChart(d, pair)
  const ent = entChart(d, pair)
  const h1 = d.h1.c
  const out: JmSignal[] = []
  let armed = 0
  let diedPast1 = 0
  let diedExpiry = 0
  const tr: { [k: string]: Tracker | null } = { sell: null, buy: null }
  let fj = firstAtOrAfter(fib.c, from - P.fibSec)
  while (fj < fib.c.length && fib.c[fj].time + P.fibSec < from) fj++
  for (let i = firstAtOrAfter(ent.c, from); i < ent.c.length; i++) {
    const b = ent.c[i]
    const T = b.time + P.entSec
    if (T > to) break
    // Run 2.4 on every Fib candle closed by the start of candle i.
    while (fj < fib.c.length && fib.c[fj].time + P.fibSec <= b.time) {
      const close = fib.c[fj].time + P.fibSec
      if (close <= to)
        for (const long of [false, true]) {
          const key = long ? 'buy' : 'sell'
          if (tr[key]) continue
          const s = impulseJM(fib.c, fib.atr, fj, long)
          if (s) {
            tr[key] = { ...s, armedAt: close, w: 0, travel: 0 }
            armed++
          }
        }
      fj++
    }
    const atrNow = atrAt(fib, T)
    const fired: Tracker[] = []
    for (const long of [false, true]) {
      const key = long ? 'buy' : 'sell'
      const s = tr[key]
      if (!s || s.armedAt > b.time) continue
      let sig = false
      if (long ? b.high > s.zero : b.low < s.zero) {
        s.zero = long ? b.high : b.low
        s.w = 0
        s.travel = 0
      } else {
        s.w++
        s.travel += ent.tr[i]
        const L = lvl(s, JM.zone1)
        sig = long ? b.low <= L && b.low >= s.one : b.high >= L && b.high <= s.one
      }
      const past = long ? b.low < s.one : b.high > s.one
      const move = Math.abs(s.one - s.zero)
      const dead = expiryDead(expiry, P.per, { ...s, move }, atrNow)
      if (sig) fired.push({ ...s })
      else if (past) diedPast1++
      else if (dead) diedExpiry++
      if (sig || past || dead) tr[key] = null
    }
    if (!fired.length) continue
    let s: Tracker
    let both = false
    if (fired.length === 2) {
      both = fired[0].armedAt === fired[1].armedAt
      s = fired[0].armedAt > fired[1].armedAt ? fired[0] : fired[1]
    } else s = fired[0]
    const long = s.long
    const one = s.one
    const zero = s.zero
    const move = Math.abs(one - zero)
    const L786 = lvl(s, JM.zone1)
    const L886 = lvl(s, JM.zone2)
    const tp1 = zero
    const tp2 = lvl(s, JM.tp2Level)
    const pad = JM.stopPadAtr * atrNow
    const floor = JM.costFloorX * roundTrip(m, L886)
    const S = long ? Math.min(one - pad, L886 - floor) : Math.max(one + pad, L886 + floor)
    const fillIdx = fillCandle(h1, T)
    let check: SkipWhy | null = both ? 'both sides at once' : null
    let p: number | null = null
    let E1: number | null = null
    let reward: number | null = null
    let planRR: number | null = null
    if (fillIdx == null) check ??= 'no fill candle'
    else {
      p = h1[fillIdx].open
      E1 = entryFill(m, long, p, d.mult[fillIdx])
      const pl = plan(E1, S, tp1, tp2)
      reward = pl.reward
      planRR = pl.rr
      if ((long ? E1 - S : S - E1) < JM.costFloorX * roundTrip(m, p)) check ??= 'cost floor'
      else if (!targetsOk(long, E1, tp1, tp2)) check ??= 'targets on the wrong side'
      else if (pl.rr < JM.rrMin) check ??= 'plan under 1.5R'
      else if (!noChase(m, long, E1, b.close, S, tp1, tp2)) check ??= 'chase'
    }
    const fillTime = fillIdx != null ? h1[fillIdx].time : null
    out.push({
      market: m.id,
      long,
      pair,
      expiry,
      i,
      sigTime: b.time,
      T,
      armedAt: s.armedAt,
      xTime: fib.c[s.x].time,
      yTime: fib.c[s.y].time,
      jTime: fib.c[s.j].time,
      one,
      zero,
      atrRef: s.atrRef,
      atrF: atrNow,
      w: s.w,
      travelOverMove: s.travel / move,
      moveAtr: move / atrNow,
      limit: expiryLimit(expiry, P.per, move, s.atrRef, atrNow),
      L786,
      L886,
      tp1,
      tp2,
      S,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      reached886: long ? b.low <= L886 : b.high >= L886,
      fillIdx,
      fillTime,
      p,
      E1,
      reward,
      planRR,
      check,
      fields: signalFields({ d, pair, long, i, T, one, zero, fillTime, basket: o.basket }),
    })
  }
  return { signals: out, armed, diedPast1, diedExpiry }
}

// ── Trades, the ladder and exits (2.7 to 2.10) ────────────────────────────

export type ExitWhy = 'stop' | 'tp1' | 'tp2' | 'time' | 'window end'

export interface Chunk {
  time: number
  price: number
  units: number
  why: ExitWhy
  nights: number
  usd: number
  feeUsd: number
  swapUsd: number
}

export type PartKind = 'half1' | 'half2' | 'add' | 'all'

export interface Part {
  kind: PartKind
  idx: number
  time: number
  p: number
  E: number
  units: number
  unitsOpen: number
  rpuUsd: number
  riskUsd: number
  nearRedNews: 'yes' | 'no' | 'unknown'
  chunks: Chunk[]
}

export type LadderEnd = 'past1' | 'life' | 'zero' | 'closed' | 'add' | 'window end' | 'none'

export interface JmTrade {
  id: number
  variant: string
  book: 'account' | 'signal'
  market: JmMarketId
  long: boolean
  sizing: JmSizing
  sig: JmSignal
  parts: Part[]
  stop: number
  S2: number | null
  tp1Paid: boolean
  /** Close of the last entry candle the trade may hold: forced close at the first 1-hour open at or after it. */
  deadline: number
  firstFill: number
  balAtEntry: number
  half2: 'none' | 'pending' | 'filled' | 'together' | 'cancelled' | `failed: ${string}`
  add: 'none' | 'pending' | 'opened' | `failed: ${string}`
  addTrigger: number | null
  addP: number | null
  ladderEnd: LadderEnd
  past1BeforeAdd: boolean
  why: ExitWhy | null
  exitTime: number | null
  netUsd: number
  r: number
  /** R with every cost halved and doubled (same entries, levels and sizes; exits walked again). */
  rHalfCost: number
  rDoubleCost: number
  swapUsd: number
  feeUsd: number
  nights: number
  balAfter: number
}

/** Close of the Nth entry candle that starts at or after t (Infinity past the data). */
export function holdDeadline(d: JmData, pair: JmPair, t: number): number {
  const ent = entChart(d, pair)
  const k = firstAtOrAfter(ent.c, t) + holdCandles(pair) - 1
  return k < ent.c.length ? ent.c[k].time + ent.sec : Infinity
}

const open = (t: JmTrade) => t.parts.some((p) => p.unitsOpen > 1e-12)

/** Close `units` of a part at `price` (2.2: fee on both sides, swap per night, dollars at the exit fill). */
function closeChunk(
  m: JmMarket,
  t: JmTrade,
  part: Part,
  units: number,
  price: number,
  time: number,
  why: ExitWhy,
  inside: boolean,
  x: Mult,
): Chunk {
  const dir = t.long ? 1 : -1
  const fee = units * m.fee * x.fee * (part.E + price)
  const gross = units * dir * (price - part.E)
  const nights = swapNights(part.time, time, inside)
  const swap = (units * part.E * m.swap[t.long ? 0 : 1] * x.fee * nights) / 365
  const conv = m.usdBase ? 1 / price : 1
  const ch: Chunk = {
    time,
    price,
    units,
    why,
    nights,
    usd: (gross - fee - swap) * conv,
    feeUsd: fee * conv,
    swapUsd: swap * conv,
  }
  part.unitsOpen -= units
  if (part.unitsOpen < 1e-9 * part.units) part.unitsOpen = 0
  part.chunks.push(ch)
  return ch
}

/** Close everything still open at `price`. */
function closeAll(
  m: JmMarket,
  t: JmTrade,
  price: number,
  time: number,
  why: ExitWhy,
  inside: boolean,
  x: Mult,
  book: (usd: number) => void,
) {
  for (const p of t.parts)
    if (p.unitsOpen > 0) book(closeChunk(m, t, p, p.unitsOpen, price, time, why, inside, x).usd)
  t.why = why
  t.exitTime = time
}

/**
 * One 1-hour candle of the exit walk (2.9), after the forced-close check at
 * its open: the stop (it counts first), then TP1 (half of the units open
 * that hour), then TP2 (the rest). True when the trade is closed.
 */
export function stepCandle(
  m: JmMarket,
  t: JmTrade,
  b: OHLCCandle,
  x: Mult,
  book: (usd: number) => void,
): boolean {
  if (!open(t)) return true
  if (stopHit(m, t.long, b, t.stop, x)) {
    closeAll(m, t, stopFill(m, t.long, b, t.stop, x), b.time, 'stop', true, x, book)
    return true
  }
  if (!t.tp1Paid && targetHit(m, t.long, b, t.sig.tp1, x)) {
    for (const p of t.parts)
      if (p.unitsOpen > 0)
        book(closeChunk(m, t, p, 0.5 * p.unitsOpen, t.sig.tp1, b.time, 'tp1', true, x).usd)
    t.tp1Paid = true
  }
  if (t.tp1Paid && targetHit(m, t.long, b, t.sig.tp2, x)) {
    closeAll(m, t, t.sig.tp2, b.time, 'tp2', true, x, book)
    return true
  }
  return false
}

// ── The account (2.10) ────────────────────────────────────────────────────

export class JmAccount {
  balance: number
  peak: number
  maxDrawdown = 0
  open: JmTrade[] = []
  constructor(
    readonly flat: boolean,
    readonly start: number = JM.startMoney,
  ) {
    this.balance = start
    this.peak = start
  }

  /** Book one closed chunk, in dollars. */
  book(usd: number) {
    this.balance += usd
    if (this.balance > this.peak) this.peak = this.balance
    const dd = (this.peak - this.balance) / this.peak
    if (dd > this.maxDrawdown) this.maxDrawdown = dd
  }

  /** The balance parts are sized from: a flat $10,000 in the signal book. */
  sizingBalance() {
    return this.flat ? this.start : this.balance
  }

  tradeRisk(t: JmTrade) {
    return t.parts.reduce((a, p) => a + p.unitsOpen * p.rpuUsd, 0)
  }

  openRisk() {
    return this.open.reduce((a, t) => a + this.tradeRisk(t), 0)
  }

  marginUsed() {
    return this.open.reduce(
      (a, t) =>
        a +
        t.parts.reduce(
          (s, p) => s + (p.unitsOpen * valuePerUnitUsd(JM_MARKET[t.market], p.E)) / lev(t),
          0,
        ),
      0,
    )
  }

  /** The limits on a new trade (2.10). Null when it may open. */
  newTradeBlock(market: JmMarketId, long: boolean): SkipWhy | null {
    if (this.flat) return null
    if (this.open.length >= JM.maxOpen) return 'account: 5 trades open'
    const side = dollarSide(market, long)
    if (this.open.some((t) => dollarSide(t.market, t.long) !== side)) return 'dollar bet'
    if (this.open.filter((t) => dollarSide(t.market, t.long) === side).length >= JM.sameSideMax)
      return 'dollar bet'
    return null
  }

  /**
   * Units for a part that should risk `wantUsd` at `rpuUsd`: cut to the
   * margin left (skipped if the cut part risks under half of what it should)
   * and inside 10% open risk. The signal book has no limits.
   */
  units(
    m: JmMarket,
    E: number,
    rpuUsd: number,
    wantUsd: number,
  ): { units: number } | { why: SkipWhy } {
    let units = wantUsd / rpuUsd
    if (this.flat) return { units }
    const bal = this.balance
    const maxUnits = (Math.max(0, bal - this.marginUsed()) * m.leverage) / valuePerUnitUsd(m, E)
    if (units > maxUnits) {
      units = maxUnits
      if (!(units * rpuUsd >= JM.marginFloor * wantUsd)) return { why: 'account: margin' }
    }
    if (this.openRisk() + units * rpuUsd > JM.maxOpenRisk * bal + 1e-9)
      return { why: 'account: open risk over 10%' }
    return { units }
  }
}

const lev = (t: JmTrade) => JM_MARKET[t.market].leverage

// ── One run (both books, section 2.10) ────────────────────────────────────

export interface Skip {
  market: JmMarketId
  T: number
  long: boolean
  why: SkipWhy
}

export interface JmRun {
  variant: string
  book: 'account' | 'signal'
  trades: JmTrade[]
  skips: Skip[]
  signals: number
  endBalance: number
  maxDrawdown: number
}

interface Order {
  kind: 'entry' | 'half2' | 'add'
  fillIdx: number
  sig: JmSignal
  trade?: JmTrade
  refClose?: number
  P?: number
  atrF?: number
}

interface MarketState {
  d: JmData
  sigs: JmSignal[]
  sp: number
  ep: number
  trade: JmTrade | null
  orders: Order[]
  endIdx: number
  startIdx: number
}

/**
 * Run one variant over [from, to) on the given markets. Account book: one
 * $10,000 account with every limit of 2.10. Signal book: pass one market at
 * a time; every part is sized from a flat $10,000 with no account limits.
 * `filters` (indexes 0 to 9): a signal with a "no" opens no trade.
 */
export function simulate(o: {
  data: JmData[]
  signals: Map<JmMarketId, JmSignal[]>
  pair: JmPair
  expiry: JmExpiry
  sizing: JmSizing
  book: 'account' | 'signal'
  from: number
  to: number
  news?: NewsEvent[]
  filters?: number[]
}): JmRun {
  const { pair, sizing } = o
  const variant = variantName(pair, o.expiry, sizing)
  const acct = new JmAccount(o.book === 'signal')
  const trades: JmTrade[] = []
  const skips: Skip[] = []
  const news = o.news ?? []
  let id = 0
  let nSig = 0
  const ordered = [...o.data].sort(
    (a, b) => JM_MARKETS.indexOf(a.m.id) - JM_MARKETS.indexOf(b.m.id),
  )
  const st: MarketState[] = ordered.map((d) => {
    const ent = entChart(d, pair)
    const sigs = (o.signals.get(d.m.id) ?? []).filter((s) => s.T <= o.to)
    nSig += sigs.length
    const startIdx = firstAtOrAfter(d.h1.c, o.from)
    return {
      d,
      sigs,
      sp: 0,
      ep: firstAtOrAfter(ent.c, o.from),
      trade: null,
      orders: [],
      startIdx,
      endIdx: firstAtOrAfter(d.h1.c, o.to) - 1,
    }
  })
  const book = (usd: number, t: JmTrade) => {
    acct.book(usd)
    t.netUsd += usd
  }
  const finish = (s: MarketState) => {
    const t = s.trade
    if (!t) return
    t.balAfter = acct.balance
    acct.open = acct.open.filter((x) => x !== t)
  }
  const skip = (s: JmSignal, why: SkipWhy) =>
    skips.push({ market: s.market, T: s.T, long: s.long, why })

  // Decisions at the close of entry candle k (2.5 to 2.8).
  const decide = (s: MarketState, k: number) => {
    const ent = entChart(s.d, pair)
    const b = ent.c[k]
    const T = b.time + ent.sec
    const t = s.trade
    if (t && t.sizing !== 'A' && t.ladderEnd === 'none' && k > t.sig.i) ladderStep(s, t, k, T)
    while (s.sp < s.sigs.length && s.sigs[s.sp].i < k) s.sp++
    if (s.sp < s.sigs.length && s.sigs[s.sp].i === k) {
      const sig = s.sigs[s.sp++]
      const busy =
        s.orders.some((x) => x.kind === 'entry') ||
        (s.trade != null &&
          (open(s.trade) || (s.trade.sizing !== 'A' && s.trade.ladderEnd === 'none')))
      if (busy) skip(sig, 'market busy')
      else if (sig.check) skip(sig, sig.check)
      else if (o.filters?.some((f) => !sig.fields.F[f])) skip(sig, 'filter')
      else s.orders.push({ kind: 'entry', fillIdx: sig.fillIdx!, sig })
    }
  }

  const ladderStep = (s: MarketState, t: JmTrade, k: number, T: number) => {
    const ent = entChart(s.d, pair)
    const b = ent.c[k]
    const { long, one, zero } = t.sig
    const end = (e: LadderEnd) => {
      t.ladderEnd = e
      if (t.half2 === 'pending' || t.half2 === 'none') {
        if (t.half2 === 'pending') t.half2 = 'cancelled'
        s.orders = s.orders.filter((x) => x.kind !== 'half2')
      }
    }
    if (long ? b.low < one : b.high > one) {
      if (t.add === 'none') t.past1BeforeAdd = true
      return end('past1')
    }
    if (k - t.sig.i >= JM.ladderLife) return end('life')
    if (long ? b.high >= zero : b.low <= zero) return end('zero')
    if (t.parts.length && !open(t)) return end('closed')
    const strong = (q: number) => {
      const c = ent.c[q]
      const way = long ? c.close > c.open : c.close < c.open
      return way && Math.abs(c.close - c.open) >= JM.strongBody * ent.atr[q]
    }
    if (
      k - 1 >= t.sig.i &&
      t.parts.length &&
      open(t) &&
      ent.c[k - 1].time >= t.firstFill &&
      ent.c[k].time - ent.c[k - 1].time === ent.sec &&
      strong(k - 1) &&
      strong(k)
    ) {
      if (t.half2 === 'none' || t.half2 === 'pending') {
        t.half2 = 'cancelled'
        s.orders = s.orders.filter((x) => x.kind !== 'half2')
      }
      let P0 = long ? Infinity : -Infinity
      for (let q = t.sig.i; q <= k; q++)
        P0 = long ? Math.min(P0, ent.c[q].low) : Math.max(P0, ent.c[q].high)
      t.addTrigger = b.time
      t.addP = P0
      t.ladderEnd = 'add'
      const fi = fillCandle(s.d.h1.c, T)
      if (fi == null) t.add = 'failed: no fill candle'
      else {
        t.add = 'pending'
        s.orders.push({
          kind: 'add',
          fillIdx: fi,
          sig: t.sig,
          trade: t,
          refClose: b.close,
          P: P0,
          atrF: atrAt(fibChart(s.d, pair), T),
        })
      }
      return
    }
    if (t.half2 === 'none' && (long ? b.low <= t.sig.L886 : b.high >= t.sig.L886)) {
      const fi = fillCandle(s.d.h1.c, T)
      if (fi == null) t.half2 = 'failed: no fill candle'
      else {
        t.half2 = 'pending'
        s.orders.push({ kind: 'half2', fillIdx: fi, sig: t.sig, trade: t, refClose: b.close })
      }
    }
  }

  const newPart = (
    s: MarketState,
    t: JmTrade,
    kind: PartKind,
    idx: number,
    E: number,
    units: number,
    rpuUsd: number,
  ) => {
    const h = s.d.h1.c[idx]
    const part: Part = {
      kind,
      idx,
      time: h.time,
      p: h.open,
      E,
      units,
      unitsOpen: units,
      rpuUsd,
      riskUsd: units * rpuUsd,
      nearRedNews: nearRedNews(s.d.m, h.time, news),
      chunks: [],
    }
    t.parts.push(part)
    return part
  }

  const tryHalf2 = (s: MarketState, t: JmTrade, idx: number, E: number, refClose: number) => {
    const m = s.d.m
    const p = s.d.h1.c[idx].open
    if (Math.abs(E - t.sig.S) < JM.costFloorX * roundTrip(m, p)) return 'failed: cost floor'
    if (!noChase(m, t.long, E, refClose, t.sig.S, t.sig.tp1, t.sig.tp2)) return 'failed: chase'
    const rpu = riskPerUnitUsd(m, E, t.sig.S)
    const u = acct.units(m, E, rpu, JM.halfRisk * acct.sizingBalance())
    if ('why' in u) return `failed: ${u.why}`
    newPart(s, t, 'half2', idx, E, u.units, rpu)
    return 'filled'
  }

  const fillEntry = (s: MarketState, ord: Order, idx: number) => {
    const sig = ord.sig
    const m = s.d.m
    const block = acct.newTradeBlock(m.id, sig.long)
    if (block) return skip(sig, block)
    const E = sig.E1!
    const rpu = riskPerUnitUsd(m, E, sig.S)
    const share = sizing === 'A' ? JM.fullRisk : JM.halfRisk
    const bal = acct.sizingBalance()
    const u = acct.units(m, E, rpu, share * bal)
    if ('why' in u) return skip(sig, u.why)
    const h = s.d.h1.c[idx]
    const t: JmTrade = {
      id: ++id,
      variant,
      book: o.book,
      market: m.id,
      long: sig.long,
      sizing,
      sig,
      parts: [],
      stop: sig.S,
      S2: null,
      tp1Paid: false,
      deadline: holdDeadline(s.d, pair, h.time),
      firstFill: h.time,
      balAtEntry: bal,
      half2: 'none',
      add: 'none',
      addTrigger: null,
      addP: null,
      ladderEnd: 'none',
      past1BeforeAdd: false,
      why: null,
      exitTime: null,
      netUsd: 0,
      r: 0,
      rHalfCost: 0,
      rDoubleCost: 0,
      swapUsd: 0,
      feeUsd: 0,
      nights: 0,
      balAfter: NaN,
    }
    newPart(s, t, sizing === 'A' ? 'all' : 'half1', idx, E, u.units, rpu)
    acct.open.push(t)
    trades.push(t)
    s.trade = t
    if (sizing !== 'A' && sig.reached886) {
      const r = tryHalf2(s, t, idx, E, sig.close)
      t.half2 = r === 'filled' ? 'together' : (r as JmTrade['half2'])
    }
  }

  const fillAdd = (s: MarketState, ord: Order, idx: number) => {
    const t = ord.trade!
    const m = s.d.m
    const h = s.d.h1.c[idx]
    const p = h.open
    const long = t.long
    const E = entryFill(m, long, p, s.d.mult[idx])
    const floor = JM.costFloorX * roundTrip(m, p)
    const pad = JM.stopPadAtr * ord.atrF!
    const dd = long ? Math.max(E - (ord.P! - pad), floor) : Math.max(ord.P! + pad - E, floor)
    const S2 = long ? Math.max(t.sig.S, E - dd) : Math.min(t.sig.S, E + dd)
    const { tp1, tp2 } = t.sig
    const fail = (why: string) => {
      t.add = `failed: ${why}`
    }
    if (!targetsOk(long, E, tp1, tp2)) return fail('targets on the wrong side')
    if (Math.abs(E - S2) < floor) return fail('cost floor')
    if (plan(E, S2, tp1, tp2).rr < JM.rrMin) return fail('plan under 1.5R')
    if (!noChase(m, long, E, ord.refClose!, S2, tp1, tp2)) return fail('chase')
    const rpu = riskPerUnitUsd(m, E, S2)
    const bal = acct.sizingBalance()
    // The open parts' risk measured to S2 (C), applied only if the add opens.
    const openRisk2 = t.parts.reduce((a, q) => a + q.unitsOpen * riskPerUnitUsd(m, q.E, S2), 0)
    const want = sizing === 'C' ? JM.fullRisk * bal - openRisk2 : JM.halfRisk * bal
    if (!(want > 1e-9)) return fail('trade already at 2%')
    const old = t.parts.map((q) => q.rpuUsd)
    t.parts.forEach((q) => (q.rpuUsd = riskPerUnitUsd(m, q.E, S2)))
    const u = acct.units(m, E, rpu, want)
    if ('why' in u) {
      t.parts.forEach((q, n) => (q.rpuUsd = old[n]))
      return fail(u.why)
    }
    newPart(s, t, 'add', idx, E, u.units, rpu)
    t.stop = S2
    t.S2 = S2
    t.add = 'opened'
  }

  // The clock: every 1-hour start of every market.
  const times = new Set<number>()
  for (const s of st) for (let q = s.startIdx; q <= s.endIdx; q++) times.add(s.d.h1.c[q].time)
  const ticks = [...times].sort((a, b) => a - b)
  const h1p = st.map((s) => s.startIdx)
  for (const tau of ticks) {
    // 1. Decisions at entry candles closed by now.
    for (const s of st) {
      const ent = entChart(s.d, pair)
      while (s.ep < ent.c.length && ent.c[s.ep].time + ent.sec <= tau) {
        if (ent.c[s.ep].time + ent.sec <= o.to) decide(s, s.ep)
        s.ep++
      }
    }
    // The 1-hour candle of each market at tau.
    const here = st.map((s, n) => {
      const q = h1p[n]
      return q <= s.endIdx && s.d.h1.c[q].time === tau ? q : -1
    })
    // 2. Forced closes at the open (the longest hold).
    st.forEach((s, n) => {
      const q = here[n]
      const t = s.trade
      if (q < 0 || !t || !open(t) || t.deadline > tau) return
      const b = s.d.h1.c[q]
      closeAll(
        s.d.m,
        t,
        forcedFill(s.d.m, t.long, b.open, s.d.mult[q]),
        b.time,
        'time',
        false,
        s.d.mult[q],
        (u) => book(u, t),
      )
      s.orders = s.orders.filter((x) => x.trade !== t)
      if (t.half2 === 'pending') t.half2 = 'cancelled'
      if (t.add === 'pending') t.add = 'failed: trade closed'
      finish(s)
    })
    // 3. Fills at the open, in table order.
    st.forEach((s, n) => {
      const q = here[n]
      // Orders whose fill candle is past (data gap): none, fill candles are exact.
      const due = s.orders.filter((x) => x.fillIdx === q)
      if (q < 0 || !due.length) return
      s.orders = s.orders.filter((x) => x.fillIdx !== q)
      for (const ord of due) {
        if (ord.kind === 'entry') fillEntry(s, ord, q)
        else {
          const t = ord.trade!
          if (!open(t)) {
            if (ord.kind === 'half2') t.half2 = 'cancelled'
            else t.add = 'failed: trade closed'
            continue
          }
          if (ord.kind === 'half2') {
            const E = entryFill(s.d.m, t.long, s.d.h1.c[q].open, s.d.mult[q])
            t.half2 = tryHalf2(s, t, q, E, ord.refClose!) as JmTrade['half2']
          } else fillAdd(s, ord, q)
        }
      }
    })
    // 4. Inside the candle: stop, TP1, TP2.
    st.forEach((s, n) => {
      const q = here[n]
      if (q < 0) return
      h1p[n] = q + 1
      const t = s.trade
      if (!t || !open(t)) return
      if (stepCandle(s.d.m, t, s.d.h1.c[q], s.d.mult[q], (u) => book(u, t))) finish(s)
    })
  }
  // Window end: close at the last candle's close.
  for (const s of st) {
    const t = s.trade
    if (t && open(t) && s.endIdx >= 0) {
      const b = s.d.h1.c[s.endIdx]
      const x = s.d.mult[s.endIdx]
      closeAll(
        s.d.m,
        t,
        forcedFill(s.d.m, t.long, b.close, x),
        b.time,
        'window end',
        false,
        x,
        (u) => book(u, t),
      )
      finish(s)
    }
    if (t && t.ladderEnd === 'none' && t.sizing !== 'A') t.ladderEnd = 'window end'
    if (t?.half2 === 'pending') t.half2 = 'cancelled'
    if (t?.add === 'pending') t.add = 'failed: window end'
    for (const ord of s.orders) if (ord.kind === 'entry') skip(ord.sig, 'no fill candle')
  }
  const dataOf = new Map(o.data.map((d) => [d.m.id, d]))
  for (const t of trades) {
    const chunks = t.parts.flatMap((p) => p.chunks)
    t.swapUsd = chunks.reduce((a, c) => a + c.swapUsd, 0)
    t.feeUsd = chunks.reduce((a, c) => a + c.feeUsd, 0)
    t.nights = Math.max(0, ...chunks.map((c) => c.nights))
    t.r = t.netUsd / (JM.fullRisk * t.balAtEntry)
    const d = dataOf.get(t.market)!
    const endIdx = firstAtOrAfter(d.h1.c, o.to) - 1
    t.rHalfCost = rescore(t, d, endIdx, 0.5)
    t.rDoubleCost = rescore(t, d, endIdx, 2)
  }
  return {
    variant,
    book: o.book,
    trades,
    skips,
    signals: nSig,
    endBalance: acct.balance,
    maxDrawdown: acct.maxDrawdown,
  }
}

/**
 * The trade again with every cost (spread, slip, fee, swap) times `scale`:
 * the same fill candles, levels, stops and sizes; entries re-priced and
 * exits walked again. A later part opens only while the trade is still open.
 */
export function rescore(t: JmTrade, d: JmData, endIdx: number, scale: number): number {
  const m = d.m
  const c = d.h1.c
  const parts = [...t.parts].sort((a, b) => a.idx - b.idx)
  const copy: JmTrade = { ...t, parts: [], tp1Paid: false, stop: t.sig.S }
  let usd = 0
  const bookU = (u: number) => (usd += u)
  let next = 0
  let done = false
  for (let q = parts[0].idx; q <= endIdx && !done; q++) {
    const b = c[q]
    const x = scaled(d.mult[q], scale)
    if (b.time >= t.deadline) {
      if (copy.parts.length)
        closeAll(m, copy, forcedFill(m, t.long, b.open, x), b.time, 'time', false, x, bookU)
      done = true
      break
    }
    while (next < parts.length && parts[next].idx === q) {
      const p = parts[next++]
      if (copy.parts.length && !open(copy)) {
        done = true
        break
      }
      copy.parts.push({ ...p, E: entryFill(m, t.long, b.open, x), unitsOpen: p.units, chunks: [] })
      if (p.kind === 'add' && t.S2 != null) copy.stop = t.S2
    }
    if (done) break
    if (next >= parts.length && !open(copy)) break
    if (stepCandle(m, copy, b, x, bookU) && next >= parts.length) done = true
  }
  if (!done && open(copy) && endIdx >= 0) {
    const b = c[endIdx]
    const x = scaled(d.mult[endIdx], scale)
    closeAll(m, copy, forcedFill(m, t.long, b.close, x), b.time, 'window end', false, x, bookU)
  }
  return usd / (JM.fullRisk * t.balAtEntry)
}

/**
 * A one-part trade walked by 2.9 from a fill candle, sized to 1 unit; its
 * result in R = dollars per unit / risk per unit in dollars. For the mirror
 * and the coin flips (section 6).
 */
export function walkOne(o: {
  d: JmData
  pair: JmPair
  idx: number
  endIdx: number
  long: boolean
  stopDist: number
  tp1Dist: number
  tp2Dist: number
  scale?: number
}): number {
  const { d, long } = o
  const m = d.m
  const b0 = d.h1.c[o.idx]
  const E = entryFill(m, long, b0.open, scaled(d.mult[o.idx], o.scale ?? 1))
  const dir = long ? 1 : -1
  const S = E - dir * o.stopDist
  const sig = { tp1: E + dir * o.tp1Dist, tp2: E + dir * o.tp2Dist } as JmSignal
  const t = {
    market: m.id,
    long,
    sig,
    stop: S,
    tp1Paid: false,
    parts: [
      {
        kind: 'all',
        idx: o.idx,
        time: b0.time,
        p: b0.open,
        E,
        units: 1,
        unitsOpen: 1,
        rpuUsd: 0,
        riskUsd: 0,
        nearRedNews: 'no',
        chunks: [],
      },
    ],
  } as unknown as JmTrade
  const deadline = holdDeadline(d, o.pair, b0.time)
  let usd = 0
  const bookU = (u: number) => (usd += u)
  let done = false
  for (let q = o.idx; q <= o.endIdx; q++) {
    const b = d.h1.c[q]
    const x = scaled(d.mult[q], o.scale ?? 1)
    if (b.time >= deadline) {
      closeAll(m, t, forcedFill(m, long, b.open, x), b.time, 'time', false, x, bookU)
      done = true
      break
    }
    if (stepCandle(m, t, b, x, bookU)) {
      done = true
      break
    }
  }
  if (!done && o.endIdx >= o.idx) {
    const b = d.h1.c[o.endIdx]
    const x = scaled(d.mult[o.endIdx], o.scale ?? 1)
    closeAll(m, t, forcedFill(m, long, b.close, x), b.time, 'window end', false, x, bookU)
  }
  return usd / riskPerUnitUsd(m, E, S)
}

/** The mirror of a trade: the other way, same fill candle, same distances from its own fill. */
export function mirrorR(t: JmTrade, d: JmData, endIdx: number): number {
  const first = t.parts[0]
  return walkOne({
    d,
    pair: t.sig.pair,
    idx: first.idx,
    endIdx,
    long: !t.long,
    stopDist: Math.abs(first.E - t.sig.S),
    tp1Dist: Math.abs(first.E - t.sig.tp1),
    tp2Dist: Math.abs(first.E - t.sig.tp2),
  })
}

export function mirrorTest(trades: JmTrade[], byId: Map<JmMarketId, JmData>, to: number) {
  const real: number[] = []
  const flip: number[] = []
  for (const t of trades) {
    const d = byId.get(t.market)!
    real.push(t.r)
    flip.push(mirrorR(t, d, firstAtOrAfter(d.h1.c, to) - 1))
  }
  return directionTest(real, flip)
}

/**
 * One coin-flip run (section 6): every trade swapped for a random one in the
 * same market, at a random 1-hour open among the 120 before and the 120
 * after its fill candle, a random side, its own stop and target distances.
 */
export function coinRun(
  trades: JmTrade[],
  byId: Map<JmMarketId, JmData>,
  from: number,
  to: number,
  seed: number,
): number {
  const rnd = seeded(seed)
  let total = 0
  for (const t of trades) {
    const d = byId.get(t.market)!
    const first = t.parts[0]
    const lo = Math.max(firstAtOrAfter(d.h1.c, from), first.idx - 120)
    const endIdx = firstAtOrAfter(d.h1.c, to) - 1
    const hi = Math.min(endIdx, first.idx + 120)
    const pool = hi - lo
    let q = lo + Math.floor(rnd() * pool)
    if (q >= first.idx) q++
    const long = rnd() < 0.5
    total += walkOne({
      d,
      pair: t.sig.pair,
      idx: Math.min(q, endIdx),
      endIdx,
      long,
      stopDist: Math.abs(first.E - t.sig.S),
      tp1Dist: Math.abs(first.E - t.sig.tp1),
      tp2Dist: Math.abs(first.E - t.sig.tp2),
    })
  }
  return total
}

// ── Counting (sections 3, 6, 7) ───────────────────────────────────────────

export interface Stats {
  trades: number
  wins: number
  winRate: number
  totalR: number
  avgR: number
  profitFactor: number | null
  usd: number
}

export function stats(ts: JmTrade[], r: (t: JmTrade) => number = (t) => t.r): Stats {
  const rs = ts.map(r)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const win = rs.filter((x) => x > 0)
  const loss = -sum(rs.filter((x) => x < 0))
  return {
    trades: ts.length,
    wins: win.length,
    winRate: ts.length ? win.length / ts.length : 0,
    totalR: sum(rs),
    avgR: ts.length ? sum(rs) / ts.length : 0,
    profitFactor: loss > 0 ? sum(win) / loss : null,
    usd: sum(ts.map((t) => t.netUsd)),
  }
}

/** Max drawdown of a closed-trade dollar path: chunks booked in time order from $10,000. */
export function drawdownOf(ts: JmTrade[], start: number = JM.startMoney): number {
  const ch = ts
    .flatMap((t) => t.parts.flatMap((p) => p.chunks))
    .sort((a, b) => a.time - b.time || (a.why === 'tp1' ? -1 : 0))
  let bal = start
  let peak = start
  let dd = 0
  for (const c of ch) {
    bal += c.usd
    peak = Math.max(peak, bal)
    dd = Math.max(dd, (peak - bal) / peak)
  }
  return dd
}

export interface PeriodRow {
  trades: number
  totalR: number
  maxDrawdown: number
}

/** "X beats Y" on one period (section 3, the pair rule). `years` sets the 3R per year. */
export function pairBeats(x: PeriodRow, y: PeriodRow, years = 1) {
  const checks = [
    { text: 'at least 30 trades', ok: x.trades >= JM.pickMinTrades },
    { text: 'no less money', ok: x.totalR >= y.totalR },
    { text: 'no deeper drop', ok: x.maxDrawdown <= y.maxDrawdown },
    {
      text: `at least ${3 * years}R more, or at least 3 points less drawdown`,
      ok: x.totalR >= y.totalR + 3 * years - 1e-9 || x.maxDrawdown <= y.maxDrawdown - 0.03 + 1e-12,
    },
  ]
  return { checks, beats: checks.every((c) => c.ok) }
}

export interface StructureRow {
  pair: JmPair
  expiry: JmExpiry
  y1: PeriodRow
  y2: PeriodRow
}

const order = (r: { pair: JmPair; expiry: JmExpiry }) =>
  JM_PAIRS.indexOf(r.pair) * 3 + JM_EXPIRIES.indexOf(r.expiry)

/**
 * The pick rule (section 3, steps 1 to 5), on the capped runs' account
 * books. Returns the picked structure or null ("the design years did not
 * confirm"), and every candidate tried.
 */
export function pickStructure(rows: StructureRow[]) {
  const ok1 = (r: PeriodRow) => r.trades >= JM.pickMinTrades && r.maxDrawdown <= JM.pickMaxDrawdown
  let left = rows.filter((r) => ok1(r.y1))
  const eligible = left.map((r) => `${r.pair}-${r.expiry}`)
  const tried: { pair: JmPair; expiry: JmExpiry; confirmed: boolean; why: string[] }[] = []
  while (left.length && tried.length < JM.maxCandidates) {
    const top = Math.max(...left.map((r) => r.y1.totalR))
    const near = left.filter((r) => r.y1.totalR >= top - JM.pickWithinR - 1e-9)
    near.sort((a, b) => b.y1.trades - a.y1.trades || order(a) - order(b))
    const c = near[0]
    const why: string[] = []
    if (c.y2.trades < JM.pickMinTrades) why.push(`year 2 has ${c.y2.trades} trades (under 30)`)
    if (!(c.y2.totalR > 0)) why.push(`year 2 total ${c.y2.totalR.toFixed(2)}R (not above 0)`)
    if (c.y2.maxDrawdown > JM.pickMaxDrawdown)
      why.push(`year 2 drawdown ${(c.y2.maxDrawdown * 100).toFixed(1)}% (over 25%)`)
    tried.push({ pair: c.pair, expiry: c.expiry, confirmed: !why.length, why })
    if (!why.length) return { picked: { pair: c.pair, expiry: c.expiry }, tried, eligible }
    left = left.filter((r) => r !== c)
  }
  return { picked: null, tried, eligible }
}

// ── The filter search (section 5) ─────────────────────────────────────────

export interface FilterTrade {
  market: JmMarketId
  year: 1 | 2
  r: number
  rDouble: number
  F: boolean[]
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

export function filterSearch(ts: FilterTrade[], runs = 10_000, seed = 20261112) {
  const rows = FILTER_NAMES.map((name, f) => {
    const K = ts.filter((t) => t.F[f])
    const D = ts.filter((t) => !t.F[f])
    const y = (xs: FilterTrade[], yr: 1 | 2) => xs.filter((t) => t.year === yr)
    const lines: { line: number; ok: boolean; text: string }[] = []
    const enough = [1, 2].every(
      (yr) => y(K, yr as 1 | 2).length >= 40 && y(D, yr as 1 | 2).length >= 20,
    )
    lines.push({ line: 1, ok: enough, text: 'K 40+ and D 20+ trades in each year' })
    const helps = [1, 2].every((yr) => {
      const k = avg(y(K, yr as 1 | 2).map((t) => t.r))
      const dd = avg(y(D, yr as 1 | 2).map((t) => t.r))
      const a = avg(y(ts, yr as 1 | 2).map((t) => t.r))
      return k > dd && k > 0 && k >= a + 0.05
    })
    lines.push({ line: 2, ok: helps, text: 'helps in both years' })
    const counted = JM_MARKETS.filter((m) => K.filter((t) => t.market === m).length >= 8)
    const better = counted.filter(
      (m) =>
        avg(K.filter((t) => t.market === m).map((t) => t.r)) >
        avg(ts.filter((t) => t.market === m).map((t) => t.r)),
    )
    lines.push({
      line: 3,
      ok: counted.length >= 5 && better.length >= (2 / 3) * counted.length - 1e-9,
      text: `on most markets (${better.length} of ${counted.length} counted)`,
    })
    const dbl = [1, 2].every((yr) => avg(y(K, yr as 1 | 2).map((t) => t.rDouble)) > 0)
    lines.push({ line: 4, ok: dbl, text: 'K above 0 in both years at double costs' })
    // Line 5: shuffle the answers inside each market and year.
    const real = avg(K.map((t) => t.r)) - avg(D.map((t) => t.r))
    let p = 1
    if (K.length && D.length) {
      const groups = new Map<string, FilterTrade[]>()
      for (const t of ts) {
        const key = `${t.market}|${t.year}`
        groups.set(key, [...(groups.get(key) ?? []), t])
      }
      const rnd = seeded(seed + f)
      let hits = 0
      const nK = K.length
      const nD = D.length
      const g = [...groups.values()].map((xs) => ({
        rs: xs.map((t) => t.r),
        k: xs.filter((t) => t.F[f]).length,
      }))
      for (let r = 0; r < runs; r++) {
        let sK = 0
        let sAll = 0
        for (const { rs, k } of g) {
          const a = [...rs]
          for (let q = 0; q < k; q++) {
            const z = q + Math.floor(rnd() * (a.length - q))
            ;[a[q], a[z]] = [a[z], a[q]]
            sK += a[q]
          }
          for (const x of rs) sAll += x
        }
        if (sK / nK - (sAll - sK) / nD >= real - 1e-12) hits++
      }
      p = hits / runs
    }
    return { filter: f, name, K: K.length, D: D.length, diff: real, p, lines, survives: false }
  })
  const sorted = [...rows].sort((a, b) => a.p - b.p)
  for (let k = 0; k < sorted.length; k++) {
    if (sorted[k].p > 0.1 / (sorted.length - k)) break
    ;(sorted[k] as { holm?: boolean }).holm = true
  }
  const pass = sorted.filter((r) => (r as { holm?: boolean }).holm && r.lines.every((l) => l.ok))
  pass.slice(0, 2).forEach((r) => (r.survives = true))
  return rows.map((r) => ({ ...r, holm: Boolean((r as { holm?: boolean }).holm) }))
}

// ── Exam pass lines (section 6) ───────────────────────────────────────────

export function examLines(o: {
  trades: JmTrade[]
  endBalance: number
  maxDrawdown: number
  minTrades: number
  coinP95: number
  controlTotalR: number
  mirrorZ: number | null
}) {
  const s = stats(o.trades)
  const dbl = o.trades.reduce((a, t) => a + t.rDoubleCost, 0)
  const years = [2019, 2020, 2021, 2022, 2023, 2024].map((y) =>
    o.trades
      .filter((t) => new Date(t.firstFill * 1000).getUTCFullYear() === y)
      .reduce((a, t) => a + t.r, 0),
  )
  const lines = [
    { line: 1, text: `at least ${o.minTrades} trades`, ok: s.trades >= o.minTrades },
    {
      line: 2,
      text: 'ends above $10,000 and averages at least +0.10R',
      ok: o.endBalance > JM.startMoney && s.avgR >= 0.1,
    },
    {
      line: 3,
      text: 'profit factor at least 1.20',
      ok: (s.profitFactor ?? (s.wins ? Infinity : 0)) >= 1.2,
    },
    { line: 4, text: 'max drawdown at most 35%', ok: o.maxDrawdown <= 0.35 },
    {
      line: 5,
      text: "control's total R above its coin flips' 95th percentile",
      ok: o.controlTotalR > o.coinP95,
    },
    { line: 6, text: "control's mirror z at least 1.0", ok: (o.mirrorZ ?? -Infinity) >= 1 },
    { line: 7, text: 'total R above 0 at double costs', ok: dbl > 0 },
    {
      line: 8,
      text: 'at least 4 of 6 calendar years above 0R',
      ok: years.filter((y) => y > 0).length >= 4,
    },
  ]
  const verdict =
    s.trades < o.minTrades
      ? 'no verdict'
      : lines.every((l) => l.ok)
        ? 'pass'
        : o.endBalance > JM.startMoney
          ? 'fail (made money, not proven)'
          : 'fail'
  return { lines, verdict, years, doubleCostR: dbl }
}

/** 95th percentile of the coin-flip totals (the 950th of 1,000 sorted). */
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]
}

// ── What the loader may read (2.12 point 8, section 4) ────────────────────

/**
 * The rows a run may read, [readFrom, readTo). Design mode: the window must
 * sit inside the design years (2024-11-11 to 2026-11-10); warm-up candles
 * from 2023-09-01 are read for indicators only. Exam mode (unlocked only by
 * the committed freeze record): exactly the exam window, no earlier warm-up.
 */
export function readWindow(from: number, to: number, exam: boolean) {
  if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) throw new Error('bad window')
  if (exam) {
    if (from !== EXAM_FROM || to !== EXAM_TO)
      throw new Error('exam mode: the window must be 2019-01-01 22:00 to 2024-11-10')
    return { readFrom: from, readTo: to }
  }
  if (from < DESIGN_Y1) throw new Error('design mode refuses dates before 2024-11-11')
  if (to > DESIGN_END) throw new Error('design mode ends on 2026-11-10')
  return { readFrom: DESIGN_WARMUP, readTo: to }
}

/** The loader's own check on what it read: nothing outside [readFrom, readTo). */
export function assertRead(c: OHLCCandle[], readFrom: number, readTo: number, path: string) {
  if (!c.length) throw new Error(`${path}: no candle in the window`)
  if (c[0].time < readFrom || c[c.length - 1].time >= readTo)
    throw new Error(`${path}: a candle outside the window was read`)
}

// ── The freeze record (section 4) ─────────────────────────────────────────

export interface JmFreezeRecord {
  codeCommit: string
  spec: { path: string; sha256: string }
  confirmed: boolean
  picked: { pair: JmPair; expiry: JmExpiry; sizing: 'C' | 'U' } | null
  filters: number[]
  /** Every file the exam reads, by absolute path. */
  files: Record<string, { size: number; sha256: string }>
  window: { from: string; to: string }
  [k: string]: unknown
}

export interface JmFreezeFacts {
  dirty: string[]
  changedSinceCode: string[] | null
  specSha256: string | null
  files: Record<string, { size: number; sha256: string } | null>
}

export function parseJmFreeze(md: string): JmFreezeRecord {
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)]
  if (blocks.length !== 1) throw new Error('freeze record: expected exactly one json block')
  return JSON.parse(blocks[0][1]) as JmFreezeRecord
}

/** Every reason the exam must refuse to start (section 4). Empty means it may start. */
export function jmFreezeProblems(rec: JmFreezeRecord, f: JmFreezeFacts): string[] {
  const out: string[] = []
  if (f.dirty.length) out.push(`the working tree is not clean: ${f.dirty.join('; ')}`)
  if (f.changedSinceCode == null) out.push(`code commit ${rec.codeCommit} is not in this checkout`)
  else if (f.changedSinceCode.join(',') !== FREEZE_FILE)
    out.push(
      `since ${rec.codeCommit} the change must be ${FREEZE_FILE} only, got: ${f.changedSinceCode.join(', ') || 'nothing'}`,
    )
  if (f.specSha256 !== rec.spec?.sha256) out.push(`SPEC.md changed: ${f.specSha256}`)
  for (const [path, want] of Object.entries(rec.files ?? {})) {
    const got = f.files[path]
    if (!got) out.push(`missing ${path}`)
    else if (got.size !== want.size || got.sha256 !== want.sha256) out.push(`${path} changed`)
  }
  if (Object.keys(rec.files ?? {}).length < JM_MARKETS.length)
    out.push('the record must hash the eight 1-hour files')
  if (!rec.confirmed || !rec.picked)
    out.push('the design years did not confirm: there is no exam run')
  else if (
    !JM_PAIRS.includes(rec.picked.pair) ||
    !JM_EXPIRIES.includes(rec.picked.expiry) ||
    !['C', 'U'].includes(rec.picked.sizing)
  )
    out.push('the frozen structure is not a pre-registered variant')
  if (rec.window?.from !== '2019-01-01' || rec.window?.to !== '2024-11-10')
    out.push('the exam window must be 2019-01-01 to 2024-11-10')
  return out
}
