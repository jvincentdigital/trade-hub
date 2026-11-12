import type { OHLCCandle } from '../types/market'
import { fibLevel } from '../lab/fib'
import {
  inRaceHours,
  isTradingDay,
  londonMarket,
  M15,
  planFrom,
  sessionFor,
  trackDay,
  V1,
  type LondonMarketId,
} from '../lab/johnsLondon'
import { inWindow, newsWindows, nextWindowStart, type NewsEvent } from '../lab/news'
import type { RaceStrategy } from './live'
import type { LabSignal } from './labBots'
import { atrSeries } from './londonBreakout'

// John's London v1 in the live race (SPEC.md section 6,
// ~/jvd-outputs/2026-11-11/london-strategy). It passed its six lines on the
// clean year (97 trades, +27.6R, seen twice), so it joins as a race account
// of its own. The setups are rebuilt every tick with the backtest's own pure
// code (trackDay in src/lib/lab/johnsLondon.ts) on closed Kraken 15-minute
// candles; this file only adds the live parts: feed checks, one look per
// signal (catch-up up to 4 candles), the plan at the price now, red news from
// Forex Factory and the 2-a-day count from race.json. Frozen settings
// k = 2, b = 0.5 (docs/london-v1-freeze.md). v1-NY, v1-flip and thirds did
// not earn a place. Play money only. Pure, tested.

export const JOHNS_LONDON = {
  id: 'johns-london-v1',
  name: "John's London v1",
  markets: ['GBP-USD', 'pax-gold'],
  /** The frozen picks: move of 2 ATRs, stop half an ATR past 1. */
  k: 2,
  b: 0.5,
  why: "John's Fib on 15-minute candles, 07:00 to 15:00 London: after a move of 2x ATR within 12 candles, sell the pullback to 0.786 that does not break 1 (buy mirrored), at the candle close. Stop half an ATR past 1 (at least 10x the costs, plan 1.5R to 2.5R), half off at 0, the rest at -0.272. Flat by 16:30 London and 30 minutes before red news. At most 2 trades per market a day. GBP/USD stops and targets count only when a close or the next candle confirms them.",
} as const

export type JohnsLondonMarket = (typeof JOHNS_LONDON.markets)[number]
const LAB_ID: Record<JohnsLondonMarket, LondonMarketId> = {
  'GBP-USD': 'GBPUSD',
  'pax-gold': 'XAUUSD',
}

const MIN = 60
/** A signal is acted on up to 4 candles after its close (a late tick must not lose the day). */
export const CATCH_UP = 60 * MIN
/** The newest closed candle must have closed less than this long ago. */
export const FEED_MAX_AGE = 30 * MIN

export interface JohnsLondonInput {
  market: JohnsLondonMarket
  /** CLOSED Kraken 15-minute candles, oldest first (spike cap and weekend rule already applied). */
  closed: OHLCCandle[]
  nowSec: number
  /** The price a trade would open at now. */
  price: number
  /** Forex Factory "High" events; null when the list could not be read (then no new trade). */
  news: NewsEvent[] | null
  /** This account's looked-at mark for the market (lastSignal). */
  seen: number
  /** Trades this account opened in this market today (UTC date), open and closed. */
  todayEntries: number
  /** The race fee per side for this market (sizing stop). */
  feeRate: number
}

export interface JohnsLondonCheck {
  signal: LabSignal | null
  /** Plain words for the log: why there is or is not a trade. */
  note: string
  /** The forced close of a trade opened now: 16:30 London, or 30 minutes before red news. */
  deadline?: number
  /** The stop the sizer uses: the real stop plus the race fee on both sides, so a stop-out costs 2%. */
  sizeStop?: number
  /** A signal looked at and passed: move the account's mark to it. */
  seen?: number
  /** Inside a red-news block for this market: close its open trade now. */
  closeNow: boolean
}

/** Feed checks (6, step 2): fresh (newest closed candle under 30 minutes old) and not thin (14 of the last 20 move). */
export function feedProblem(closed: OHLCCandle[], nowSec: number): string | null {
  const last = closed.at(-1)
  if (!last || nowSec - (last.time + M15) >= FEED_MAX_AGE)
    return 'feed frozen (no closed candle in the last 30 minutes)'
  const moving = closed.slice(-V1.aliveSlots).filter((c) => c.high > c.low).length
  if (moving < V1.aliveMin) return `feed thin (${moving} of the last 20 candles moved, 14 needed)`
  return null
}

/** Distinct entry times of this account's trades in a market on the UTC date of `nowSec` (a trade closed in halves counts once). */
export function entriesToday(s: RaceStrategy, market: string, nowSec: number): number {
  const day = Math.floor(nowSec / 86_400) * 86_400
  const times = new Set(
    [...s.open, ...s.closed]
      .filter((t) => t.market === market && t.entryTime >= day && t.entryTime < day + 86_400)
      .map((t) => t.entryTime),
  )
  return times.size
}

const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16)

