import { z } from 'zod'
import type { OHLCCandle } from '../types/market'
import { getInstrument } from '../paper/instruments'
import { pipSize } from '../sizing/sizing'
import { eventSpans, type NewsEvent } from '../lab/news'
import { DAY, HOUR, nyOffset } from '../lab/time'
import { atrSeries } from './londonBreakout'

// The confidence checklist on each new race trade (John, 2026-11-12): the
// three leads from the indicator test (jvd-outputs/2026-11-12/johns-method/
// INDICATOR-TEST.md) that pointed the right way in both test years. None is
// proven. Information only: it is worked out after a trade opens and never
// blocks or changes one. Pure, tested.

const checkSchema = z.object({
  /** True: the lead holds. False: it does not. Null: it could not be checked. */
  ok: z.boolean().nullable(),
  /** One short line, as the trade rows show it. */
  text: z.string(),
})
export type Check = z.infer<typeof checkSchema>

export const tradeChecksSchema = z.object({
  news: checkSchema,
  calm: checkSchema,
  round: checkSchema,
})
export type TradeChecks = z.infer<typeof tradeChecksSchema>

export const CHECKLIST_NOTE = 'Leads from our tests, not proven. They never block a trade.'
export const NOT_CHECKED = 'Checklist: not checked (opened before it was added).'

export interface ChecklistInput {
  market: string
  entry: number
  stop: number
  /** Unix seconds. */
  entryTime: number
  /** Start of the setup's move (Fib 1), for strategies that have one. */
  moveStart?: number
  /** Red ("High") news; null when no list could be read. */
  news: NewsEvent[] | null
  /** CLOSED 1-hour candles at entry, oldest first ([] when the race has none for the market). */
  h1: OHLCCandle[]
}

const FIAT = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF']

/** Whose red news counts: a forex pair's two currencies; USD for gold, crypto and US30. */
export function newsCurrencies(market: string): string[] {
  const parts = (getInstrument(market)?.symbol ?? '').split('/').filter((c) => FIAT.includes(c))
  return parts.length ? parts : ['USD']
}

/** 1. No red news within 30 minutes of the entry (BoJ: its whole windows, as the race's news filter). */
function newsCheck(i: ChecklistInput): Check {
  if (!i.news) return { ok: null, text: 'No news list at entry, not checked' }
  const cur = newsCurrencies(i.market)
  const t = i.entryTime
  const near = i.news.find(
    (e) => cur.includes(e.currency) && eventSpans(e).some((w) => w.from <= t && t <= w.to),
  )
  return near
    ? { ok: false, text: `Red news within 30 min: ${near.event} (${near.currency})` }
    : { ok: true, text: 'No red news within 30 min' }
}

/**
 * 2. A calmer market: the 1-hour ATR(14) now is below the one at the start of
 * the setup's move, or, with no move, below its 20-day average.
 */
function calmCheck(i: ChecklistInput): Check {
  const short = { ok: null, text: 'Not enough 1-hour candles for the calm check' }
  const atr = atrSeries(i.h1, 14)
  const now = atr[atr.length - 1]
  if (!(now > 0)) return short
  if (i.moveStart != null) {
    // The last 1-hour candle closed when the move started.
    let k = -1
    while (k + 1 < i.h1.length && i.h1[k + 1].time + HOUR <= i.moveStart) k++
    const ref = atr[k]
    if (!(ref > 0)) return short
    return now < ref
      ? { ok: true, text: 'Calmer than at the start of the move' }
      : { ok: false, text: 'Not calmer than at the start of the move' }
  }
  const first = i.h1.findIndex((c) => c.time >= i.entryTime - 20 * DAY)
  // A candle before the window, and an ATR on every candle in it: 20 full days.
  const days = first > 0 ? atr.slice(first) : []
  if (!days.length || days.some((a) => !(a > 0))) return short
  const avg = days.reduce((a, b) => a + b, 0) / days.length
  return now < avg
    ? { ok: true, text: 'Calmer than its 20-day average' }
    : { ok: false, text: 'Not calmer than its 20-day average' }
}

/** Round levels: every 50 pips on forex (0.50 on yen pairs), every $10 on gold; none elsewhere. */
export function roundStep(market: string): number | null {
  const inst = getInstrument(market)
  if (inst?.market === 'metals') return 10
  const pip = pipSize(inst)
  return pip != null ? 50 * pip : null
}

/** Daily candles that close at 17:00 New York, from 1-hour candles; the day of `nowSec` is left out. */
function dailyBars(h1: OHLCCandle[], nowSec: number): OHLCCandle[] {
  const dayOf = (t: number) => Math.floor((t + (nyOffset(t) + 7) * HOUR) / DAY)
  const today = dayOf(nowSec)
  const out: OHLCCandle[] = []
  let key = NaN
  for (const b of h1) {
    const k = dayOf(b.time)
    if (k >= today) break
    const c = out[out.length - 1]
    if (k !== key || !c) {
      key = k
      out.push({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })
    } else {
      c.high = Math.max(c.high, b.high)
      c.low = Math.min(c.low, b.low)
      c.close = b.close
    }
  }
  return out
}

/** 3. A round number within 0.1 x the daily ATR(14) of the entry or the stop. */
function roundCheck(i: ChecklistInput): Check {
  const step = roundStep(i.market)
  if (step == null) return { ok: null, text: 'No round-number levels set for this market' }
  const atrD = atrSeries(dailyBars(i.h1, i.entryTime), 14).at(-1)
  if (!(atrD != null && atrD > 0))
    return { ok: null, text: 'Not enough candles for the round-number check' }
  const near = (p: number) => {
    const level = Math.round(p / step) * step
    return Math.abs(level - p) <= 0.1 * atrD ? level : null
  }
  const fmt = (l: number) =>
    step >= 10 ? `$${Math.round(l).toLocaleString('en-US')}` : l.toFixed(step < 0.01 ? 4 : 2)
  const atEntry = near(i.entry)
  if (atEntry != null) return { ok: true, text: `Round number ${fmt(atEntry)} near the entry` }
  const atStop = near(i.stop)
  if (atStop != null) return { ok: true, text: `Round number ${fmt(atStop)} near the stop` }
  return { ok: false, text: 'No round number near the entry or stop' }
}

/** The three checks for a trade at its entry. */
export function tradeChecks(i: ChecklistInput): TradeChecks {
  return { news: newsCheck(i), calm: calmCheck(i), round: roundCheck(i) }
}

/**
 * Open trades with each one opened this check given its checklist; every
 * other trade as it was. A check that throws leaves its trade unchecked, so
 * the checklist can never stop or change a trade.
 */
export function withChecks<T extends { market: string; entryTime: number }>(
  open: T[],
  opened: { market: string; entryTime: number }[],
  check: (t: T) => TradeChecks,
): T[] {
  if (!opened.length) return open
  return open.map((t) => {
    if (!opened.some((o) => o.market === t.market && o.entryTime === t.entryTime)) return t
    try {
      return { ...t, checks: check(t) }
    } catch {
      return t
    }
  })
}
