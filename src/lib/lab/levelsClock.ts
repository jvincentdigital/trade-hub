// Levels study (docs/levels-study.md, "Data and clocks"): New York days and
// weeks, 4-hour, daily and 15-minute candles, true range, the ATR at a candle,
// the ATR in force and the 15th day; round numbers and the twin grids. Pure.
// Times are UTC seconds, prices the Bid, bars one typed array per column.

import {
  atr14,
  buildChart,
  MARKET_COSTS,
  trueRanges,
  type Bars,
  type Chart,
  type HarmonicMarket,
  type MarketCosts,
} from './harmonicFind'
import { nyOffsetHours, nySecondOfDay } from './harmonicTrade'

/** Every test of a price against a level, an edge or a distance is inclusive with this tolerance. */
export const TOL = 1e-9

const HOUR = 3600
const DAY = 86_400

// ---------------------------------------------------------------- New York time

/** New York wall-clock time of a UTC second, as seconds on a UTC-like scale. */
export const nyLocal = (t: number) => t + nyOffsetHours(t) * HOUR

/**
 * The UTC second of a New York wall-clock time. On the night when 01:00 to
 * 01:59 happens twice this is the first one (both hours belong to the 01
 * candle, so the candle starts at the first).
 */
export function nyToUtc(local: number): number {
  const edt = local + 4 * HOUR
  return nyOffsetHours(edt) === -4 ? edt : local + 5 * HOUR
}

/** Weekday of an epoch day number, 0 Sunday to 6 Saturday. */
export const weekdayOf = (d: number) => (((d + 4) % 7) + 7) % 7

/**
 * The day a minute belongs to, as the epoch day number of the date it ends on:
 * a day runs from 17:00 New York time to the next 17:00, and a minute stamped
 * from Friday 17:00 to Sunday 17:00 belongs to Monday's day.
 */
export function dayNameOf(t: number): number {
  let d = Math.floor((nyLocal(t) + 7 * HOUR) / DAY)
  const wd = weekdayOf(d)
  if (wd === 6) d += 2
  else if (wd === 0) d += 1
  return d
}

/** Close of the day named d: 17:00 New York time on that date. */
export const dayClose = (d: number) => nyToUtc(d * DAY + 17 * HOUR)

/** Clock start of the day named d: the 17:00 before it (Friday's for a Monday). */
export const dayStart = (d: number) => nyToUtc((d - (weekdayOf(d) === 1 ? 3 : 1)) * DAY + 17 * HOUR)

/** The calendar week (Monday based) of the day named d. */
export const weekNameOf = (d: number) => Math.floor((d + 3) / 7)

/** The 4-hour block of a minute: blocks start at 17, 21, 01, 05, 09 and 13 New York time. */
export const fourHourKey = (t: number) => Math.floor((nyLocal(t) + 7 * HOUR) / (4 * HOUR))
export const fourHourStart = (k: number) => nyToUtc(k * 4 * HOUR - 7 * HOUR)

/** The New York clock buckets of Part 2: 0 17:00-02:59, 1 03:00-07:59, 2 08:00-11:59, 3 12:00-16:59. */
export function nyClockBucket(t: number): number {
  const h = nySecondOfDay(t) / HOUR
  if (h >= 17 || h < 3) return 0
  if (h < 8) return 1
  if (h < 12) return 2
  return 3
}

// ---------------------------------------------------------------- charts

/** Chart candles on New York clock boundaries (days or 4-hour candles). */
export interface NyChart {
  n: number
  /** Clock boundary the candle starts at (its time). */
  start: Float64Array
  /** Clock end: the candle closes there, learned at the first minute stamped at or after it. */
  stop: Float64Array
  /** Day chart: the epoch day of the date it is named by; 4-hour chart: the block key. */
  name: Int32Array
  open: Float64Array
  high: Float64Array
  low: Float64Array
  close: Float64Array
  /** First 1-minute bar and one past the last. */
  first: Int32Array
  end: Int32Array
  /** Chart candle of each 1-minute bar. */
  ofMinute: Int32Array
  /** True range and ATR at each candle (NaN before the 14th). */
  tr: Float64Array
  atr: Float64Array
}

function buildNyChart(
  bars: Bars,
  keyOf: (t: number) => number,
  startOf: (k: number) => number,
  stopOf: (k: number) => number,
): NyChart {
  const ofMinute = new Int32Array(bars.n)
  const keys: number[] = []
  let key = NaN
  for (let i = 0; i < bars.n; i++) {
    const k = keyOf(bars.time[i])
    if (k !== key) {
      if (k < key) throw new Error(`candle keys go back at bar ${i}`)
      key = k
      keys.push(k)
    }
    ofMinute[i] = keys.length - 1
  }
  const n = keys.length
  const c: NyChart = {
    n,
    start: Float64Array.from(keys, startOf),
    stop: Float64Array.from(keys, stopOf),
    name: Int32Array.from(keys),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    first: new Int32Array(n),
    end: new Int32Array(n),
    ofMinute,
    tr: new Float64Array(0),
    atr: new Float64Array(0),
  }
  let j = -1
  for (let i = 0; i < bars.n; i++) {
    if (ofMinute[i] !== j) {
      j = ofMinute[i]
      c.open[j] = bars.open[i]
      c.high[j] = bars.high[i]
      c.low[j] = bars.low[i]
      c.first[j] = i
    } else {
      if (bars.high[i] > c.high[j]) c.high[j] = bars.high[i]
      if (bars.low[i] < c.low[j]) c.low[j] = bars.low[i]
    }
    c.close[j] = bars.close[i]
    c.end[j] = i + 1
  }
  c.tr = trueRanges(c.high, c.low, c.close)
  c.atr = atr14(c.tr)
  return c
}

