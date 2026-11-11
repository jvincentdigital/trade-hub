import { z } from 'zod'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'
import { LEVERAGE } from '../paper/engine'
import { getInstrument } from '../paper/instruments'
import { usdPerQuoteFor } from '../sizing/sizing'
import { RACE_SIZING, sizeRaceTrade, sizingSchema, type RaceSizing } from './account'

// "Live from today" race: a forward test. Every hour a tick looks at fresh
// candles. Each strategy trades ONE play account across all its markets (one
// trade per market at a time), sized like a real account (./account.ts):
// every trade risks 2% of the current balance. Pure functions; the script
// does the I/O.

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
  /** Coins, ounces or forex units of the base currency. */
  units: z.number(),
  /** USD per unit of the quote currency, fixed at entry (1 for USD-quoted markets). */
  usdPerQuote: z.number(),
  /** Balance the trade ties up: position value / leverage. */
  margin: z.number(),
  /** Paid together with the exit fee when the trade closes. */
  entryFee: z.number(),
  /** Why it was opened, in plain words (Claude's picks). */
  note: z.string().optional(),
  /** First target (lab bots, John's Fib: half off at 0): `part1` of the units close there, the rest keeps going. */
  target1: z.number().optional(),
  part1: z.number().optional(),
  /** Latest time it may stay open (lab bots: day trade 17:00 New York, swing 5 days, race 10 days). */
  deadline: z.number().optional(),
})
export type LiveTrade = z.infer<typeof liveTradeSchema>

export const closedLiveTradeSchema = liveTradeSchema.extend({
  exitTime: z.number(),
  exit: z.number(),
  /** time: its deadline passed; news: closed before red news (lab bots). A first-target close is a "target" with part1Of set. */
  reason: z.enum(['stop', 'target', 'time', 'news']),
  /** Set on the first-target close of a trade: the share of the units it closed. */
  part1Of: z.number().optional(),
  /** Net dollars, both fees included. */
  pnl: z.number(),
  fees: z.number(),
})
export type ClosedLiveTrade = z.infer<typeof closedLiveTradeSchema>

