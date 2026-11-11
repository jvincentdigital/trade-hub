import type { OHLCCandle } from '../types/market'
import { latestSignal, type Signal } from '../rules/engine'
import { BUILT_IN_RULES } from '../rules/presets'
import { johnsFib } from '../lab/fib'
import { inWindow, nextWindowStart, overlapsWindow, type NewsMode, type Window } from '../lab/news'
import { deadlineFor, entryAllowed, inLondonSession, type Style } from '../lab/time'

// The strategy lab's top 5 (docs/strategy-lab.md, "Top 5 in the live race"),
// each as its own play-money race account at the race's start money. Picked
// by the lab's rule on 2026-11-11: out-of-sample profit factor, at least 30
// out-of-sample trades, drawdown under 25%, a small in/out gap, at most 2 per
// strategy family. The settings below are the ones each bot chose in-sample.
// These are a forward test, not proven edges: every one of them has a
// bootstrap interval that includes zero. Pure, tested. Play money only.

export type LabBotCandles =
  /** Kraken's own candles of that size (UTC boundaries). */
  | 'kraken'
  /** 4h candles built from Kraken 1h on the 17:00 New York close, as the lab tested them. */
  | 'kraken-ny4h'
  /** US30: Dow futures (YM=F) 1h from Yahoo Finance's public chart feed. */
  | 'yahoo'

export interface LabBot {
  id: string
  name: string
  /** The lab bot it comes from (results.json id). */
  labId: string
  market: string
  tf: '1h' | '4h'
  candles: LabBotCandles
  style: Style
  news: Exclude<NewsMode, 'day'>
  /** Currencies whose red news the filter watches. */
  currencies: string[]
  kind: 'rule' | 'fib'
  ruleId?: string
  rr?: number
  fib?: { k: number; entry: number; londonOnly?: boolean }
  /** Plain words for Today and the race page. */
  why: string
  candleWords: string
  rrWords: string
}

export const LAB_BOTS: LabBot[] = [
  {
    id: 'lab-rsi-us30',
    name: 'Lab: RSI range reversal, US30 1h',
    labId: 'rsi-range-reversal|1h-race|US30|block',
    market: 'US30',
    tf: '1h',
    candles: 'yahoo',
    style: 'race',
    news: 'block',
    currencies: ['USD'],
    kind: 'rule',
    ruleId: 'rsi-range-reversal',
    rr: 2,
    why: 'The race baseline rule (price at the 20-candle low or high, RSI past 30/70, a same-way candle pattern) on the Dow only. Stop past the 5-candle swing plus 0.3%, target 2x the stop. No new trade 30 minutes either side of red US news. Dow prices: futures (YM=F) from Yahoo Finance, play money only.',
    candleWords: '1-hour',
    rrWords: '2x',
  },
  {
    id: 'lab-fib-eurusd-4h',
    name: "Lab: John's Fib, EUR/USD 4h",
    labId: 'fib|4h-swing|EURUSD|off',
    market: 'EUR-USD',
    tf: '4h',
    candles: 'kraken-ny4h',
    style: 'swing',
    news: 'off',
    currencies: ['EUR', 'USD'],
    kind: 'fib',
    fib: { k: 2, entry: 0.786 },
    why: "John's Fib on 4-hour candles (New York close): after a move of 2x ATR within 12 candles, sell the pullback to 0.786 (buy mirrored); stop a quarter ATR past 1, half off at 0, the rest at -0.272; out after 5 days at most.",
    candleWords: '4-hour',
    rrWords: 'half at 0, rest at -0.272',
  },
  {
    id: 'lab-ema1236-gold-4h',
    name: 'Lab: MFX EMA 12/36 pullback, gold 4h',
    labId: 'mfx-ema-12-36-pullback|4h-race|XAUUSD|block',
    market: 'pax-gold',
    tf: '4h',
    candles: 'kraken',
    style: 'race',
    news: 'block',
    currencies: ['USD'],
    kind: 'rule',
    ruleId: 'mfx-ema-12-36-pullback',
    rr: 3,
    why: 'The course EMA rule on gold only: EMA 12 over 36 and price over the 200 (or all under), buy the dip to the 36 that closes back on the trend side. Target 3x the stop. No new trade 30 minutes either side of red US news.',
    candleWords: '4-hour',
    rrWords: '3x',
  },
  {
    id: 'lab-fib-london-us30',
    name: "Lab: John's Fib (London hours), US30 1h",
    labId: 'fib-london|1h-day|US30|close',
    market: 'US30',
    tf: '1h',
    candles: 'yahoo',
    style: 'day',
    news: 'close',
    currencies: ['USD'],
    kind: 'fib',
    fib: { k: 4, entry: 0.886, londonOnly: true },
    why: "John's Fib on the Dow, only 08:00-16:00 London time: after a move of 4x ATR within 12 candles, sell the pullback to 0.886 (buy mirrored); stop a quarter ATR past 1, half off at 0, the rest at -0.272. Day trade: flat by 17:00 New York, and closed before red US news.",
    candleWords: '1-hour',
    rrWords: 'half at 0, rest at -0.272',
  },
  {
    id: 'lab-stophunt-gold-1h',
    name: 'Lab: MM stop hunt reversal, gold 1h',
    labId: 'mm-stop-hunt-reversal|1h-race|XAUUSD|close',
    market: 'pax-gold',
    tf: '1h',
    candles: 'kraken',
    style: 'race',
    news: 'close',
    currencies: ['USD'],
    kind: 'rule',
    ruleId: 'mm-stop-hunt-reversal',
    rr: 3,
    why: 'The course stop-hunt rule on gold only: a W or M after a run past the recent low or high, with a reversal candle, at the London or New York open. Target 3x the stop. Open trades close before red US news.',
    candleWords: '1-hour',
    rrWords: '3x',
  },
]

