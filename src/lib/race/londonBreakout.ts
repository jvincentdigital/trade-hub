import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'

// London breakout (added 2026-11-10 for John's London open). The course's
// "Asian range" idea (docs/strategies/marvel-fx-method.md: the range Asia
// builds, then London runs one side of it): mark the high and low of the
// Asian session, then trade the first 15-minute close outside it during the
// London open. Pure, tested. Times are UTC; Puerto Rico (AST) is UTC-4.
//
// - Asian range: high and low of the 15m candles from 00:00 to 06:00 UTC.
// - Trade window: 15m candles that start 06:00-09:45 UTC (close by 10:00).
// - Buy when a candle CLOSES above the range high, sell below the low. Only
//   the first break of the day counts, on weekdays only.
// - Stop: the middle of the range or 1x ATR(14) on 15m, whichever is closer
//   to the entry, but never closer than 0.5x ATR. Target 2R.
// - Skip the day when the range is wider than 1.5x the 20-day average Asian
//   range (news day) or narrower than 0.3x (dead day). The average comes from
//   1h candles, since Kraken's 15m history is only 7.5 days.

export const LONDON_BREAKOUT = {
  id: 'london-breakout',
  name: 'London breakout',
  markets: ['GBP-USD', 'GBP-JPY', 'EUR-GBP', 'pax-gold'],
  rr: 2,
  why: 'Stop at the middle of the Asian range or 1x the 15-minute ATR, whichever is closer, never under half an ATR. Target 2 times the stop distance.',
} as const

const H = 3600
const DAY = 86_400
const M15 = 900
export const ASIA_END_H = 6
export const WINDOW_END_H = 10
const AVG_DAYS = 20
const MIN_AVG_DAYS = 10
export const MAX_RANGE_X = 1.5
export const MIN_RANGE_X = 0.3

/** Simple average of the last `period` true ranges, aligned to candle indexes (NaN until enough). */
export function atrSeries(candles: OHLCCandle[], period = 14): number[] {
  const tr = candles.map((c, i) => {
    const prev = candles[i - 1]?.close
    return prev == null
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev))
  })
  return tr.map((_, i) =>
    i < period - 1 ? NaN : tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period,
  )
}

const isWeekday = (dayStart: number) => {
  const d = new Date(dayStart * 1000).getUTCDay()
  return d >= 1 && d <= 5
}

/** High and low of the candles that start in [from, to). */
function span(candles: OHLCCandle[], from: number, to: number) {
  const inside = candles.filter((c) => c.time >= from && c.time < to)
  if (!inside.length) return null
  return {
    high: Math.max(...inside.map((c) => c.high)),
    low: Math.min(...inside.map((c) => c.low)),
    n: inside.length,
  }
}

/** Today's Asian range from 15m candles; null unless at least 20 of the 24 candles are there. */
export function asianRange(m15: OHLCCandle[], dayStart: number) {
  const r = span(m15, dayStart, dayStart + ASIA_END_H * H)
  return r && r.n >= 20 ? { high: r.high, low: r.low } : null
}

/** Average Asian range width over the last 20 weekdays before `dayStart` with all six 1h candles. */
export function avgAsianRange(
  h1: OHLCCandle[],
  dayStart: number,
): { avg: number; days: number } | null {
  const widths: number[] = []
  for (
    let d = dayStart - DAY;
    widths.length < AVG_DAYS && d >= (h1[0]?.time ?? Infinity);
    d -= DAY
  ) {
    if (!isWeekday(d)) continue
    const r = span(h1, d, d + ASIA_END_H * H)
    if (r && r.n === ASIA_END_H) widths.push(r.high - r.low)
  }
  if (widths.length < MIN_AVG_DAYS) return null
  return { avg: widths.reduce((a, b) => a + b, 0) / widths.length, days: widths.length }
}

export interface LondonCheck {
  signal: Signal | null
  /** Plain words for logs and Claude's brief: why there is or is not a trade. */
  note: string
  range: { high: number; low: number; avg: number | null } | null
}

/**
 * Today's London breakout for one market, on CLOSED candles only (a candle
 * still forming at `nowSec` is ignored). A break counts only while it is one
 * of the last `fresh` closed 15m candles, so a missed tick does not chase an
 * old move. Entry in the signal is the break candle's close.
 */
export function londonBreakout(
  m15: OHLCCandle[],
  h1: OHLCCandle[],
  nowSec: number,
  fresh = 2,
): LondonCheck {
  const closed = m15.filter((c) => c.time + M15 <= nowSec)
  const dayStart = Math.floor(nowSec / DAY) * DAY
  const none = (note: string, range: LondonCheck['range'] = null): LondonCheck => ({
    signal: null,
    note,
    range,
  })
  if (!isWeekday(dayStart)) return none('weekend, no London session')
  if (nowSec < dayStart + ASIA_END_H * H) return none('Asian range still forming')
  const asia = asianRange(closed, dayStart)
  if (!asia) return none('Asian range incomplete (missing candles)')
  const avg = avgAsianRange(h1, dayStart)
  const range = { ...asia, avg: avg?.avg ?? null }
  if (!avg) return none('not enough history for the 20-day average range', range)
  const x = (asia.high - asia.low) / avg.avg
  const xs = `${x.toFixed(2)}x the ${avg.days}-day average`
  if (x > MAX_RANGE_X) return none(`range too wide (${xs}), news day: skip`, range)
  if (x < MIN_RANGE_X) return none(`range too narrow (${xs}), dead day: skip`, range)

  const winFrom = dayStart + ASIA_END_H * H
  const winTo = dayStart + WINDOW_END_H * H
  const idx = closed.findIndex(
    (c) => c.time >= winFrom && c.time < winTo && (c.close > asia.high || c.close < asia.low),
  )
  if (idx < 0)
    return none(nowSec >= winTo ? `no break by 10:00 UTC (${xs})` : `no break yet (${xs})`, range)
  const bar = closed[idx]
  const at = new Date(bar.time * 1000).toISOString().slice(11, 16)
  if (closed.length - 1 - idx >= fresh)
    return none(`first break was at ${at} UTC, already used or too old`, range)

  const atr = atrSeries(closed.slice(0, idx + 1)).at(-1) ?? NaN
  if (!(atr > 0)) return none('no ATR yet', range)
  const long = bar.close > asia.high
  const entry = bar.close
  const toMid = Math.abs(entry - (asia.high + asia.low) / 2)
  const dist = Math.max(0.5 * atr, Math.min(toMid, atr))
  const stop = long ? entry - dist : entry + dist
  const takeProfit = long ? entry + LONDON_BREAKOUT.rr * dist : entry - LONDON_BREAKOUT.rr * dist
  return {
    signal: {
      index: idx,
      time: bar.time,
      direction: long ? 'long' : 'short',
      entry,
      stop,
      takeProfit,
    },
    note: `${long ? 'broke above' : 'broke below'} the Asian range at ${at} UTC (${xs})`,
    range,
  }
}