export const raceStrategySchema = z.object({
  ruleId: z.string(),
  name: z.string(),
  /** Start money plus every closed trade's net P&L. New trades risk 2% of it. */
  balance: z.number(),
  open: z.array(liveTradeSchema),
  /** Newest signal candle already acted on, per market, so one signal makes one trade. */
  lastSignal: z.record(z.string(), z.number()),
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
  /**
   * Still 1: the race relay worker (race-worker/) only accepts version 1.
   * The `sizing` field is what marks this one-account layout.
   */
  version: z.literal(1),
  sizing: sizingSchema,
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
  rules: { id: string; name: string }[],
  startMoney: number,
  now = Date.now(),
  sizing: RaceSizing = RACE_SIZING,
): RaceState {
  return {
    version: 1,
    sizing,
    startedAt: now,
    startMoney,
    tickCount: 0,
    ticks: [],
    prices: {},
    strategies: Object.fromEntries(
      rules.map((r) => [
        r.id,
        { ruleId: r.id, name: r.name, balance: startMoney, open: [], lastSignal: {}, closed: [] },
      ]),
    ),
  }
}

/** A strategy added to the built-in rules joins a running race with fresh money. */
export function syncRaceState(
  state: RaceState,
  rules: { id: string; name: string }[],
): { state: RaceState; changes: string[] } {
  const missing = rules.filter((r) => !state.strategies[r.id])
  if (!missing.length) return { state, changes: [] }
  const fresh = createRaceState(missing, state.startMoney).strategies
  return {
    state: { ...state, strategies: { ...state.strategies, ...fresh } },
    changes: missing.map((r) => `${r.name} joined the race`),
  }
}

// ── The old layout (until 2026-11-10): money split over one slot per market ──

const legacyTradeSchema = liveTradeSchema
  .omit({ units: true, usdPerQuote: true, margin: true })
  .extend({ notional: z.number() })
const legacyStateSchema = z.object({
  version: z.literal(1),
  startedAt: z.number(),
  startMoney: z.number().positive(),
  tickCount: z.number().int(),
  ticks: z.array(tickLogSchema),
  prices: z.record(z.string(), z.number()),
  strategies: z.record(
    z.string(),
    z.object({
      ruleId: z.string(),
      name: z.string(),
      slots: z.record(
        z.string(),
        z.object({
          balance: z.number(),
          open: legacyTradeSchema.nullable(),
          lastSignalTime: z.number(),
        }),
      ),
      closed: z.array(
        legacyTradeSchema.extend({
          exitTime: z.number(),
          exit: z.number(),
          reason: z.enum(['stop', 'target']),
          pnl: z.number(),
          fees: z.number(),
        }),
      ),
    }),
  ),
})
type LegacyState = z.infer<typeof legacyStateSchema>

/**
 * Old race file into the new layout, with every dollar kept: the slots'
 * cash becomes one balance (entry fees of open trades added back, since they
 * are now paid at the close), and each trade's dollar size becomes units.
 * Old trades keep their old (small) size; new trades use the new sizing.
 */
function fromLegacy(old: LegacyState): RaceState {
  const convert = <T extends { market: string; entry: number; notional: number }>(t: T) => {
    const inst = getInstrument(t.market)
    const q = usdPerQuoteFor(inst, t.entry, old.prices) ?? 1
    const { notional, ...rest } = t
    return {
      ...rest,
      units: notional / (t.entry * q),
      usdPerQuote: q,
      margin: notional / LEVERAGE[inst?.market ?? 'crypto'],
    }
  }
  const strategies: Record<string, RaceStrategy> = {}
  for (const [id, s] of Object.entries(old.strategies)) {
    const slots = Object.entries(s.slots)
    const open = slots.flatMap(([, sl]) => (sl.open ? [convert(sl.open)] : []))
    strategies[id] = {
      ruleId: s.ruleId,
      name: s.name,
      balance:
        slots.reduce((a, [, sl]) => a + sl.balance, 0) + open.reduce((a, t) => a + t.entryFee, 0),
      open,
      lastSignal: Object.fromEntries(slots.map(([m, sl]) => [m, sl.lastSignalTime])),
      closed: s.closed.map(convert),
    }
  }
  const { version, startedAt, startMoney, tickCount, ticks, prices } = old
  return {
    version,
    sizing: RACE_SIZING,
    startedAt,
    startMoney,
    tickCount,
    ticks,
    prices,
    strategies,
  }
}

/** Read a race file of either layout; the old one is moved to the new layout. */
export function parseRaceState(
  raw: unknown,
): { ok: true; state: RaceState; migrated: boolean } | { ok: false; error: string } {
  const cur = raceStateSchema.safeParse(raw)
  if (cur.success) return { ok: true, state: cur.data, migrated: false }
  const old = legacyStateSchema.safeParse(raw)
  if (old.success) return { ok: true, state: fromLegacy(old.data), migrated: true }
  return { ok: false, error: cur.error.message }
}

// ── One tick ─────────────────────────────────────────────────────────────

export interface MarketTick {
  market: string
  /** latestSignal on CLOSED candles of the rule's timeframe, or null. */
  signal: Signal | null
  /** Candles to check stop and target on (1h for crypto and gold, daily for forex), oldest first. */
  path: OHLCCandle[]
  /** Latest price (entry price for a new trade). */
  price: number
  /** USD per unit of the quote currency now; null when that rate is missing. */
  usdPerQuote: number | null
  feeRate: number
  leverage: number
  /** Stored on a trade this signal opens (Claude's picks: the reason). */
  note?: string
  /** Lab bots: first target of a trade this signal opens (half closes there). */
  target1?: number
  /** Lab bots: latest time a trade this signal opens may stay open. */
  deadline?: number
  /** Lab bots with the news filter on "close": close this market's open trades now, at the price. */
  closeNow?: boolean
}

export interface StepResult {
  strategy: RaceStrategy
  opened: LiveTrade[]
  closed: ClosedLiveTrade[]
  /** Signals a limit kept out (5 open, 10% open risk, no free margin), with the reason. */
  passed: { market: string; reason: string }[]
}

const dir = (d: 'long' | 'short') => (d === 'long' ? 1 : -1)

/** Dollars lost if the stop is hit, from entry, before fees. */
export const tradeRisk = (t: LiveTrade) => t.units * Math.abs(t.entry - t.stop) * t.usdPerQuote

/** One exit of a trade (all of it, or the first-target part). */
interface Exit {
  exit: number
  time: number
  reason: ClosedLiveTrade['reason']
  /** Share of the trade's units this exit closes (1 = all that is left). */
  share: number
}

/**
 * The exits a trade reaches on later path candles: the stop first (a gap
 * fills at the open), then the first target (part of the units), then the
 * target; a candle starting at or after its deadline closes it at that
 * candle's open. Skipped: the candle the entry happened in, and any candle
 * that started before the entry (a market whose path moved to smaller
 * candles, like forex from daily to 15m on 2026-11-10, must not look before
 * its entry).
 */
function exitsOf(t: LiveTrade, path: OHLCCandle[]): Exit[] {
  const long = t.direction === 'long'
  const out: Exit[] = []
  let first = t.target1
  for (const c of path) {
    if (c.time <= t.entryBucket || c.time < t.entryTime) continue
    if (t.deadline != null && c.time >= t.deadline) {
      out.push({ exit: c.open, time: c.time, reason: 'time', share: 1 })
      return out
    }
    if (long ? c.low <= t.stop : c.high >= t.stop) {
      const gapped = long ? c.open < t.stop : c.open > t.stop
      out.push({ exit: gapped ? c.open : t.stop, time: c.time, reason: 'stop', share: 1 })
      return out
    }
    if (first != null && (long ? c.high >= first : c.low <= first)) {
      out.push({ exit: first, time: c.time, reason: 'target', share: t.part1 ?? 0.5 })
      first = undefined
    }
    if (long ? c.high >= t.takeProfit : c.low <= t.takeProfit) {
      out.push({ exit: t.takeProfit, time: c.time, reason: 'target', share: 1 })
      return out
    }
  }
  return out
}

/** Close `share` of a trade's units at an exit: the closed part and what stays open. */
function closePart(
  t: LiveTrade,
  x: Exit,
  feeRate: number,
): { closed: ClosedLiveTrade; rest: LiveTrade | null } {
  const part = Math.min(1, Math.max(0, x.share))
  const units = t.units * part
  const entryFee = t.entryFee * part
  const gross = units * dir(t.direction) * (x.exit - t.entry) * t.usdPerQuote
  const exitFee = units * x.exit * t.usdPerQuote * feeRate
  const closed: ClosedLiveTrade = {
    ...t,
    units,
    margin: t.margin * part,
    entryFee,
    exitTime: x.time,
    exit: x.exit,
    reason: x.reason,
    pnl: gross - entryFee - exitFee,
    fees: entryFee + exitFee,
    ...(part < 1 ? { part1Of: part } : {}),
  }
  if (part >= 1) return { closed, rest: null }
  const { target1: _t1, part1: _p1, ...keep } = t
  void _t1
  void _p1
  return {
    closed,
    rest: {
      ...keep,
      units: t.units - units,
      margin: t.margin - closed.margin,
      entryFee: t.entryFee - entryFee,
    },
  }
}

/**
 * One tick for one strategy:
 * 1. Each open trade closes if a later path candle of its market hit its stop
 *    or target (lab bots also: part at a first target, at their deadline, or
 *    before red news); both fees are paid then and the net P&L goes to the
 *    balance.
 * 2. Each market's signal newer than the last one used is consumed. With no
 *    trade open in that market it opens at the latest price, risking 2% of
 *    the balance, unless a limit says no (see sizeRaceTrade).
 */
export function stepStrategy(
  s: RaceStrategy,
  markets: MarketTick[],
  nowSec: number,
  sizing: RaceSizing = RACE_SIZING,
): StepResult {
  const byMarket = new Map(markets.map((m) => [m.market, m]))
  let balance = s.balance
  const open: LiveTrade[] = []
  const closed: ClosedLiveTrade[] = []
  for (const t0 of s.open) {
    const m = byMarket.get(t0.market)
    if (!m) {
      open.push(t0)
      continue
    }
    let t: LiveTrade | null = t0
    for (const x of exitsOf(t0, m.path)) {
      if (!t) break
      const r = closePart(t, x, m.feeRate)
      balance += r.closed.pnl
      closed.push(r.closed)
      t = r.rest
    }
    // No later candle yet, but the deadline has passed or red news is due:
    // close at the price now, while the market trades (its newest candle is
    // under 2 hours old). Shut for the weekend, the reopen candle closes it.
    const last = m.path[m.path.length - 1]
    const live = !!last && nowSec - last.time < 2 * 3600
    const late = t?.deadline != null && nowSec >= t.deadline
    if (t && live && m.price > 0 && (late || m.closeNow)) {
      const r = closePart(
        t,
        { exit: m.price, time: nowSec, reason: late ? 'time' : 'news', share: 1 },
        m.feeRate,
      )
      balance += r.closed.pnl
      closed.push(r.closed)
      t = null
    }
    if (t) open.push(t)
  }

  const lastSignal = { ...s.lastSignal }
  const opened: LiveTrade[] = []
  const passed: StepResult['passed'] = []
  for (const m of markets) {
    const sig = m.signal
    if (!sig || sig.time <= (lastSignal[m.market] ?? 0)) continue
    lastSignal[m.market] = sig.time
    const p = m.price
    const valid =
      p > 0 &&
      (sig.direction === 'long'
        ? p > sig.stop && p < sig.takeProfit && (m.target1 == null || p < m.target1)
        : p < sig.stop && p > sig.takeProfit && (m.target1 == null || p > m.target1))
    if (!valid || open.some((t) => t.market === m.market)) continue
    if (m.usdPerQuote == null) {
      passed.push({ market: m.market, reason: 'no USD rate for its quote currency' })
      continue
    }
    const size = sizeRaceTrade({
      balance,
      open: open.map((t) => ({ margin: t.margin, riskUsd: tradeRisk(t) })),
      entry: p,
      stop: sig.stop,
      usdPerQuote: m.usdPerQuote,
      leverage: m.leverage,
      sizing,
    })
    if (!size.ok) {
      passed.push({ market: m.market, reason: size.reason })
      continue
    }
    const t: LiveTrade = {
      market: m.market,
      direction: sig.direction,
      signalTime: sig.time,
      entryTime: nowSec,
      entryBucket: m.path[m.path.length - 1]?.time ?? nowSec,
      entry: p,
      stop: sig.stop,
      takeProfit: sig.takeProfit,
      units: size.units,
      usdPerQuote: m.usdPerQuote,
      margin: size.margin,
      entryFee: size.valueUsd * m.feeRate,
      ...(m.note ? { note: m.note } : {}),
      ...(m.target1 != null ? { target1: m.target1, part1: 0.5 } : {}),
      ...(m.deadline != null ? { deadline: m.deadline } : {}),
    }
    open.push(t)
    opened.push(t)
  }
  return {
    strategy: { ...s, balance, open, lastSignal, closed: [...s.closed, ...closed] },
    opened,
    closed,
    passed,
  }
}

/** Unrealized dollars on an open trade (before fees). */
export function openPnl(t: LiveTrade, price: number | undefined): number {
  return price ? t.units * dir(t.direction) * (price - t.entry) * t.usdPerQuote : 0
}

export interface LiveSummary {
  ruleId: string
  name: string
  /** Balance plus open P&L, minus the entry fees open trades still owe. */
  money: number
  pnl: number
  open: (LiveTrade & { pnl: number })[]
  closed: ClosedLiveTrade[]
}

export function summarize(state: RaceState): LiveSummary[] {
  return Object.values(state.strategies)
    .map((s) => {
      const open = s.open.map((t) => ({ ...t, pnl: openPnl(t, state.prices[t.market]) }))
      const money = s.balance + open.reduce((a, t) => a + t.pnl - t.entryFee, 0)
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