/** Days, named Monday to Friday by the date they end on. */
export const buildDays = (bars: Bars) => buildNyChart(bars, dayNameOf, dayStart, dayClose)

/** 4-hour candles from 17, 21, 01, 05, 09 and 13 New York time. */
export const buildFourHours = (bars: Bars) =>
  buildNyChart(bars, fourHourKey, fourHourStart, (k) => fourHourStart(k + 1))

/** Weeks: the days named Monday to Friday of one calendar week. */
export interface Weeks {
  n: number
  /** First and last day of each week. */
  firstDay: Int32Array
  lastDay: Int32Array
  high: Float64Array
  low: Float64Array
}

export function buildWeeks(days: NyChart): Weeks {
  const firstDay: number[] = []
  const lastDay: number[] = []
  const high: number[] = []
  const low: number[] = []
  let key = NaN
  for (let d = 0; d < days.n; d++) {
    const w = weekNameOf(days.name[d])
    if (w !== key) {
      key = w
      firstDay.push(d)
      lastDay.push(d)
      high.push(days.high[d])
      low.push(days.low[d])
    } else {
      const k = firstDay.length - 1
      lastDay[k] = d
      if (days.high[d] > high[k]) high[k] = days.high[d]
      if (days.low[d] < low[k]) low[k] = days.low[d]
    }
  }
  return {
    n: firstDay.length,
    firstDay: Int32Array.from(firstDay),
    lastDay: Int32Array.from(lastDay),
    high: Float64Array.from(high),
    low: Float64Array.from(low),
  }
}

/**
 * The ATR in force for the minutes of each day: the ATR at the last existing
 * day before it (NaN on the first 14 days).
 */
export function atrInForce(days: NyChart): Float64Array {
  const out = new Float64Array(days.n).fill(NaN)
  for (let d = 1; d < days.n; d++) out[d] = days.atr[d - 1]
  return out
}

/** First minute of the 15th existing day (nothing is watched before it), or bars.n. */
export const fifteenthDay = (days: NyChart, n: number) => (days.n >= 15 ? days.first[14] : n)

/** 15-minute candles on UTC clock boundaries (the harmonic study's chart builder). */
export const buildQuarters = (bars: Bars): Chart => buildChart(bars, 15)

// ---------------------------------------------------------------- round numbers

/** Round numbers and twin grids of a market, in whole units of 1 / unit. */
export interface RoundGrid {
  market: HarmonicMarket
  costs: MarketCosts
  /** Prices are counted in units of 1 / unit (1e5 for EUR/USD, 1e3 for the yen, 1e2 for gold). */
  unit: number
  /** Half-figure spacing in units (50 pips; gold $10). */
  half: number
  /** Big-figure spacing in units (100 pips; gold $50). */
  big: number
  /** The 41 grid offsets in units, and their labels. */
  offsets: number[]
  labels: string[]
}

export function roundGrid(market: HarmonicMarket): RoundGrid {
  const costs = MARKET_COSTS[market]
  const gold = market === 'XAUUSD'
  const yen = costs.pip === 0.01
  const unit = gold ? 100 : yen ? 1000 : 100_000
  const offsets: number[] = []
  const labels: string[] = []
  for (let i = 0; i <= 40; i++) {
    // Pairs: 15.0 to 35.0 pips in steps of 0.5 (a pip is 10 units). Gold: $3.00 to $7.00 in $0.10.
    const u = gold ? 300 + 10 * i : 150 + 5 * i
    offsets.push(u)
    labels.push(gold ? (u / 100).toFixed(2) : (u / 10).toFixed(1))
  }
  return { market, costs, unit, half: gold ? 1000 : 500, big: gold ? 5000 : 1000, offsets, labels }
}

/** Distance from a price to the nearest round number (R00 or R50) of the market. */
export function roundDistance(g: RoundGrid, x: number): number {
  const k = Math.round((x * g.unit) / g.half)
  return Math.abs(x - (k * g.half) / g.unit)
}

/** A band "sits on a round number" when its nearest edge lies within 0.05 x ATR of one. */
export const nearRound = (g: RoundGrid, lo: number, hi: number, atr: number) =>
  Math.min(roundDistance(g, lo), roundDistance(g, hi)) <= 0.05 * atr + TOL
