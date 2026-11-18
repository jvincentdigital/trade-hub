// Levels study (docs/levels-study.md, "Three plain trades"): T0 (an order at
// the level), T1 (after price closes back out) and B0 (with the break), each
// with the quick and the hold exit; the fills on 1-minute candles, the costs
// and the end of the data. Pure. Described in the plan for a visit from below
// (a sell at a ceiling for T0 and T1, a buy for B0); a visit from above
// mirrors it.

import { TOL } from './levelsClock'
import { before, type LevelsCtx, type Touch } from './levelsWatch'

export const TRADE_NAMES = ['T0', 'T1', 'B0'] as const
export type TradeName = (typeof TRADE_NAMES)[number]

/** The two exits: target in ATR from the entry and the time exit in hours after the fill minute. */
export const EXITS = [
  { name: 'quick', target: 0.25, hours: 24 },
  { name: 'hold', target: 1, hours: 120 },
] as const

/** A trade is skipped when R is under this many times its round-trip cost. */
export const MIN_R_COSTS = 5

export type TradeStatus =
  | 'trade'
  /** R under 5 x the round-trip cost. */
  | 'skip_r'
  /** T0, B0: the order never filled. */
  | 'no_fill'
  /** T1: none of the eight 15-minute candles closed back out. */
  | 'no_trigger'
  /** T1: the Bid reached the far edge + 0.25 x ATR before the trigger closed. */
  | 'broke'
  /** T1: the entry minute opened 0.25 x ATR or more back from the near edge. */
  | 'skip_open'

export type ExitHow = 'stop' | 'target' | 'time' | 'end'

export interface ExitResult {
  how: ExitHow
  /** Exit minute. */
  at: number
  price: number
  /** Result in price after costs, and the costs it paid (round trip + 0.2 pip per market fill). */
  pnl: number
  cost: number
  /** In R: after costs, before costs, at double cost. */
  after: number
  before: number
  double: number
  /** The minute that settled it, or -1 (closed by the end of the data). */
  done: number
}

export interface TradeResult {
  name: TradeName
  status: TradeStatus
  /** 1 a buy, -1 a sell. */
  dir: 1 | -1
  /** Fill minute, or -1. */
  fill: number
  entry: number
  stop: number
  R: number
  spread: number
  /** quick, hold (filled trades only, else empty). */
  exits: ExitResult[]
  /** The minute that settled the status (and the exits), or -1 if the end of the data came first. */
  done: number
}

/**
 * Walk a filled position: the time exit at the open of the first minute
 * stamped at or after its time, before any other test there; in the fill
 * minute only the stop; from the next minute the stop and the target, the
 * stop winning a minute that holds both; still open after the last minute's
 * tests: the last close, as a market fill.
 */
export function walkExit(
  ctx: LevelsCtx,
  dir: 1 | -1,
  fill: number,
  stop: number,
  target: number,
  spread: number,
  timeIdx: number,
): { how: ExitHow; at: number; price: number } {
  const { ix, n } = ctx
  const { open, close } = ctx.bars
  const lim = timeIdx >= 0 ? timeIdx : n
  if (dir === 1) {
    const st = ix.firstLow(fill, lim, stop + TOL)
    const tg = ix.firstHigh(fill + 1, st >= 0 ? st : lim, target - TOL)
    if (tg >= 0) return { how: 'target', at: tg, price: target }
    if (st >= 0) return { how: 'stop', at: st, price: open[st] < stop - TOL ? open[st] : stop }
    if (timeIdx >= 0) return { how: 'time', at: timeIdx, price: open[timeIdx] }
    return { how: 'end', at: n - 1, price: close[n - 1] }
  }
  const st = ix.firstHigh(fill, lim, stop - spread - TOL)
  const tg = ix.firstLow(fill + 1, st >= 0 ? st : lim, target - spread + TOL)
  if (tg >= 0) return { how: 'target', at: tg, price: target }
  if (st >= 0) {
    const o = open[st] + spread
    return { how: 'stop', at: st, price: o > stop + TOL ? o : stop }
  }
  if (timeIdx >= 0) return { how: 'time', at: timeIdx, price: open[timeIdx] + spread }
  return { how: 'end', at: n - 1, price: close[n - 1] + spread }
}

function exits(
  ctx: LevelsCtx,
  dir: 1 | -1,
  fill: number,
  entry: number,
  stop: number,
  R: number,
  spread: number,
  atr: number,
  entryMarket: number,
): ExitResult[] {
  const { comm, slip } = ctx.costs
  const t = ctx.bars.time[fill]
  return EXITS.map((x) => {
    const ti = before(ctx.bars, t + x.hours * 3600, fill + 1)
    const target = entry + dir * x.target * atr
    const w = walkExit(ctx, dir, fill, stop, target, spread, ti < ctx.n ? ti : -1)
    const slips = entryMarket + (w.how === 'target' ? 0 : 1)
    const pnl = dir * (w.price - entry) - comm - slips * slip
    const cost = spread + comm + slips * slip
    return {
      ...w,
      pnl,
      cost,
      after: pnl / R,
      before: (pnl + cost) / R,
      double: (pnl - cost) / R,
      done: w.how === 'end' ? -1 : w.at,
    }
  })
}

function result(
  name: TradeName,
  status: TradeStatus,
  dir: 1 | -1,
  done: number,
  fill = -1,
  entry = NaN,
  stop = NaN,
  R = NaN,
  spread = NaN,
  ex: ExitResult[] = [],
): TradeResult {
  let d = done
  for (const x of ex) d = d < 0 || x.done < 0 ? -1 : Math.max(d, x.done)
  return { name, status, dir, fill, entry, stop, R, spread, exits: ex, done: d }
}

