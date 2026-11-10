import type { BacktestResult, BacktestTrade } from '../rules/engine'
import { maxDrawdown } from '../paper/stats'

// "Last 90 days" race: pure scoring. Each strategy gets the same starting
// money, split evenly over every market it can trade. Each market share is its
// own little play account (the backtest), and the strategy's end money is the
// sum of its shares. A market whose data failed keeps its share as cash.

export const RACE_DAYS = 90

export interface MarketRun {
  id: string
  result: BacktestResult
}

export interface TradeMoney extends BacktestTrade {
  market: string
  /** Dollars won or lost on this trade, fees included. */
  pnl: number
}

export interface MarketMoney {
  id: string
  share: number
  end: number
  profit: number
  trades: TradeMoney[]
}

export interface RaceEntry {
  ruleId: string
  start: number
  end: number
  profit: number
  perMonth: number
  trades: number
  winRate: number | null
  /** Fraction, 0.12 = 12%. */
  maxDrawdown: number
  best: string | null
  markets: MarketMoney[]
  skipped: string[]
}

export const shareOf = (start: number, markets: number) => (markets > 0 ? start / markets : 0)

/** Dollar P&L per trade, replaying the backtest's compounding from `share`. */
export function tradeMoney(
  id: string,
  result: BacktestResult,
  share: number,
  riskPct: number,
): TradeMoney[] {
  let eq = share
  return result.trades.map((t) => {
    // backtest: equity *= 1 + r × risk fraction
    const pnl = eq * t.r * (riskPct / 100)
    eq += pnl
    return { ...t, market: id, pnl }
  })
}

export function scoreStrategy(args: {
  ruleId: string
  riskPct: number
  start: number
  runs: MarketRun[]
  skipped: string[]
  days?: number
}): RaceEntry {
  const { ruleId, riskPct, start, runs, skipped } = args
  const days = args.days ?? RACE_DAYS
  const share = shareOf(start, runs.length + skipped.length)
  const markets = runs.map(({ id, result }) => {
    const trades = tradeMoney(id, result, share, riskPct)
    const profit = trades.reduce((a, t) => a + t.pnl, 0)
    return { id, share, end: share + profit, profit, trades }
  })
  const all = markets.flatMap((m) => m.trades).sort((a, b) => a.exitTime - b.exitTime)
  let eq = start
  const curve = [start, ...all.map((t) => (eq += t.pnl))]
  const end = start + markets.reduce((a, m) => a + m.profit, 0)
  const wins = all.filter((t) => t.pnl > 0).length
  const traded = markets.filter((m) => m.trades.length)
  const best = traded.length ? traded.reduce((a, b) => (b.profit > a.profit ? b : a)).id : null
  return {
    ruleId,
    start,
    end,
    profit: end - start,
    perMonth: ((end - start) / Math.max(1, days)) * 30,
    trades: all.length,
    winRate: all.length ? wins / all.length : null,
    maxDrawdown: maxDrawdown(curve),
    best,
    markets,
    skipped,
  }
}

/** Most end money first; ties go to fewer trades (less churn for the same result). */
export function rankEntries(entries: RaceEntry[]): RaceEntry[] {
  return [...entries].sort((a, b) => b.end - a.end || a.trades - b.trades)
}
