import type { OHLCCandle } from '@/lib/types/market'
import { liveStats, type LiveStats } from '@/lib/race/compare'
import type { FundedTestId } from '@/lib/race/funded'
import {
  tradeRisk,
  type ClosedFundedTrade,
  type ClosedLiveTrade,
  type FundedTrade,
} from '@/lib/race/live'
import type { TradeChecks } from '@/lib/race/checklist'
import type { Side } from './positions'

// Today's "Trade history" (John, 2026-11-16: "I was not able to see the
// trades, I just saw how much money you were losing"): every closed trade of
// the funded account Today follows, and a scorecard that sets the live
// numbers next to what the strategy's test year showed. Pure, tested.

/** One whole closed trade: a half closed at the first target and the rest are one trade. */
export interface HistoryTrade {
  key: string
  market: string
  side: Side
  /** Id of the strategy whose signal opened it. */
  strategy: string
  /** Unix seconds. */
  entryTime: number
  /** When the last part closed. */
  exitTime: number
  entry: number
  stop: number
  /** The final target. */
  target: number
  /** Where the last part closed. */
  exit: number
  /** How the last part closed. */
  reason: ClosedLiveTrade['reason']
  /** A part closed at the first target before the rest closed. */
  tookPart: boolean
  units: number
  usdPerQuote: number
  /** Net dollars, both fees of every part included. */
  pnl: number
  fees: number
  /** Dollars it risked at its stop, from entry, before fees. */
  risk: number
  /** pnl / risk; null when it had no risk to measure. */
  r: number | null
  /** Dollars lost to stop fills worse than the stop price (0 when it filled at the stop or better). */
  slip: number
  checks?: TradeChecks
}

const keyOf = (t: Pick<FundedTrade, 'market' | 'entryTime' | 'signalTime'>) =>
  `${t.market}|${t.entryTime}|${t.signalTime}`

/**
 * Closed parts grouped into whole trades, newest first. Like `tradeResults`
 * in race/compare.ts, a trade with a part still open is left out until the
 * rest closes (it still shows under Open trades).
 */
export function historyTrades(
  closed: ClosedFundedTrade[],
  open: FundedTrade[] = [],
): HistoryTrade[] {
  const stillOpen = new Set(open.map(keyOf))
  const byKey = new Map<string, HistoryTrade>()
  for (const t of [...closed].sort((a, b) => a.exitTime - b.exitTime)) {
    const key = keyOf(t)
    if (stillOpen.has(key)) continue
    const prev = byKey.get(key)
    const past = t.direction === 'long' ? t.stop - t.exit : t.exit - t.stop
    const slip = t.reason === 'stop' && past > 0 ? past * t.units * t.usdPerQuote : 0
    byKey.set(key, {
      key,
      market: t.market,
      side: t.direction,
      strategy: t.strategy,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      entry: t.entry,
      stop: t.stop,
      target: t.takeProfit,
      exit: t.exit,
      reason: t.reason,
      tookPart: !!prev,
      units: (prev?.units ?? 0) + t.units,
      usdPerQuote: t.usdPerQuote,
      pnl: (prev?.pnl ?? 0) + t.pnl,
      fees: (prev?.fees ?? 0) + t.fees,
      risk: (prev?.risk ?? 0) + tradeRisk(t),
      r: null,
      slip: (prev?.slip ?? 0) + slip,
      checks: t.checks,
    })
  }
  return [...byKey.values()]
    .map((t) => ({ ...t, r: t.risk > 0 ? t.pnl / t.risk : null }))
    .sort((a, b) => b.exitTime - a.exitTime || b.entryTime - a.entryTime)
}

export interface Scorecard extends LiveStats {
  /** Average R of the losing trades (negative); null with none. A plain stop-out is -1R before costs. */
  avgLossR: number | null
  fees: number
}

export function scorecard(
  closed: ClosedFundedTrade[],
  startMoney: number,
  open: FundedTrade[] = [],
): Scorecard {
  const trades = historyTrades(closed, open)
  const lossRs = trades.flatMap((t) => (t.r != null && t.pnl <= 0 ? [t.r] : []))
  return {
    ...liveStats(closed, startMoney, open),
    avgLossR: lossRs.length ? lossRs.reduce((a, r) => a + r, 0) / lossRs.length : null,
    fees: trades.reduce((a, t) => a + t.fees, 0),
  }
}

/** Closed trades before the live numbers say anything about a strategy. */
export const FIRST_READ = 30

/** What a strategy's past test showed, to hold the live numbers against. */
export interface Yardstick {
  winRate: number
  avgR: number
  maxDrawdown: number
  tradesPerWeek: number
  source: string
}

/**
 * John's London v1 on the six older years it was examined on (2019-01-01 to
 * 2024-11-10, run once on 2026-11-17, docs/v1-older-years-exam.md on branch
 * lab/v1-older-years): 656 trades, 42% won, -0.03R a trade, worst drop 44.5%.
 * The rule lost there, so that is what the live numbers are held against.
 * Its one good year (November 2024 to November 2025) showed 58% won and
 * +0.28R with the 16:30 London close, 51% and +0.27R with the hold rule the
 * live account uses; the exam says that year was most likely luck. Trades a
 * week: 656 over the about 282 weeks the exam traded (thin days of 2023 sat
 * out). The breakout trades in the second test have no past test, so that
 * test has no yardstick.
 */
export const YARDSTICKS: Record<FundedTestId, Yardstick | null> = {
  v1: {
    winRate: 0.42,
    avgR: -0.03,
    maxDrawdown: 0.445,
    tradesPerWeek: 656 / 282,
    source:
      'the six older years it was examined on (2019 to 2024, 656 trades). The rule lost there; its one good year (November 2024 to November 2025) was most likely luck',
  },
  breakouts: null,
}

/**
 * The candles around a closed trade: from a day before the entry to half a
 * day after the exit. Empty when the loaded candles no longer reach back to it.
 */
export function candlesAround(candles: OHLCCandle[], t: HistoryTrade): OHLCCandle[] {
  return candles.filter((c) => c.time >= t.entryTime - 86_400 && c.time <= t.exitTime + 43_200)
}
