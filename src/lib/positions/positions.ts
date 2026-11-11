import type { PaperAccount } from '../paper/schema'
import { getInstrument, quoteToUsd, type PriceMap } from '../paper/instruments'
import type { RaceState } from '../race/live'

// Open trades from the race (every strategy) and the demo account in one
// shape, plus the numbers the home screen shows per card. Pure, tested.

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

/** Every open race trade, one per strategy and market. */
export function racePositions(state: RaceState | null | undefined): OpenPosition[] {
  if (!state) return []
  return Object.values(state.strategies).flatMap((s) =>
    s.open.map((t) => ({
      key: `race:${s.ruleId}:${t.market}`,
      source: 'race' as const,
      by: s.name,
      ruleId: s.ruleId,
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
    })),
  )
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
  reason: 'stop' | 'target' | 'manual' | 'session'
}

export function closedTrades(
  state: RaceState | null | undefined,
  account: PaperAccount,
): ClosedRow[] {
  const race: ClosedRow[] = state
    ? Object.values(state.strategies).flatMap((s) =>
        s.closed.map((t) => ({
          key: `race:${s.ruleId}:${t.market}:${t.exitTime}`,
          by: s.name,
          market: t.market,
          side: t.direction,
          pnl: t.pnl,
          closedAt: t.exitTime * 1000,
          reason: t.reason,
        })),
      )
    : []
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
 * Money already settled in the race accounts: every closed trade (after fees)
 * minus the entry fees open trades still owe. Plus the open P&L, this is the
 * result the Race tab shows (`summarize` in race/live.ts). 0 without a race.
 */
export function settledSoFar(state: RaceState | null | undefined): number {
  if (!state) return 0
  return Object.values(state.strategies).reduce(
    (a, s) => a + s.balance - state.startMoney - s.open.reduce((f, t) => f + t.entryFee, 0),
    0,
  )
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
