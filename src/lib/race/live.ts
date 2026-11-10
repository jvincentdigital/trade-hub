import { z } from 'zod'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'

// "Live from today" race: a forward test. Every hour a tick looks at fresh
// candles; each strategy has its own play account, split evenly over its
// markets (one slot per market, one trade at a time per slot), the same way
// as the 90-day leaderboard. Pure functions; the script does the I/O.

const sideSchema = z.enum(['long', 'short'])

export const liveTradeSchema = z.object({
  market: z.string(),
  direction: sideSchema,
  signalTime: z.number(),
  /** Unix seconds when the tick opened it. */
  entryTime: z.number(),
  /** Start of the path candle the entry happened in; stop/target checks start after it. */
  entryBucket: z.number(),
  entry: z.number(),
  stop: z.number(),
  takeProfit: z.number(),
  /** Position value in dollars at entry. */
  notional: z.number(),
  entryFee: z.number(),
})
export type LiveTrade = z.infer<typeof liveTradeSchema>

export const closedLiveTradeSchema = liveTradeSchema.extend({
  exitTime: z.number(),
  exit: z.number(),
  reason: z.enum(['stop', 'target']),
  /** Net dollars, both fees included. */
  pnl: z.number(),
  fees: z.number(),
})
export type ClosedLiveTrade = z.infer<typeof closedLiveTradeSchema>

export const slotSchema = z.object({
  /** Cash in this market's share (entry fees already taken out). */
  balance: z.number(),
  open: liveTradeSchema.nullable(),
  /** Newest signal candle already acted on, so one signal makes one trade. */
  lastSignalTime: z.number(),
})
export type Slot = z.infer<typeof slotSchema>

export const raceStrategySchema = z.object({
  ruleId: z.string(),
  name: z.string(),
  slots: z.record(z.string(), slotSchema),
  closed: z.array(closedLiveTradeSchema),
})
export type RaceStrategy = z.infer<typeof raceStrategySchema>

export const tickLogSchema = z.object({
  at: z.number(),
  checked: z.number(),
  opened: z.number(),
  closed: z.number(),
  skipped: z.array(z.string()),
})
export type TickLog = z.infer<typeof tickLogSchema>

export const raceStateSchema = z.object({
  version: z.literal(1),
  /** Milliseconds. */
  startedAt: z.number(),
  startMoney: z.number().positive(),
  tickCount: z.number().int(),
  /** Newest last, capped. */
  ticks: z.array(tickLogSchema),
  /** Latest price per market seen by the last tick, for open P&L. */
  prices: z.record(z.string(), z.number()),
  strategies: z.record(z.string(), raceStrategySchema),
})
export type RaceState = z.infer<typeof raceStateSchema>

export const MAX_TICK_LOG = 500

export function createRaceState(
  rules: { id: string; name: string; markets: string[] }[],
  startMoney: number,
  now = Date.now(),
): RaceState {
  const strategies: Record<string, RaceStrategy> = {}
  for (const r of rules) {
    const share = startMoney / Math.max(1, r.markets.length)
    strategies[r.id] = {
      ruleId: r.id,
      name: r.name,
      slots: Object.fromEntries(
        r.markets.map((m) => [m, { balance: share, open: null, lastSignalTime: 0 }]),
      ),
      closed: [],
    }
  }
  return {
    version: 1,
    startedAt: now,
    startMoney,
    tickCount: 0,
    ticks: [],
    prices: {},
    strategies,
  }
}

/**
 * Bring an existing race up to date without touching open trades:
 * - a new strategy joins with fresh money (the same start as everyone);
 * - a new market (gold, added 2026-11-10) gets a share of an even split, and
 *   that cash is taken evenly from the strategy's existing slots, so each
 *   strategy's total money (and P&L) is unchanged at the moment it joins.
 * Returns the new state and a line per change, for the log.
 */
export function syncRaceState(
  state: RaceState,
  rules: { id: string; name: string; markets: string[] }[],
): { state: RaceState; changes: string[] } {
  const changes: string[] = []
  const strategies = { ...state.strategies }
  for (const r of rules) {
    const cur = strategies[r.id]
    if (!cur) {
      strategies[r.id] = createRaceState([r], state.startMoney).strategies[r.id]
      changes.push(`${r.name} joined the race`)
      continue
    }
    const missing = r.markets.filter((m) => !cur.slots[m])
    const existing = Object.keys(cur.slots)
    if (!missing.length) continue
    const share = state.startMoney / (existing.length + missing.length)
    const takeEach = existing.length ? (share * missing.length) / existing.length : 0
    const slots: Record<string, Slot> = {}
    for (const m of existing)
      slots[m] = { ...cur.slots[m], balance: cur.slots[m].balance - takeEach }
    for (const m of missing) slots[m] = { balance: share, open: null, lastSignalTime: 0 }
    strategies[r.id] = { ...cur, slots }
    changes.push(`${r.name}: added ${missing.join(', ')}`)
  }
  return { state: { ...state, strategies }, changes }
}

