import type { BacktestTrade } from '../rules/engine'
import { maxDrawdown } from '../paper/stats'
import type { RuleTimeframe } from '../rules/schema'
import { RACE_SIZING, sizeRaceTrade, type RaceSizing } from './account'

// "Past results" race: pure scoring. Each strategy trades ONE account with
// the same starting money. Every market's backtest gives the trades the rule
// would take there; they are merged in time order into that one account,
// sized like the live race (2% of the balance per trade, at most 5 open,
// 10% open risk, margin limits; see ./account.ts).

/**
 * How far back each rule's backtest trades, by its candle size. Kraken keeps
 * 720 candles per size: 30 days of 1h, 120 days of 4h, about 2 years of 1d
 * (daily rules trade the last year so the other year warms up the indicators).
 * Every market of a strategy, forex included, trades the same window.
 */
export const WINDOW_DAYS: Record<RuleTimeframe, number> = { '1h': 30, '4h': 120, '1d': 365 }

/** First second a rule's backtest may open a trade in. */
export const windowStart = (tf: RuleTimeframe, nowSec: number) => nowSec - WINDOW_DAYS[tf] * 86_400

/** A trade one market's backtest took, before the shared account decides on it. */
export interface Candidate extends BacktestTrade {
  market: string
  /** USD per unit of the quote currency at entry (only changes the units shown, not the dollars). */
  usdPerQuote: number
  /** USD per unit of the quote currency at the exit, when known (USD/JPY, EUR/GBP in the lab): the P&L converts at it. */
  usdPerQuoteExit?: number
  feeRate: number
  leverage: number
  /** Length of the candles it trades on, in seconds. Its exit only counts at the end of the exit candle (no look-ahead across candle sizes). */
  candleSec?: number
}

export interface TradeMoney extends Candidate {
  units: number
  margin: number
  /** Dollars at the stop, from entry, before fees. */
  riskUsd: number
  entryFee: number
  /** The balance its 2% came from. */
  balanceAtEntry: number
  /** Dollars won or lost, both fees included. */
  pnl: number
}

export interface Passed {
  market: string
  entryTime: number
  reason: string
}

export interface Portfolio {
  end: number
  /** In the order they closed. */
  trades: TradeMoney[]
  /** Trades the limits kept out. */
  passed: Passed[]
  /** Balance after each close, starting with the start money. */
  curve: number[]
}

/**
 * Walk every candidate by entry time. Before each entry, trades that exited
 * earlier close (both fees paid, net P&L to the balance); then the new one
 * opens if the limits allow. A trade the limits skip does not free its market
 * for that market's next signal (the market backtest already stepped past it).
 */
export function portfolioBacktest(
  start: number,
  candidates: Candidate[],
  sizing: RaceSizing = RACE_SIZING,
): Portfolio {
  // Stable sort: same-time entries keep the order they came in (market order).
  const queue = [...candidates].sort((a, b) => a.entryTime - b.entryTime)
  let balance = start
  const curve = [start]
  let open: Omit<TradeMoney, 'pnl'>[] = []
  const trades: TradeMoney[] = []
  const passed: Passed[] = []

  const closeBefore = (time: number) => {
    const closeAt = (o: { exitTime: number; candleSec?: number }) => o.exitTime + (o.candleSec ?? 0)
    const due = open
      .filter((o) => closeAt(o) <= time && o.exitTime < time)
      .sort((a, b) => closeAt(a) - closeAt(b))
    open = open.filter((o) => !due.includes(o))
    for (const o of due) {
      const qx = o.usdPerQuoteExit ?? o.usdPerQuote
      const gross = o.units * (o.direction === 'long' ? 1 : -1) * (o.exit - o.entry) * qx
      const exitFee = o.units * o.exit * qx * o.feeRate
      const pnl = gross - o.entryFee - exitFee
      balance += pnl
      curve.push(balance)
      trades.push({ ...o, pnl })
    }
  }

  for (const c of queue) {
    closeBefore(c.entryTime)
    const size = sizeRaceTrade({
      balance,
      open,
      entry: c.entry,
      stop: c.stop,
      usdPerQuote: c.usdPerQuote,
      leverage: c.leverage,
      sizing,
    })
    if (!size.ok) {
      passed.push({ market: c.market, entryTime: c.entryTime, reason: size.reason })
      continue
    }
    open.push({
      ...c,
      units: size.units,
      margin: size.margin,
      riskUsd: size.riskUsd,
      entryFee: size.valueUsd * c.feeRate,
      balanceAtEntry: balance,
    })
  }
  closeBefore(Infinity)
  return { end: balance, trades, passed, curve }
}

export interface MarketMoney {
  id: string
  profit: number
  trades: TradeMoney[]
}

export interface RaceEntry {
  ruleId: string
  /** Days the backtest could trade in. */
  days: number
  start: number
  end: number
  profit: number
  perMonth: number
  trades: number
  /** Trades the limits kept out. */
  passed: number
  winRate: number | null
  /** Fraction, 0.12 = 12%. */
  maxDrawdown: number
  best: string | null
  markets: MarketMoney[]
  skipped: string[]
}

export function scoreStrategy(args: {
  ruleId: string
  start: number
  /** Markets whose data loaded (shown even with no trades). */
  markets: string[]
  candidates: Candidate[]
  skipped: string[]
  days: number
  sizing?: RaceSizing
}): RaceEntry {
  const { ruleId, start, candidates, skipped, days } = args
  const p = portfolioBacktest(start, candidates, args.sizing)
  const markets = args.markets.map((id) => {
    const trades = p.trades.filter((t) => t.market === id)
    return { id, trades, profit: trades.reduce((a, t) => a + t.pnl, 0) }
  })
  const wins = p.trades.filter((t) => t.pnl > 0).length
  const traded = markets.filter((m) => m.trades.length)
  const best = traded.length ? traded.reduce((a, b) => (b.profit > a.profit ? b : a)).id : null
  return {
    ruleId,
    days,
    start,
    end: p.end,
    profit: p.end - start,
    perMonth: ((p.end - start) / Math.max(1, days)) * 30,
    trades: p.trades.length,
    passed: p.passed.length,
    winRate: p.trades.length ? wins / p.trades.length : null,
    maxDrawdown: maxDrawdown(p.curve),
    best,
    markets,
    skipped,
  }
}

/** Most end money first; ties go to fewer trades (less churn for the same result). */
export function rankEntries(entries: RaceEntry[]): RaceEntry[] {
  return [...entries].sort((a, b) => b.end - a.end || a.trades - b.trades)
}
