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
import { slippageAt, spreadAt, TF_SEC, type LabMarket, type LabTf } from './markets'
import { inWindow, nextWindowStart, overlapsWindow, type NewsMode, type Window } from './news'
import { deadlineFor, entryAllowed, type Style } from './time'

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

export function simulate(c: OHLCCandle[], entries: LabEntry[], s: SimSetup): LabTrade[] {
  const tfSec = TF_SEC[s.tf]
  const mult = s.costMult ?? 1
  const m = s.market
  const fee = m.fee * mult
  const out: LabTrade[] = []
  let busy = -1
  const sorted = [...entries].sort((a, b) => a.i - b.i)

  for (const e of sorted) {
    if (e.i <= busy || e.i >= c.length) continue
    const bar = c[e.i]
    if (!entryAllowed(s.style, bar.time) || !newsAllows(s, e, bar, tfSec)) continue
    const long = e.direction === 'long'
    const sp0 = spreadAt(m, bar.open, mult)
    const sl0 = slippageAt(m, bar.open, mult)
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
      const sp = spreadAt(m, b.open, mult)
      const sl = slippageAt(m, b.open, mult)
      const atMarket = (bid: number) => (long ? bid - sl : bid + sp + sl)
      if (j > e.i) {
        if (b.time >= deadline) {
          close(j, atMarket(b.open), 'time')
          break
        }
        if (b.time + tfSec > newsAt) {
          close(j, atMarket(b.open), 'news')
          break
        }
      }
      const stopHit = long ? b.low <= e.stop : b.high + sp >= e.stop
      if (stopHit) {
        const gapped = j > e.i && (long ? b.open < e.stop : b.open + sp > e.stop)
        close(
          j,
          gapped ? atMarket(b.open) : long ? e.stop - sl : e.stop + sl,
          p1 ? 'target1+stop' : 'stop',
        )
        break
      }
      // A limit fill can't be assumed to also reach a target inside its own candle.
      if (j > e.i || e.kind === 'market') {
        const reach = (lvl: number) => (long ? b.high >= lvl : b.low + sp <= lvl)
        const fillAt = (lvl: number) => {
          const gap = j > e.i && (long ? b.open > lvl : b.open + sp < lvl)
          return gap ? (long ? b.open : b.open + sp) : lvl
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
      if (b.time + tfSec >= deadline) close(j, atMarket(b.close), 'time')
    }
    if (!done) {
      const last = c[c.length - 1]
      const sp = spreadAt(m, last.close, mult)
      const sl = slippageAt(m, last.close, mult)
      close(c.length - 1, long ? last.close - sl : last.close + sp + sl, 'end')
    }

    const exit = got
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
      feeRate: fee,
      leverage: m.leverage,
      candleSec: tfSec,
      signalTime: e.signalTime,
      why,
      part1Hit: p1,
    })
    busy = exitIdx
  }
  return out
}
