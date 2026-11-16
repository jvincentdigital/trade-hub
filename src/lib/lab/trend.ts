// "Ride the move": channel-breakout trend following (docs/trend-study.md).
// Buy a close above the highest high of the N candles before it (sell
// mirrored), stop 2 x ATR from the fill, exit at the open after a close past
// the X-candle channel against the trade. Prices are BID: a buy pays the ask
// and sells at the bid, a short sells at the bid and buys back at the ask.
// Costs: spread by time of day, slippage on every fill, commission per side,
// overnight swap. Pure, tested.

import type { OHLCCandle } from '../types/market'
import { costMultAt, slippageAt, spreadAt, swapCost, type LabMarket } from './markets'

export interface TrendParams {
  /** Breakout channel, in candles. */
  n: number
  /** Exit channel, in candles. */
  x: number
  /** Stop distance in ATRs. */
  stopAtr: number
}

export interface TrendTrade {
  direction: 'long' | 'short'
  /** Open time of the fill candle (unix s). */
  entryTime: number
  /** Open time of the candle it closed in. */
  exitTime: number
  entry: number
  exit: number
  stop: number
  /** Net result in R: move, swap and both commissions over the stop distance. */
  r: number
  why: 'stop' | 'channel' | 'end'
  nights: number
  /** (real - mirrored) / 2: the luck test's value for this trade. */
  d: number
}

const highest = (c: OHLCCandle[], from: number, to: number) => {
  let v = -Infinity
  for (let k = from; k < to; k++) v = Math.max(v, c[k].high)
  return v
}
const lowest = (c: OHLCCandle[], from: number, to: number) => {
  let v = Infinity
  for (let k = from; k < to; k++) v = Math.min(v, c[k].low)
  return v
}

interface Run {
  exitIdx: number
  exit: number
  entry: number
  stop: number
  r: number
  why: TrendTrade['why']
  nights: number
}

/**
 * One trade from the open of candle `i`: stop first (a gap past it fills at
 * the open), then the channel exit decided on a close and filled at the next
 * open. `dist` is the stop distance in price.
 */
function runTrade(
  c: OHLCCandle[],
  i: number,
  long: boolean,
  dist: number,
  x: number,
  m: LabMarket,
  tfSec: number,
  costMult: number,
): Run {
  const gap = (j: number) => j > 0 && c[j].time - c[j - 1].time > tfSec
  const costAt = (j: number) => {
    const k = costMult === 0 ? { spread: 0, slippage: 0 } : costMultAt(m, c[j].time, 0, gap(j), [])
    return {
      sp: spreadAt(m, c[j].open, costMult * k.spread),
      sl: slippageAt(m, c[j].open, costMult * k.slippage),
    }
  }
  const o = costAt(i)
  const entry = long ? c[i].open + o.sp + o.sl : c[i].open - o.sl
  const stop = long ? entry - dist : entry + dist
  // Inside a candle the normal spread applies.
  const sp = spreadAt(m, c[i].open, costMult)
  const sl = slippageAt(m, c[i].open, costMult)
  let exitIdx = c.length - 1
  let exit = NaN
  let why: TrendTrade['why'] = 'end'
  let leave = false
  for (let j = i; j < c.length; j++) {
    const b = c[j]
    const k = costAt(j)
    const atOpen = long ? b.open - k.sl : b.open + k.sp + k.sl
    if (leave) {
      exitIdx = j
      exit = atOpen
      why = 'channel'
      break
    }
    if (long ? b.low <= stop : b.high + sp >= stop) {
      const gapped = j > i && (long ? b.open < stop : b.open + k.sp > stop)
      exitIdx = j
      exit = gapped ? atOpen : long ? stop - sl : stop + sl
      why = 'stop'
      break
    }
    if (j - x >= 0) {
      leave = long ? b.close < lowest(c, j - x, j) : b.close > highest(c, j - x, j)
    }
  }
  if (Number.isNaN(exit)) {
    const last = c[c.length - 1]
    exit = long ? last.close - sl : last.close + sp + sl
  }
  const sw =
    costMult === 0 ? { cost: 0, nights: 0 } : swapCost(m, long, c[i].time, c[exitIdx].time, entry)
  const move = (long ? exit - entry : entry - exit) - sw.cost * costMult
  const fees = m.fee * costMult * (entry + exit)
  return { exitIdx, exit, entry, stop, r: (move - fees) / dist, why, nights: sw.nights }
}

/**
 * Every trade of one market. `atr[i]` belongs to candle `i` (NaN until it has
 * enough candles). `costMult` scales every cost (0 = free, for tests).
 */
export function trendTrades(
  c: OHLCCandle[],
  atr: number[],
  p: TrendParams,
  m: LabMarket,
  tfSec: number,
  costMult = 1,
): TrendTrade[] {
  const out: TrendTrade[] = []
  let busyUntil = -1
  for (let i = p.n; i < c.length - 1; i++) {
    // The fill candle is i + 1; a trade that closed in candle j frees the market from j on.
    if (i + 1 <= busyUntil || !(atr[i] > 0)) continue
    const up = c[i].close > highest(c, i - p.n, i)
    const down = c[i].close < lowest(c, i - p.n, i)
    if (!up && !down) continue
    const dist = p.stopAtr * atr[i]
    const real = runTrade(c, i + 1, up, dist, p.x, m, tfSec, costMult)
    const mirror = runTrade(c, i + 1, !up, dist, p.x, m, tfSec, costMult)
    out.push({
      direction: up ? 'long' : 'short',
      entryTime: c[i + 1].time,
      exitTime: c[real.exitIdx].time,
      entry: real.entry,
      exit: real.exit,
      stop: real.stop,
      r: real.r,
      why: real.why,
      nights: real.nights,
      d: (real.r - mirror.r) / 2,
    })
    busyUntil = real.exitIdx
  }
  return out
}