/**
 * One market's check at `nowSec`. Rebuilds today's setups from session start
 * (2.3), takes the newest signal that closed within the last 60 minutes and
 * is newer than the mark, and works out the trade at the price now (2.5, the
 * 1.5R minimum, no chase against the signal close). Any signal it looks at
 * is either handed over or returned as `seen`, so each gets one look.
 */
export function johnsLondonCheck(i: JohnsLondonInput): JohnsLondonCheck {
  const { market, closed, nowSec, price, news } = i
  const m = londonMarket(LAB_ID[market])
  const windows = news ? newsWindows(news, m.currencies, 'block') : []
  const closeNow = inWindow(windows, nowSec)
  const none = (note: string, seen?: number): JohnsLondonCheck => ({
    signal: null,
    note,
    closeNow,
    ...(seen != null ? { seen } : {}),
  })
  const day = Math.floor(nowSec / 86_400) * 86_400
  if (!isTradingDay(day)) return none('weekend, no London session')
  const s = sessionFor(day)
  if (nowSec < s.start + M15) return none(`session starts ${hhmm(s.start)} UTC`)
  const feed = feedProblem(closed, nowSec)
  if (feed) return none(`${feed}: no new trade`)

  const atr = atrSeries(closed, V1.atrPeriod)
  const { signals } = trackDay(closed, atr, s, JOHNS_LONDON.k)
  const sig = signals.filter((x) => x.time > i.seen && nowSec - x.T <= CATCH_UP).at(-1)
  if (!sig) return none(signals.length ? 'no new signal' : 'no signal today yet')
  const long = sig.long
  const what = `${long ? 'BUY' : 'SELL'} signal on the ${hhmm(sig.time)} UTC candle (1 ${sig.one}, 0 ${sig.zero}, level ${sig.level.toPrecision(6)})`
  const pass = (why: string) => none(`${what}: ${why}`, sig.time)

  if (i.todayEntries >= V1.maxPerDay) return pass('2 trades in this market today already')
  const since = closed.filter((c) => c.time >= sig.T)
  const past1 = since.some((c) => (long ? c.low < sig.one : c.high > sig.one))
  const atZero = since.some((c) => (long ? c.high >= sig.zero : c.low <= sig.zero))
  if (past1 || atZero) return pass(past1 ? 'price traded past 1 since' : 'price reached 0 since')
  if (!news) return pass('no red-news list this tick')
  if (closeNow) return pass('red news block')
  const deadline = Math.min(s.timeExit, nextWindowStart(windows, nowSec))
  if (deadline - nowSec < V1.minLife) return pass('under 90 minutes to the forced close')
  if (!inRaceHours(s, nowSec)) return pass("outside John's race hours")
  if (!(price > 0)) return pass('no price')

  const rawStop = long ? sig.one - JOHNS_LONDON.b * sig.atr : sig.one + JOHNS_LONDON.b * sig.atr
  const tp1 = sig.zero
  const tp2 = fibLevel(sig.one, sig.zero, V1.tp2Level)
  const plan = planFrom(m, long, price, price, rawStop, tp1, tp2)
  if ('why' in plan) return pass(plan.why)
  if (plan.rr < V1.rrMin) return pass(`plan ${plan.rr.toFixed(2)}R, under 1.5R`)
  const close = closed[sig.i].close
  const ref = planFrom(m, long, close, close, rawStop, tp1, tp2)
  if ('why' in ref) return pass('no chase: no plan at the signal close')
  if (plan.reward < V1.noChase * ref.reward || plan.rr < V1.noChase * ref.rr)
    return pass('no chase: the price ran from the signal close')

  const fees = i.feeRate * (price + plan.stop)
  return {
    signal: {
      index: sig.i,
      time: sig.time,
      direction: long ? 'long' : 'short',
      entry: price,
      stop: plan.stop,
      takeProfit: tp2,
      target1: tp1,
      moveStart: closed[sig.oneIdx].time,
    },
    note: `${what}: plan ${plan.rr.toFixed(2)}R, flat by ${hhmm(deadline)} UTC`,
    deadline,
    sizeStop: long ? plan.stop - fees : plan.stop + fees,
    closeNow,
  }
}

/**
 * The clock line (6, "Clock"): on the first tick of a London session, the
 * tick time, and LATE START when it came more than 15 minutes after the
 * session start. Null on every other tick.
 */
export function sessionClock(prevTickSec: number | null, nowSec: number): string | null {
  const day = Math.floor(nowSec / 86_400) * 86_400
  if (!isTradingDay(day)) return null
  const s = sessionFor(day)
  if (nowSec < s.start || nowSec >= s.timeExit) return null
  if (prevTickSec != null && prevTickSec >= s.start) return null
  const gap = nowSec - s.start
  const line = `first tick of the London session at ${hhmm(nowSec)} UTC (session start ${hhmm(s.start)})`
  return gap > 15 * MIN ? `${line}, LATE START by ${Math.round(gap / MIN)} minutes` : line
}
