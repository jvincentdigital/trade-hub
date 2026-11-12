import type { PaperAccount } from '../paper/schema'
import { getInstrument, quoteToUsd, type PriceMap } from '../paper/instruments'
import type { RaceState } from '../race/live'
import {
  FUNDED,
  fundedAccountId,
  fundedOf,
  fundedTest,
  sizeLabel,
  type FundedTestId,
} from '../race/funded'
import { tradeId } from '../race/closeRequests'
import type { TradeChecks } from '../race/checklist'

// Open trades from the funded test (the race account Today follows, fed by
// every strategy's signals) and the demo account in one shape, plus the
// numbers the home screen shows per card. Pure, tested.

export type Side = 'long' | 'short'

export interface OpenPosition {
  key: string
  source: 'race' | 'demo'
  /** Strategy name, or "Demo". */
  by: string
  /** Race strategy id (to look up its rule); none for demo trades. */
  ruleId?: string
  market: string
  side: Side
  entry: number
  stop?: number
  target?: number
  units: number
  /** USD per unit of the quote currency (1 for USD quotes and race trades). Null = unknown. */
  usdPerQuote: number | null
  /** Milliseconds. */
  openedAt: number
  /** Why it was opened (Claude's picks). */
  note?: string
  /** Race trades: the id a Close now request names it by. */
  closeId?: string
  /** Funded trades: which size and test it is in ("$50K v1 only"), for the Close now confirm. */
  account?: string
  /** Race trades: the confidence checklist at entry; none on trades from before it. */
  checks?: TradeChecks
}

export type PositionStatus = 'Near target' | 'Near stop' | 'Running' | 'No stop' | 'No price'

export interface PositionMetrics {
  price: number | null
  /** Dollars now, before the exit fee. */
  pnl: number | null
  pnlPct: number | null
  /** Price move from here to the stop, in % of price, and the dollars that move costs. */
  toStopPct: number | null
  toStopUsd: number | null
  toTargetPct: number | null
  toTargetUsd: number | null
  /** Dollars if the stop or target is hit (from entry, before exit fee). */
  atStopUsd: number | null
  atTargetUsd: number | null
  status: PositionStatus
}

/** Share of the way to the stop or target that counts as "near". */
export const NEAR = 0.7

const dir = (s: Side) => (s === 'long' ? 1 : -1)

export function measure(p: OpenPosition, price: number | undefined | null): PositionMetrics {
  const q = p.usdPerQuote
  const usd = (priceMove: number) => (q == null ? null : p.units * priceMove * q)
  const atStopUsd = p.stop != null ? usd(dir(p.side) * (p.stop - p.entry)) : null
  const atTargetUsd = p.target != null ? usd(dir(p.side) * (p.target - p.entry)) : null
  if (!price || !(price > 0)) {
    return {
      price: null,
      pnl: null,
      pnlPct: null,
      toStopPct: null,
      toStopUsd: null,
      toTargetPct: null,
      toTargetUsd: null,
      atStopUsd,
      atTargetUsd,
      status: 'No price',
    }
  }
  const move = dir(p.side) * (price - p.entry)
  const pnl = usd(move)
  const pnlPct = (move / p.entry) * 100
  const toStopPct = p.stop != null ? (Math.abs(p.stop - price) / price) * 100 : null
  const toTargetPct = p.target != null ? (Math.abs(p.target - price) / price) * 100 : null
  const toStopUsd = p.stop != null ? usd(Math.abs(p.stop - price)) : null
  const toTargetUsd = p.target != null ? usd(Math.abs(p.target - price)) : null

  let status: PositionStatus = 'Running'
  if (p.stop == null) status = 'No stop'
  else {
    const risk = Math.abs(p.entry - p.stop)
    const towardStop = risk > 0 ? -move / risk : 0
    const reward = p.target != null ? Math.abs(p.target - p.entry) : 0
    const towardTarget = reward > 0 ? move / reward : 0
    if (towardStop >= NEAR) status = 'Near stop'
    else if (towardTarget >= NEAR) status = 'Near target'
  }
  return {
    price,
    pnl,
    pnlPct,
    toStopPct,
    toStopUsd,
    toTargetPct,
    toTargetUsd,
    atStopUsd,
    atTargetUsd,
    status,
  }
}

/**
 * One funded size's open trades (one per market; the $10K of v1 only unless
 * `size` and `test` say another). `by` is the strategy whose signal opened
 * it, so the row and "Why these levels" read from its rule.
 */
