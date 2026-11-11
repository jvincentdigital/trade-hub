// Strategy lab engine: one market, one position at a time, with the race's
// backtest rules (enter at the next candle's open, the stop counts first when
// a candle touches both, gaps through a level fill at the open, fees per
// side) plus the bid-ask spread and slippage. Prices in the history are BID:
// a buy pays the ask (bid + spread) and sells back at the bid; a short sells
// at the bid and buys back at the ask, so its stop and target are checked on
// the ask. Market fills (entries at the open, stops, time and news exits) also
// pay slippage; limit fills (a planned entry level, targets) do not. Output
// trades are the race's `Candidate`, so `portfolioBacktest` sizes them (2%
// risk, 5 open, 10% open risk, margin by leverage). Pure, tested.

import type { OHLCCandle } from '../types/market'
import type { Candidate } from '../race/leaderboard'
import {
  costMultAt,
  slippageAt,
  spreadAt,
  swapCost,
  TF_SEC,
  type LabMarket,
  type LabTf,
} from './markets'
import { inWindow, nextWindowStart, overlapsWindow, type NewsMode, type Window } from './news'
import { DAY, dayStart, deadlineFor, entryAllowed, utcWeekday, type Style } from './time'

export type Direction = 'long' | 'short'

/** A planned trade from a strategy, before the engine decides whether it can open. */
export interface LabEntry {
  /** Candle the fill happens on. */
  i: number
  /** market: at that candle's open. limit: at `price` somewhere inside it. */
  kind: 'market' | 'limit'
  /** Limit fills: the price actually paid (already on the ask for a buy). */
  price?: number
  direction: Direction
  stop: number
  /** Final target. */
  target: number
  /** Optional first target where `part1` of the position closes (John's "half off at 0"). */
  target1?: number
  part1?: number
  /** Close time of the candle the signal came from. */
  signalTime: number
}

export type ExitWhy = 'stop' | 'target' | 'target1+stop' | 'time' | 'news' | 'end'

export interface LabTrade extends Candidate {
  signalTime: number
  why: ExitWhy
  /** First target reached before the end. */
  part1Hit: boolean
  /** Weekday rollovers it paid financing for (Wednesday or Friday counts 3). */
  nights: number
  /** Open over a Saturday. */
  weekend: boolean
}

export interface SimSetup {
  market: LabMarket
  tf: LabTf
  style: Style
  news: NewsMode
  /** Blackout windows for this market (newsWindows). */
  windows: Window[]
  /** Spread, slippage and fees all scale by this (1 = normal, 0 = free). */
  costMult?: number
  /** USD per unit of the quote currency at a time and price (1 for USD-quoted markets). */
  usdPerQuote?: (time: number, price: number) => number
  /** Where spreads blow out on news (spikeWindows); the time-of-day cost model also needs no setup. */
  spikes?: Window[]
  /** No time-of-day, reopen or news spread and no swap: the flat costs of the first run. */
  flatCosts?: boolean
  /** Every entry on its own (no "one position at a time"): per-signal results. */
  independent?: boolean
  /**
   * Limit fills check stop and target only from the next candle. For the
   * random-direction test only: inside the fill candle the order of the high
   * and low is unknown, and the usual worst case (stop first) would hit the
   * mirrored trade far more often than the real one, since price came from
   * the side its stop is on.
   */
  limitFromNext?: boolean
}

const REASON: Record<ExitWhy, Candidate['reason']> = {
  stop: 'stop',
  'target1+stop': 'stop',
  target: 'target',
  time: 'end',
  news: 'end',
  end: 'end',
}

/** May this entry open, given the news filter? */
function newsAllows(s: SimSetup, e: LabEntry, bar: OHLCCandle, tfSec: number): boolean {
  if (s.news === 'off' || !s.windows.length) return true
  // A buy at the open only needs the open outside the window when open
  // trades may stay; a limit fill can happen anywhere inside the candle,
  // and in "close" mode a trade that would be closed at once never opens.
  if (s.news === 'block' && e.kind === 'market') return !inWindow(s.windows, bar.time)
  return !overlapsWindow(s.windows, bar.time, bar.time + tfSec)
}

/** Open over a Saturday (UTC). */
function heldWeekend(from: number, to: number): boolean {
  for (let d = dayStart(from); d < to; d += DAY)
    if (utcWeekday(d) === 6 && d + DAY > from) return true
  return false
}