/** Race-only markets (not in the app's instrument list: no price feed on the other pages). */
export const RACE_ONLY_MARKETS: Record<
  string,
  { label: string; leverage: number; feeRate: number; quote: 'USD' }
> = {
  // Fee: about the lab's 2.5 points of spread and slippage a round trip at 50,000.
  US30: { label: 'US30 (Dow futures)', leverage: 20, feeRate: 0.000025, quote: 'USD' },
}

export const LAB_MAX_DAYS: Record<Style, string> = {
  scalp: 'out by the end of its session',
  day: 'flat by 17:00 New York',
  swing: 'out after 5 days at most',
  position: 'out after 30 days at most',
  race: 'out after 10 days at most',
}

export interface LabSignal extends Signal {
  /** First target: half the position closes there (John's Fib). */
  target1?: number
}

export interface LabCheck {
  signal: LabSignal | null
  note: string
  /** Latest time a trade opened now may stay open. */
  deadline: number
}

const TF_SEC = { '1h': 3600, '4h': 14_400 } as const

/** A Fib trade only opens while the price has gone at most this share of the way from its level to the first target. */
export const FIB_NO_CHASE = 0.25

/**
 * One lab bot's check on CLOSED candles of its own size at `nowSec`, with the
 * price a trade would open at. Rules: the race's latestSignal with the bot's
 * target. Fib: a level touched in one of the last 2 closed candles (the lab
 * fills a limit order there; live, the trade opens at the price now, and only
 * while that price is still near the level). News: "block" and "close" bots
 * open nothing inside a red-news window (close: nor when one starts within
 * the next candle).
 */
export function labCheck(
  bot: LabBot,
  closed: OHLCCandle[],
  nowSec: number,
  price: number,
  windows: Window[],
): LabCheck {
  const deadline = deadlineFor(bot.style, nowSec)
  const none = (note: string): LabCheck => ({ signal: null, note, deadline })
  if (!entryAllowed(bot.style, nowSec)) return none('after 16:00 New York: no new day trades')
  if (bot.news !== 'off' && windows.length) {
    const blocked =
      bot.news === 'block'
        ? inWindow(windows, nowSec)
        : overlapsWindow(windows, nowSec, nowSec + TF_SEC[bot.tf])
    if (blocked) return none('red news window: no new trades')
  }
  if (bot.kind === 'rule') {
    const rule = BUILT_IN_RULES.find((r) => r.id === bot.ruleId)
    if (!rule) return none(`unknown rule ${bot.ruleId}`)
    const s = latestSignal({ ...rule, rr: bot.rr ?? rule.rr, timeframe: bot.tf }, closed)
    return s
      ? {
          signal: s,
          note: `${s.direction} signal on the ${new Date(s.time * 1000).toISOString().slice(0, 16)}Z candle`,
          deadline,
        }
      : none('no signal')
  }
  const f = bot.fib!
  const entries = johnsFib(closed, {
    k: f.k,
    entry: f.entry,
    allow: f.londonOnly ? (i) => inLondonSession(closed[i].time) : undefined,
  })
  const last = entries.filter((e) => e.kind === 'limit' && e.i >= closed.length - 2).at(-1)
  if (!last || last.price == null || last.target1 == null) return none('no Fib level touched')
  const long = last.direction === 'long'
  const ran = (long ? price - last.price : last.price - price) / Math.abs(last.target1 - last.price)
  if (ran > FIB_NO_CHASE)
    return none(
      `Fib level ${last.price} touched, but the price ran ${(ran * 100).toFixed(0)}% of the way to 0: no chase`,
    )
  return {
    signal: {
      index: last.i,
      time: closed[last.i].time,
      direction: last.direction,
      entry: last.price,
      stop: last.stop,
      takeProfit: last.target,
      target1: last.target1,
    },
    note: `${last.direction} at the Fib level ${last.price} (touched on the ${new Date(closed[last.i].time * 1000).toISOString().slice(0, 16)}Z candle)`,
    deadline,
  }
}

/**
 * Should a "close" bot close its open trades now? Yes inside a red-news
 * window, or when one starts within the next candle of its size (the lab
 * closes at the open of the candle the window starts in).
 */
export function newsCloseDue(bot: LabBot, windows: Window[], nowSec: number): boolean {
  if (bot.news !== 'close' || !windows.length) return false
  return inWindow(windows, nowSec) || nextWindowStart(windows, nowSec) <= nowSec + TF_SEC[bot.tf]
}