export interface StepInput {
  market: string
  /** latestSignal on CLOSED candles of the rule's timeframe, or null. */
  signal: Signal | null
  /** Candles to check stop and target on (1h for crypto, daily for forex), oldest first. */
  path: OHLCCandle[]
  /** Latest price (entry price for a new trade). */
  price: number
  nowSec: number
  riskPct: number
  feeRate: number
  leverage: number
}

export interface StepResult {
  slot: Slot
  opened: LiveTrade | null
  closed: ClosedLiveTrade | null
}

const dir = (d: 'long' | 'short') => (d === 'long' ? 1 : -1)

function close(
  slot: Slot,
  t: LiveTrade,
  exit: number,
  exitTime: number,
  reason: 'stop' | 'target',
  feeRate: number,
): { slot: Slot; closed: ClosedLiveTrade } {
  const gross = (t.notional * dir(t.direction) * (exit - t.entry)) / t.entry
  const exitFee = ((t.notional * exit) / t.entry) * feeRate
  const closed: ClosedLiveTrade = {
    ...t,
    exitTime,
    exit,
    reason,
    pnl: gross - t.entryFee - exitFee,
    fees: t.entryFee + exitFee,
  }
  return { slot: { ...slot, balance: slot.balance + gross - exitFee, open: null }, closed }
}

/**
 * One tick for one strategy on one market:
 * 1. An open trade closes if a later path candle hit its stop (checked first,
 *    like the backtest; a gap through the stop fills at that candle's open) or
 *    its target.
 * 2. A signal newer than the last one used is consumed. With no open trade it
 *    opens at the latest price, sized to risk `riskPct` of the slot, capped at
 *    slot × leverage, paying the entry fee now.
 */
export function stepSlot(slot: Slot, input: StepInput): StepResult {
  let cur = slot
  let closed: ClosedLiveTrade | null = null
  let opened: LiveTrade | null = null

  const t = cur.open
  if (t) {
    const long = t.direction === 'long'
    for (const c of input.path) {
      if (c.time <= t.entryBucket) continue
      const stopHit = long ? c.low <= t.stop : c.high >= t.stop
      const tpHit = long ? c.high >= t.takeProfit : c.low <= t.takeProfit
      if (stopHit) {
        const gapped = long ? c.open < t.stop : c.open > t.stop
        ;({ slot: cur, closed } = close(
          cur,
          t,
          gapped ? c.open : t.stop,
          c.time,
          'stop',
          input.feeRate,
        ))
        break
      }
      if (tpHit) {
        ;({ slot: cur, closed } = close(cur, t, t.takeProfit, c.time, 'target', input.feeRate))
        break
      }
    }
  }

  const s = input.signal
  if (s && s.time > cur.lastSignalTime) {
    cur = { ...cur, lastSignalTime: s.time }
    const p = input.price
    const valid =
      p > 0 &&
      (s.direction === 'long' ? p > s.stop && p < s.takeProfit : p < s.stop && p > s.takeProfit)
    if (!cur.open && valid && cur.balance > 0) {
      const riskFrac = input.riskPct / 100
      const size = Math.min(riskFrac / (Math.abs(p - s.stop) / p), input.leverage)
      const notional = size * cur.balance
      const entryFee = notional * input.feeRate
      opened = {
        market: input.market,
        direction: s.direction,
        signalTime: s.time,
        entryTime: input.nowSec,
        entryBucket: input.path[input.path.length - 1]?.time ?? input.nowSec,
        entry: p,
        stop: s.stop,
        takeProfit: s.takeProfit,
        notional,
        entryFee,
      }
      cur = { ...cur, balance: cur.balance - entryFee, open: opened }
    }
  }
  return { slot: cur, opened, closed }
}

/** Unrealized dollars on an open trade (before the exit fee). */
export function openPnl(t: LiveTrade, price: number | undefined): number {
  return price ? (t.notional * dir(t.direction) * (price - t.entry)) / t.entry : 0
}

export interface LiveSummary {
  ruleId: string
  name: string
  money: number
  pnl: number
  open: (LiveTrade & { pnl: number })[]
  closed: ClosedLiveTrade[]
}

export function summarize(state: RaceState): LiveSummary[] {
  return Object.values(state.strategies)
    .map((s) => {
      const open = Object.values(s.slots)
        .flatMap((sl) => (sl.open ? [sl.open] : []))
        .map((t) => ({ ...t, pnl: openPnl(t, state.prices[t.market]) }))
      const money =
        Object.values(s.slots).reduce((a, sl) => a + sl.balance, 0) +
        open.reduce((a, t) => a + t.pnl, 0)
      return {
        ruleId: s.ruleId,
        name: s.name,
        money,
        pnl: money - state.startMoney,
        open,
        closed: s.closed,
      }
    })
    .sort((a, b) => b.money - a.money)
}