export function simulate(c: OHLCCandle[], entries: LabEntry[], s: SimSetup): LabTrade[] {
  const tfSec = TF_SEC[s.tf]
  const mult = s.costMult ?? 1
  const m = s.market
  const fee = m.fee * mult
  const spikes = s.spikes ?? []
  const flat = !!s.flatCosts || mult === 0
  const out: LabTrade[] = []
  let busy = -1
  const sorted = [...entries].sort((a, b) => a.i - b.i)
  const afterGap = (j: number) => j > 0 && c[j].time - c[j - 1].time > tfSec
  /** Spread and slippage for a fill at the open of candle j (span 0) or inside it (span tfSec). */
  const costs = (j: number, at: number, price: number, span: number) => {
    const k = flat
      ? null
      : costMultAt(m, at, span, span === 0 && at !== c[j].time ? false : afterGap(j), spikes)
    return {
      sp: spreadAt(m, price, mult * (k?.spread ?? 1)),
      sl: slippageAt(m, price, mult * (k?.slippage ?? 1)),
    }
  }

  for (const e of sorted) {
    if ((!s.independent && e.i <= busy) || e.i >= c.length) continue
    const bar = c[e.i]
    if (!entryAllowed(s.style, bar.time) || !newsAllows(s, e, bar, tfSec)) continue
    const long = e.direction === 'long'
    const { sp: sp0, sl: sl0 } = costs(e.i, bar.time, bar.open, 0)
    let fill: number
    if (e.kind === 'market') {
      fill = long ? bar.open + sp0 + sl0 : bar.open - sl0
      const stopOk = long ? bar.open > e.stop : bar.open + sp0 < e.stop
      if (!stopOk || (long ? fill >= e.target : fill <= e.target)) continue
    } else {
      fill = e.price ?? NaN
      if (!(long ? fill > e.stop && fill < e.target : fill < e.stop && fill > e.target)) continue
    }

    const deadline = deadlineFor(s.style, bar.time)
    const newsAt = s.news === 'close' ? nextWindowStart(s.windows, bar.time) : Infinity
    const part = e.target1 != null ? (e.part1 ?? 0.5) : 0
    let left = 1
    let got = 0 // sum of share x exit price
    let p1 = false
    let exitIdx = c.length - 1
    let exitTime = c[c.length - 1].time
    let why: ExitWhy = 'end'
    let done = false
    const close = (j: number, px: number, w: ExitWhy) => {
      got += left * px
      left = 0
      exitIdx = j
      exitTime = c[j].time
      why = w
      done = true
    }

    for (let j = e.i; j < c.length && !done; j++) {
      const b = c[j]
      // At the open (market exits) and inside the candle (stop and target checks).
      const o = costs(j, b.time, b.open, 0)
      const { sp } = costs(j, b.time, b.open, tfSec)
      const atOpen = (bid: number) => (long ? bid - o.sl : bid + o.sp + o.sl)
      if (j > e.i) {
        if (b.time >= deadline) {
          close(j, atOpen(b.open), 'time')
          break
        }
        if (b.time + tfSec > newsAt) {
          close(j, atOpen(b.open), 'news')
          break
        }
      }
      if (j === e.i && e.kind === 'limit' && s.limitFromNext) {
        if (b.time + tfSec >= deadline) {
          const k = costs(j, b.time + tfSec, b.close, 0)
          close(j, long ? b.close - k.sl : b.close + k.sp + k.sl, 'time')
        }
        continue
      }
      const stopHit = long ? b.low <= e.stop : b.high + sp >= e.stop
      if (stopHit) {
        const gapped = j > e.i && (long ? b.open < e.stop : b.open + o.sp > e.stop)
        const sl = gapped ? o.sl : costs(j, b.time, b.open, tfSec).sl
        close(
          j,
          gapped ? atOpen(b.open) : long ? e.stop - sl : e.stop + sl,
          p1 ? 'target1+stop' : 'stop',
        )
        break
      }
      // A limit fill can't be assumed to also reach a target inside its own candle.
      if (j > e.i || e.kind === 'market') {
        const reach = (lvl: number) => (long ? b.high >= lvl : b.low + sp <= lvl)
        const fillAt = (lvl: number) => {
          const gap = j > e.i && (long ? b.open > lvl : b.open + o.sp < lvl)
          return gap ? (long ? b.open : b.open + o.sp) : lvl
        }
        if (e.target1 != null && !p1 && reach(e.target1)) {
          got += part * fillAt(e.target1)
          left -= part
          p1 = true
        }
        if (reach(e.target)) {
          close(j, fillAt(e.target), 'target')
          break
        }
      }
      if (b.time + tfSec >= deadline) {
        const k = costs(j, b.time + tfSec, b.close, 0)
        close(j, long ? b.close - k.sl : b.close + k.sp + k.sl, 'time')
      }
    }
    if (!done) {
      const last = c[c.length - 1]
      const sp = spreadAt(m, last.close, mult)
      const sl = slippageAt(m, last.close, mult)
      close(c.length - 1, long ? last.close - sl : last.close + sp + sl, 'end')
    }

    const sw = flat ? { cost: 0, nights: 0 } : swapCost(m, long, bar.time, exitTime, fill)
    const exit = got + (long ? -sw.cost : sw.cost) * mult
    const dir = long ? 1 : -1
    const risk = Math.abs(fill - e.stop)
    out.push({
      market: m.id,
      direction: e.direction,
      entryTime: bar.time,
      exitTime,
      entry: fill,
      exit,
      stop: e.stop,
      takeProfit: e.target,
      r: (dir * (exit - fill) - fee * (fill + exit)) / risk,
      reason: REASON[why],
      usdPerQuote: s.usdPerQuote ? s.usdPerQuote(bar.time, fill) : 1,
      ...(s.usdPerQuote ? { usdPerQuoteExit: s.usdPerQuote(exitTime, exit) } : {}),
      feeRate: fee,
      leverage: m.leverage,
      candleSec: tfSec,
      signalTime: e.signalTime,
      why,
      part1Hit: p1,
      nights: sw.nights,
      weekend: heldWeekend(bar.time, exitTime),
    })
    busy = exitIdx
  }
  return out
}