export function fundedPositions(
  state: RaceState | null | undefined,
  size: number = FUNDED.startMoney,
  test: FundedTestId = 'v1',
): OpenPosition[] {
  const f = fundedOf(state, size, test)
  if (!state || !f) return []
  return f.open.map((t) => ({
    key: `funded:${t.market}`,
    source: 'race' as const,
    by: state.strategies[t.strategy]?.name ?? t.strategy,
    ruleId: t.strategy,
    closeId: tradeId(fundedAccountId(size, test), t),
    account: `${sizeLabel(size)} ${fundedTest(test).label}`,
    market: t.market,
    side: t.direction,
    entry: t.entry,
    stop: t.stop,
    target: t.takeProfit,
    units: t.units,
    // Fixed at entry, like openPnl, so the card and the race agree.
    usdPerQuote: t.usdPerQuote,
    openedAt: t.entryTime * 1000,
    ...(t.note ? { note: t.note } : {}),
    ...(t.checks ? { checks: t.checks } : {}),
  }))
}

/**
 * The header line: dollars if every open trade hits its target, and if every
 * one hits its stop (from entry, before fees). Trades with no stop, no target
 * or no USD rate are left out of both sums and counted in `unknown`.
 */
export function ifAllHit(rows: PositionMetrics[]): {
  target: number
  stop: number
  unknown: number
} {
  let target = 0
  let stop = 0
  let unknown = 0
  for (const m of rows) {
    if (m.atTargetUsd == null || m.atStopUsd == null) {
      unknown++
      continue
    }
    target += m.atTargetUsd
    stop += m.atStopUsd
  }
  return { target, stop, unknown }
}

export function demoPositions(account: PaperAccount, prices: PriceMap): OpenPosition[] {
  return account.positions.map((pos) => {
    const inst = getInstrument(pos.instrumentId)
    return {
      key: `demo:${pos.id}`,
      source: 'demo' as const,
      by: 'Demo',
      market: pos.instrumentId,
      side: pos.side,
      entry: pos.entryPrice,
      stop: pos.stopLoss,
      target: pos.takeProfit,
      units: pos.units,
      usdPerQuote: inst ? quoteToUsd(inst.quote, prices) : null,
      openedAt: pos.openedAt,
    }
  })
}

const ORDER: Record<PositionStatus, number> = {
  'Near stop': 0,
  'No stop': 1,
  'Near target': 2,
  Running: 3,
  'No price': 4,
}

/** Cards that need a look first, then newest first. */
export function sortPositions<T extends { pos: OpenPosition; m: PositionMetrics }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => ORDER[a.m.status] - ORDER[b.m.status] || b.pos.openedAt - a.pos.openedAt,
  )
}

export interface ClosedRow {
  key: string
  by: string
  market: string
  side: Side
  /** Net dollars, fees included. */
  pnl: number
  /** Milliseconds. */
  closedAt: number
  /** news: closed before red news (v1, lab bots). session and time: old trades only (the 12:45 close and time limits, until 2026-11-12). */
  reason: 'stop' | 'target' | 'manual' | 'session' | 'time' | 'news'
}

export function closedTrades(
  state: RaceState | null | undefined,
  account: PaperAccount,
  /** Which funded size's trades (the $10K unless another is given). */
  size: number = FUNDED.startMoney,
  test: FundedTestId = 'v1',
): ClosedRow[] {
  const race: ClosedRow[] = (fundedOf(state, size, test)?.closed ?? []).map((t) => ({
    key: `funded:${t.market}:${t.exitTime}${t.part1Of ? ':part' : ''}`,
    by: FUNDED.name,
    market: t.market,
    side: t.direction,
    pnl: t.pnl,
    closedAt: t.exitTime * 1000,
    reason: t.reason,
  }))
  const demo: ClosedRow[] = account.history.map((t) => ({
    key: `demo:${t.id}`,
    by: 'Demo',
    market: t.instrumentId,
    side: t.side,
    pnl: t.pnl,
    closedAt: t.closedAt,
    reason: t.reason,
  }))
  return [...race, ...demo].sort((a, b) => b.closedAt - a.closedAt)
}

/**
 * Money already settled in the funded test: every closed trade (after fees)
 * minus the entry fees open trades still owe. Plus the open P&L, this is its
 * result (`fundedMoney` in race/funded.ts minus the start). 0 without one.
 */
export function settledSoFar(
  state: RaceState | null | undefined,
  size: number = FUNDED.startMoney,
  test: FundedTestId = 'v1',
): number {
  const f = fundedOf(state, size, test)
  if (!f) return 0
  return f.balance - f.startMoney - f.open.reduce((a, t) => a + t.entryFee, 0)
}

export interface Tally {
  wins: number
  losses: number
  won: number
  lost: number
  net: number
}

export function tally(rows: ClosedRow[]): Tally {
  const t: Tally = { wins: 0, losses: 0, won: 0, lost: 0, net: 0 }
  for (const r of rows) {
    if (r.pnl >= 0) {
      t.wins++
      t.won += r.pnl
    } else {
      t.losses++
      t.lost += r.pnl
    }
    t.net += r.pnl
  }
  return t
}

/** Start of today and of the last 7 days, in local time, milliseconds. */
export function periodStarts(now: number): { today: number; week: number } {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return { today: d.getTime(), week: d.getTime() - 6 * 86_400_000 }
}
