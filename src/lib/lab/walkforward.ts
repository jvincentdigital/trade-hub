// Strategy lab: walk-forward scoring. Each bot's few free parameters are
// chosen on the first 70% of its history (in-sample) and then scored ONLY on
// the last 30% (out-of-sample), each part in its own fresh $10,000 account
// with the race's sizing. Pure, tested.

import { maxDrawdown } from '../paper/stats'
import { RACE_SIZING, type RaceSizing } from '../race/account'
import {
  portfolioBacktest,
  type Candidate,
  type Portfolio,
  type TradeMoney,
} from '../race/leaderboard'
import { DAY, monthKey, sessionOf } from './time'

export const START_MONEY = 10_000
export const IS_SHARE = 0.7
export const MIN_OOS_TRADES = 30
/** A parameter set needs this many in-sample trades to be chosen (else the most-traded one wins). */
export const MIN_IS_TRADES = 20
const MONTH = 30.4375 * DAY

export interface Span {
  from: number
  split: number
  to: number
}

/** First 70% of [from, to] in-sample, the rest out-of-sample. */
export const splitSpan = (from: number, to: number, share = IS_SHARE): Span => ({
  from,
  split: Math.round(from + share * (to - from)),
  to,
})

/** Trades by entry time: [from, split) in-sample, [split, to] out-of-sample; anything outside the span is dropped. */
export function splitTrades<T extends { entryTime: number }>(trades: T[], s: Span) {
  const is: T[] = []
  const oos: T[] = []
  for (const t of trades) {
    if (t.entryTime < s.from || t.entryTime > s.to) continue
    ;(t.entryTime < s.split ? is : oos).push(t)
  }
  return { is, oos }
}

export interface Metrics {
  trades: number
  wins: number
  winRate: number | null
  /** Gross $ won / gross $ lost (null with no losers). */
  profitFactor: number | null
  net: number
  end: number
  /** Largest drop of the closed-trade balance, percent. */
  maxDrawdownPct: number
  months: number
  perMonth: number
  tradesPerMonth: number
  /** Average result in R (dollars / dollars at the stop), after costs. */
  avgR: number | null
  /** Worst calendar month in dollars (months with no trades count as 0). */
  worstMonth: number
  worstMonthKey: string | null
  /** Average gain of a winning trade, as % of the balance it was sized from. */
  pctPerWinner: number | null
  /** Mean R / (standard deviation / sqrt(trades)): how far from luck, roughly (2+ is notable for ONE bot). */
  tStat: number | null
  /** Trades the account limits left out. */
  passed: number
}

export function monthly(trades: TradeMoney[], from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (let t = from; monthKey(t) <= monthKey(to); t += 28 * DAY) out[monthKey(t)] = 0
  for (const tr of trades) {
    const k = monthKey(tr.exitTime)
    out[k] = (out[k] ?? 0) + tr.pnl
  }
  return out
}

export function metricsOf(p: Portfolio, from: number, to: number, start = START_MONEY): Metrics {
  const t = p.trades
  const wins = t.filter((x) => x.pnl > 0)
  const gw = wins.reduce((a, x) => a + x.pnl, 0)
  const gl = -t.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0)
  const rs = t.map((x) => (x.riskUsd > 0 ? x.pnl / x.riskUsd : 0))
  const mean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null
  const sd =
    rs.length > 1 && mean != null
      ? Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (rs.length - 1))
      : null
  const months = Math.max((to - from) / MONTH, 1e-9)
  const net = p.end - start
  const mo = Object.entries(monthly(t, from, to))
  const worst = mo.length ? mo.reduce((a, b) => (b[1] < a[1] ? b : a)) : null
  return {
    trades: t.length,
    wins: wins.length,
    winRate: t.length ? wins.length / t.length : null,
    profitFactor: gl > 0 ? gw / gl : null,
    net,
    end: p.end,
    maxDrawdownPct: maxDrawdown(p.curve) * 100,
    months,
    perMonth: net / months,
    tradesPerMonth: t.length / months,
    avgR: mean,
    worstMonth: worst ? worst[1] : 0,
    worstMonthKey: worst ? worst[0] : null,
    pctPerWinner: wins.length
      ? (wins.reduce((a, x) => a + x.pnl / x.balanceAtEntry, 0) / wins.length) * 100
      : null,
    tStat: mean != null && sd && sd > 0 ? mean / (sd / Math.sqrt(rs.length)) : null,
    passed: p.passed.length,
  }
}

export interface GridRow<P> {
  params: P
  isNet: number
  isTrades: number
}

/**
 * The parameter set with the most in-sample money among those with at least
 * MIN_IS_TRADES trades; when none has that many, the one with the most
 * trades. Ties keep the earlier set. Never looks at out-of-sample results.
 */
export function chooseParams<P>(grid: GridRow<P>[], minTrades = MIN_IS_TRADES): number {
  let best = -1
  const ok = grid.some((g) => g.isTrades >= minTrades)
  for (let i = 0; i < grid.length; i++) {
    const g = grid[i]
    if (ok) {
      if (g.isTrades < minTrades) continue
      if (best < 0 || g.isNet > grid[best].isNet) best = i
    } else if (best < 0 || g.isTrades > grid[best].isTrades) best = i
  }
  return best
}

export interface WalkResult<P> {
  span: Span
  grid: GridRow<P>[]
  chosen: number
  params: P
  is: Metrics
  oos: Metrics
  oosTrades: TradeMoney[]
  isTrades: TradeMoney[]
}

/** Run the walk-forward for one bot: `trades(p)` gives every trade for parameter set p over the whole span. */
export function walkForward<P>(
  span: Span,
  params: P[],
  trades: (p: P) => Candidate[],
  sizing: RaceSizing = RACE_SIZING,
): WalkResult<P> {
  const parts = params.map((p) => splitTrades(trades(p), span))
  const isRuns = parts.map((x) => portfolioBacktest(START_MONEY, x.is, sizing))
  const grid = params.map((p, i) => ({
    params: p,
    isNet: isRuns[i].end - START_MONEY,
    isTrades: isRuns[i].trades.length,
  }))
  const chosen = Math.max(0, chooseParams(grid))
  const oosRun = portfolioBacktest(START_MONEY, parts[chosen]?.oos ?? [], sizing)
  return {
    span,
    grid,
    chosen,
    params: params[chosen],
    is: metricsOf(
      isRuns[chosen] ?? { end: START_MONEY, trades: [], passed: [], curve: [START_MONEY] },
      span.from,
      span.split,
    ),
    oos: metricsOf(oosRun, span.split, span.to),
    oosTrades: oosRun.trades,
    isTrades: isRuns[chosen]?.trades ?? [],
  }
}

/** Out-of-sample money per market and per session (by entry time, UTC session clock). */
export function breakdown(trades: TradeMoney[]) {
  const byMarket: Record<string, { trades: number; net: number; wins: number }> = {}
  const bySession: Record<string, { trades: number; net: number; wins: number }> = {}
  for (const t of trades) {
    for (const [map, key] of [
      [byMarket, t.market],
      [bySession, sessionOf(t.entryTime).name],
    ] as const) {
      const row = (map[key] ??= { trades: 0, net: 0, wins: 0 })
      row.trades++
      row.net += t.pnl
      if (t.pnl > 0) row.wins++
    }
  }
  return { byMarket, bySession }
}