const tooSmall = (ctx: LevelsCtx, R: number, spread: number) =>
  R < MIN_R_COSTS * (spread + ctx.costs.comm) - TOL

/** T0: an order at the near edge, working from the touch minute through the visit's end minute. */
export function tradeT0(ctx: LevelsCtx, v: Touch): TradeResult {
  const { touch: tm, dir, near, far, atr } = v
  const td: 1 | -1 = dir === 1 ? -1 : 1
  const spread = ctx.costs.spreadAt(near)
  const stop = far + dir * 0.25 * atr
  const R = dir * (stop - near)
  if (tooSmall(ctx, R, spread)) return result('T0', 'skip_r', td, tm)
  const to = v.end >= 0 ? v.end + 1 : ctx.n
  const pen = ctx.costs.pen
  const fill =
    dir === 1
      ? ctx.ix.firstHigh(tm, to, near + pen - TOL)
      : ctx.ix.firstLow(tm, to, near - pen - spread + TOL)
  if (fill < 0) return result('T0', 'no_fill', td, v.end)
  const ex = exits(ctx, td, fill, near, stop, R, spread, atr, 0)
  return result('T0', 'trade', td, fill, fill, near, stop, R, spread, ex)
}

/**
 * T1: the first of the eight 15-minute candles from the one holding the touch
 * minute that closes 0.05 x ATR or more back from the near edge; no trade if
 * the far edge + 0.25 x ATR was reached from the touch minute through that
 * candle; entry at the next minute's open unless it is already 0.25 x ATR back.
 */
export function tradeT1(ctx: LevelsCtx, v: Touch): TradeResult {
  const { touch: tm, dir, near, far, atr } = v
  const { q, ix } = ctx
  const { open } = ctx.bars
  const td: 1 | -1 = dir === 1 ? -1 : 1
  const c0 = q.ofMinute[tm]
  let trig = -1
  let c = c0
  for (; c < c0 + 8 && c < q.n - 1; c++) {
    const cl = q.close[c]
    if (dir === 1 ? cl <= near - 0.05 * atr + TOL : cl >= near + 0.05 * atr - TOL) {
      trig = c
      break
    }
  }
  if (trig < 0) return result('T1', 'no_trigger', td, c === c0 + 8 ? q.first[c] : -1)
  const lastEnd = q.end[trig]
  const e = q.first[trig + 1]
  const ext = dir === 1 ? ix.maxHigh(tm, lastEnd) : ix.minLow(tm, lastEnd)
  if (dir === 1 ? ext >= far + 0.25 * atr - TOL : ext <= far - 0.25 * atr + TOL)
    return result('T1', 'broke', td, e)
  const o = open[e]
  if (dir === 1 ? o <= near - 0.25 * atr + TOL : o >= near + 0.25 * atr - TOL)
    return result('T1', 'skip_open', td, e)
  const spread = ctx.costs.spreadAt(o)
  const entry = dir === 1 ? o : o + spread
  const stop = dir === 1 ? Math.max(far, ext) + 0.1 * atr : Math.min(far, ext) - 0.1 * atr
  // R is a distance: an entry that opens beyond its stop (a gap) has R = |entry - stop|.
  const R = Math.abs(stop - entry)
  if (tooSmall(ctx, R, spread)) return result('T1', 'skip_r', td, e)
  const ex = exits(ctx, td, e, entry, stop, R, spread, atr, 1)
  return result('T1', 'trade', td, e, e, entry, stop, R, spread, ex)
}

/**
 * B0: a stop order at P = the far edge + 0.10 x ATR (with the break), working
 * from the touch minute through the visit's end minute and earlier than 24
 * hours after the touch minute; fills at P or at a worse opening price.
 */
export function tradeB0(ctx: LevelsCtx, v: Touch): TradeResult {
  const { touch: tm, dir, far, atr } = v
  const { open, time } = ctx.bars
  const td: 1 | -1 = dir
  const P = far + dir * 0.1 * atr
  const spread = ctx.costs.spreadAt(P)
  const R = 0.25 * atr
  if (tooSmall(ctx, R, spread)) return result('B0', 'skip_r', td, tm)
  const endLim = v.end >= 0 ? v.end + 1 : ctx.n
  const w24 = before(ctx.bars, time[tm] + 24 * 3600, tm + 1)
  const lim = Math.min(endLim, w24)
  const fill =
    dir === 1 ? ctx.ix.firstHigh(tm, lim, P - spread - TOL) : ctx.ix.firstLow(tm, lim, P + TOL)
  if (fill < 0) {
    const done = endLim <= w24 ? v.end : w24 < ctx.n ? w24 : -1
    return result('B0', 'no_fill', td, done)
  }
  const entry = dir === 1 ? Math.max(P, open[fill] + spread) : Math.min(P, open[fill])
  const stop = entry - dir * 0.25 * atr
  const ex = exits(ctx, td, fill, entry, stop, R, spread, atr, 1)
  return result('B0', 'trade', td, fill, fill, entry, stop, R, spread, ex)
}

/** The three trades of a visit, in the order T0, T1, B0. */
export const visitTrades = (ctx: LevelsCtx, v: Touch): TradeResult[] => [
  tradeT0(ctx, v),
  tradeT1(ctx, v),
  tradeB0(ctx, v),
]
