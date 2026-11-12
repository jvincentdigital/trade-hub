import { z } from 'zod'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'
import { LEVERAGE } from '../paper/engine'
import { getInstrument } from '../paper/instruments'
import { usdPerQuoteFor } from '../sizing/sizing'
import { newTradeBlock, RACE_SIZING, sizeRaceTrade, sizingSchema, type RaceSizing } from './account'
import { dailyCloseDue } from './session'

// "Live from today" race: a forward test. Every hour a tick looks at fresh
// candles. Each strategy trades ONE play account across all its markets (one
// trade per market at a time), sized like a real account (./account.ts):
// every trade risks 2% of the current balance. Pure functions; the script
// does the I/O.

const sideSchema = z.enum(['long', 'short'])

/**
 * John's Method (Lab, ./johnsMethodLive.ts): the ladder a part belongs to.
 * Every open part of one trade carries the same copy; the step keeps them in
 * line. `half2`, `add` and `ladder` are 'none' / 'alive' until decided, then
 * the outcome in plain words.
 */
export const jmPartSchema = z.object({
  part: z.enum(['half1', 'both', 'half2', 'add']),
  one: z.number(),
  zero: z.number(),
  l886: z.number(),
  /** The trade's first stop (S); the add moves every part's `stop` to S2. */
  S: z.number(),
  /** Start of the 1-hour candle the first part filled in. */
  fillHour: z.number(),
  half2: z.string(),
  add: z.string(),
  ladder: z.string(),
})
export type JmPart = z.infer<typeof jmPartSchema>

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
  /** John's London v1 on GBP/USD: a stop or target counts only when confirmed (the lone-wick rule in exitsOf). */
  confirm: z.boolean().optional(),
  /** John's Method (Lab): its ladder (jmPartSchema). */
  jm: jmPartSchema.optional(),
})
export type LiveTrade = z.infer<typeof liveTradeSchema>

export const closedLiveTradeSchema = liveTradeSchema.extend({
  exitTime: z.number(),
  exit: z.number(),
  /**
   * manual = closed by you; session = the 12:45 AST daily close (./session.ts);
   * time: its deadline passed; news: closed before red news (lab bots). A
   * first-target close is a "target" with part1Of set.
   */
  reason: z.enum(['stop', 'target', 'manual', 'session', 'time', 'news']),
  /** Set on the first-target close of a trade: the share of the units it closed. */
  part1Of: z.number().optional(),
  /** Net dollars, both fees included. */
  pnl: z.number(),
  fees: z.number(),
})
export type ClosedLiveTrade = z.infer<typeof closedLiveTradeSchema>

/** How a closed race trade ended, in the words the pages show. */
export const REASON_TEXT: Record<ClosedLiveTrade['reason'], string> = {
  stop: 'hit stop',
  target: 'hit target',
  manual: 'closed by you',
  session: 'closed at 12:45',
  time: 'closed at its time limit',
  news: 'closed before red news',
}

export const raceStrategySchema = z.object({
  ruleId: z.string(),
  name: z.string(),
  /** Start money plus every closed trade's net P&L. New trades risk 2% of it. */
  balance: z.number(),
  open: z.array(liveTradeSchema),
  /** Newest signal candle already acted on, per market, so one signal makes one trade. */
  lastSignal: z.record(z.string(), z.number()),
  closed: z.array(closedLiveTradeSchema),
  /** Milliseconds: when an account that joined a running race got its money (syncRaceState). */
  joinedAt: z.number().optional(),
})
export type RaceStrategy = z.infer<typeof raceStrategySchema>

/** A funded test trade (./funded.ts): a race trade plus the strategy whose signal opened it. */
export const fundedTradeSchema = liveTradeSchema.extend({ strategy: z.string() })
export type FundedTrade = z.infer<typeof fundedTradeSchema>
export const closedFundedTradeSchema = closedLiveTradeSchema.extend({ strategy: z.string() })
export type ClosedFundedTrade = z.infer<typeof closedFundedTradeSchema>

/** A funded test account (John, 2026-11-11): FTMO-style limits; four sizes since 2026-11-12. */
export const fundedSchema = z.object({
  startMoney: z.number().positive(),
  /** Milliseconds. */
  startedAt: z.number(),
  /** Start money plus every closed trade's net P&L. */
  balance: z.number(),
  open: z.array(fundedTradeSchema),
  closed: z.array(closedFundedTradeSchema),
  /** Newest signal acted on, per "<strategy>:<market>", so one signal makes one trade. */
  lastSignal: z.record(z.string(), z.number()),
  status: z.enum(['active', 'passed', 'failed']),
  /** Which rule broke, or how it passed, in plain words. */
  statusNote: z.string().optional(),
  /** Unix seconds of the check that failed or passed it. */
  statusAt: z.number().optional(),
})
export type FundedState = z.infer<typeof fundedSchema>

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
  /** The $10,000 funded test account; started by the first tick that runs this code. */
  funded: fundedSchema.optional(),
  /**
   * The $50,000, $100,000 and $200,000 funded tests (John, 2026-11-12): the
   * same rules as `funded`, every limit scaled to the size (./funded.ts). The
   * $10,000 stays in `funded`, so older readers of race.json keep working.
   */
  fundedSizes: z.array(fundedSchema).optional(),
  /** Unix seconds of the check that did the last 12:45 AST daily close (./session.ts). */
  dailyCloseAt: z.number().optional(),
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
  now = Date.now(),
): { state: RaceState; changes: string[] } {
  const missing = rules.filter((r) => !state.strategies[r.id])
  if (!missing.length) return { state, changes: [] }
  const fresh = Object.fromEntries(
    Object.entries(createRaceState(missing, state.startMoney).strategies).map(([id, s]) => [
      id,
      { ...s, joinedAt: now },
    ]),
  )
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
          reason: z.enum(['stop', 'target', 'manual']),
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
  /** Move the signal's stop and target to the fill price (built-in rules, see entryLevels). */
  reanchor?: boolean
  /** Lab bots: first target of a trade this signal opens (half closes there). */
  target1?: number
  /** Lab bots: latest time a trade this signal opens may stay open. */
  deadline?: number
  /** Lab bots with the news filter on "close": close this market's open trades now, at the price. */
  closeNow?: boolean
  /** John's London v1: the sizer sizes on this stop (the real stop plus both fees), the trade keeps `signal.stop`. */
  sizeStop?: number
  /** John's London v1: skip a trade the margin cap cut below this % of the balance at risk. */
  minRiskPct?: number
  /** John's London v1 on GBP/USD: the trade this signal opens uses confirmed exits (lone-wick rule). */
  confirm?: boolean
  /** John's London v1: with no signal handed over, a signal candle it looked at and passed (moves lastSignal). */
  seen?: number
}

export interface StepResult {
  strategy: RaceStrategy
  opened: LiveTrade[]
  closed: ClosedLiveTrade[]
  /** Signals a rule or limit kept out (crypto, pound/dollar, 5 open, 10% open risk, no free margin), with the reason. */
  passed: { market: string; reason: string }[]
  /** Confirmed-exit trades: reaches that nothing confirmed, ignored (logged as LONE WICK). */
  wicks: LoneWick[]
}

export interface LoneWick {
  market: string
  level: 'stop' | 'TP1' | 'TP2'
  price: number
  /** Start of the candle that reached the level. */
  time: number
  /** Start of the next candle, which did not reach it. */
  next: number
}

const dir = (d: 'long' | 'short') => (d === 'long' ? 1 : -1)

/**
 * Stop and target for a trade that fills at `price`, or null when the price
 * has already left the signal's stop-to-target range. With `reanchor` (the
 * built-in rules, 2026-11-11 post-mortem) the signal's own distances are
 * measured from the fill instead of the signal's close, so the trade keeps
 * the planned reward to risk: BNB's 2R plan filled higher and became 1.53R
 * with the old fixed levels. The size always comes from the fill-to-stop
 * distance, so the dollars at the stop stay 2% either way.
 */
export function entryLevels(
  sig: Pick<Signal, 'direction' | 'entry' | 'stop' | 'takeProfit'>,
  price: number,
  reanchor = false,
): { stop: number; takeProfit: number } | null {
  const valid =
    price > 0 &&
    (sig.direction === 'long'
      ? price > sig.stop && price < sig.takeProfit
      : price < sig.stop && price > sig.takeProfit)
  if (!valid) return null
  if (!reanchor) return { stop: sig.stop, takeProfit: sig.takeProfit }
  return { stop: price - (sig.entry - sig.stop), takeProfit: price + (sig.takeProfit - sig.entry) }
}

/** A trade closed at `exit`: both fees paid now, net P&L in `pnl`. */
export function bookClose<T extends LiveTrade>(
  t: T,
  exit: number,
  timeSec: number,
  reason: ClosedLiveTrade['reason'],
  feeRate: number,
): T & Pick<ClosedLiveTrade, 'exitTime' | 'exit' | 'reason' | 'pnl' | 'fees'> {
  const gross = t.units * dir(t.direction) * (exit - t.entry) * t.usdPerQuote
  const exitFee = t.units * exit * t.usdPerQuote * feeRate
  return {
    ...t,
    exitTime: timeSec,
    exit,
    reason,
    pnl: gross - t.entryFee - exitFee,
    fees: t.entryFee + exitFee,
  }
}

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
function exitsOf(t: LiveTrade, path: OHLCCandle[], wicks: LoneWick[] = []): Exit[] {
  if (t.confirm) return confirmedExitsOf(t, path, wicks)
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

/**
 * Exits with the lone-wick rule (John's London v1 on GBP/USD, SPEC.md 6,
 * "Exits"): Kraken's thin forex book prints fake wicks, so a candle that
 * reaches the stop, TP1 or TP2 counts only when it also closes at or past it
 * (a stop then fills at that close), or when the very next candle reaches it
 * too (a stop then fills at that candle's open or the stop, whichever is
 * worse). A target always fills at its price. A reach with neither is a lone
 * wick: ignored and reported. A reach on the newest candle waits for the next
 * one, and nothing after it is decided yet. Same order as exitsOf: deadline,
 * stop, TP1, TP2; a confirmed stop beats a target on the same candle.
 */
function confirmedExitsOf(t: LiveTrade, path: OHLCCandle[], wicks: LoneWick[]): Exit[] {
  const long = t.direction === 'long'
  const live = path.filter((c) => c.time > t.entryBucket && c.time >= t.entryTime)
  const out: Exit[] = []
  let first = t.target1
  const reaches = (c: OHLCCandle, level: number, stop: boolean) =>
    long === stop ? c.low <= level : c.high >= level
  const closesPast = (c: OHLCCandle, level: number, stop: boolean) =>
    long === stop ? c.close <= level : c.close >= level
  /** 'close' | 'next' | 'lone' | 'wait' for a reach of `level` on candle i. */
  const confirm = (i: number, level: number, stop: boolean) => {
    if (closesPast(live[i], level, stop)) return 'close'
    const next = live[i + 1]
    if (!next) return 'wait'
    if (t.deadline != null && next.time >= t.deadline) return 'lone'
    return reaches(next, level, stop) ? 'next' : 'lone'
  }
  const lone = (i: number, level: 'stop' | 'TP1' | 'TP2', price: number) =>
    wicks.push({ market: t.market, level, price, time: live[i].time, next: live[i + 1].time })
  for (let i = 0; i < live.length; i++) {
    const c = live[i]
    if (t.deadline != null && c.time >= t.deadline) {
      out.push({ exit: c.open, time: c.time, reason: 'time', share: 1 })
      return out
    }
    if (reaches(c, t.stop, true)) {
      const how = confirm(i, t.stop, true)
      if (how === 'wait') return out
      if (how === 'close') {
        out.push({ exit: c.close, time: c.time, reason: 'stop', share: 1 })
        return out
      }
      if (how === 'next') {
        const n = live[i + 1]
        const exit = long ? Math.min(n.open, t.stop) : Math.max(n.open, t.stop)
        out.push({ exit, time: n.time, reason: 'stop', share: 1 })
        return out
      }
      lone(i, 'stop', t.stop)
    }
    for (const [level, price] of [
      ['TP1', first],
      ['TP2', t.takeProfit],
    ] as const) {
      if (price == null || !reaches(c, price, false)) continue
      const how = confirm(i, price, false)
      if (how === 'wait') return out
      if (how === 'lone') {
        lone(i, level, price)
        continue
      }
      // A TP1 confirmed by the next candle keeps TP2's close from looking earlier.
      const time = Math.max(how === 'close' ? c.time : live[i + 1].time, out.at(-1)?.time ?? 0)
      if (level === 'TP1') {
        out.push({ exit: price, time, reason: 'target', share: t.part1 ?? 0.5 })
        first = undefined
      } else {
        out.push({ exit: price, time, reason: 'target', share: 1 })
        return out
      }
    }
  }
  return out
}

/** A trade (or part of one) once closed: the exit fields on top of the trade's own. */
export type Closed<T extends LiveTrade> = T &
  Pick<ClosedLiveTrade, 'exitTime' | 'exit' | 'reason' | 'pnl' | 'fees' | 'part1Of'>

/** Close `share` of a trade's units at an exit: the closed part and what stays open. */
function closePart<T extends LiveTrade>(
  t: T,
  x: Exit,
  feeRate: number,
): { closed: Closed<T>; rest: T | null } {
  const part = Math.min(1, Math.max(0, x.share))
  const piece = {
    ...t,
    units: t.units * part,
    margin: t.margin * part,
    entryFee: t.entryFee * part,
  }
  const closed: Closed<T> = {
    ...bookClose(piece, x.exit, x.time, x.reason, feeRate),
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
      units: t.units - piece.units,
      margin: t.margin - piece.margin,
      entryFee: t.entryFee - piece.entryFee,
    } as T,
  }
}

/**
 * One open trade checked against its market at this tick, for every account
 * (the funded test too): the parts that closed, both fees booked, and what is
 * still open. Exits on later path candles (exitsOf), then, with no later
 * candle yet, the deadline or red news (`closeNow`) at the price now.
 */
export function tradeExits<T extends LiveTrade>(
  t0: T,
  m: Pick<MarketTick, 'path' | 'price' | 'feeRate' | 'closeNow'>,
  nowSec: number,
  /** Confirmed-exit trades (John's London v1 on GBP/USD): lone wicks are added here. */
  wicks: LoneWick[] = [],
): { closed: Closed<T>[]; open: T | null } {
  const closed: Closed<T>[] = []
  let t: T | null = t0
  for (const x of exitsOf(t0, m.path, wicks)) {
    if (!t) break
    const r: { closed: Closed<T>; rest: T | null } = closePart(t, x, m.feeRate)
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
    closed.push(r.closed)
    t = null
  }
  return { closed, open: t }
}

/**
 * One tick for one strategy:
 * 1. Each open trade closes if a later path candle of its market hit its stop
 *    or target (lab bots also: part at a first target, at their deadline, or
 *    before red news); both fees are paid then and the net P&L goes to the
 *    balance.
 * 2. Each market's signal newer than the last one used is consumed. With no
 *    trade open in that market it opens at the latest price, risking 2% of
 *    the balance, unless a rule for new trades (newTradeBlock: Bitcoin only
 *    among crypto, one pound/dollar bet, no once-a-day markets) or a limit
 *    (sizeRaceTrade) says no.
 */
export function stepStrategy(
  s: RaceStrategy,
  markets: MarketTick[],
  nowSec: number,
  sizing: RaceSizing = RACE_SIZING,
  /** Why no new trade may open now (entryWindowBlock in ./session.ts): signals are used up and passed. */
  blockNew: string | null = null,
): StepResult {
  const byMarket = new Map(markets.map((m) => [m.market, m]))
  let balance = s.balance
  const open: LiveTrade[] = []
  const closed: ClosedLiveTrade[] = []
  const wicks: LoneWick[] = []
  for (const t0 of s.open) {
    const m = byMarket.get(t0.market)
    if (!m) {
      open.push(t0)
      continue
    }
    const r = tradeExits(t0, m, nowSec, wicks)
    for (const c of r.closed) {
      balance += c.pnl
      closed.push(c)
    }
    if (r.open) open.push(r.open)
  }

  const lastSignal = { ...s.lastSignal }
  const opened: LiveTrade[] = []
  const passed: StepResult['passed'] = []
  for (const m of markets) {
    const sig = m.signal
    if (!sig && m.seen != null) lastSignal[m.market] = Math.max(lastSignal[m.market] ?? 0, m.seen)
    if (!sig || sig.time <= (lastSignal[m.market] ?? 0)) continue
    lastSignal[m.market] = sig.time
    if (blockNew) {
      passed.push({ market: m.market, reason: blockNew })
      continue
    }
    const p = m.price
    const levels = entryLevels(sig, p, m.reanchor)
    // A first target (lab bots) must still be ahead of the price too.
    const t1Ahead = m.target1 == null || (sig.direction === 'long' ? p < m.target1 : p > m.target1)
    if (!levels || !t1Ahead || open.some((t) => t.market === m.market)) continue
    // Bitcoin only among crypto; one pound/dollar bet per account (account.ts).
    const block = newTradeBlock({ market: m.market, direction: sig.direction }, open)
    if (block) {
      passed.push({ market: m.market, reason: block })
      continue
    }
    if (m.usdPerQuote == null) {
      passed.push({ market: m.market, reason: 'no USD rate for its quote currency' })
      continue
    }
    const size = sizeRaceTrade({
      balance,
      open: open.map((t) => ({ margin: t.margin, riskUsd: tradeRisk(t) })),
      entry: p,
      stop: m.sizeStop ?? levels.stop,
      usdPerQuote: m.usdPerQuote,
      leverage: m.leverage,
      sizing,
    })
    if (!size.ok) {
      passed.push({ market: m.market, reason: size.reason })
      continue
    }
    if (m.minRiskPct != null && size.capped && size.riskUsd < (balance * m.minRiskPct) / 100) {
      passed.push({
        market: m.market,
        reason: `the margin cap cut it under ${m.minRiskPct}% at risk`,
      })
      continue
    }
    const t: LiveTrade = {
      market: m.market,
      direction: sig.direction,
      signalTime: sig.time,
      entryTime: nowSec,
      entryBucket: m.path[m.path.length - 1]?.time ?? nowSec,
      entry: p,
      stop: levels.stop,
      takeProfit: levels.takeProfit,
      units: size.units,
      usdPerQuote: m.usdPerQuote,
      margin: size.margin,
      entryFee: size.valueUsd * m.feeRate,
      ...(m.note ? { note: m.note } : {}),
      ...(m.target1 != null ? { target1: m.target1, part1: 0.5 } : {}),
      ...(m.deadline != null ? { deadline: m.deadline } : {}),
      ...(m.confirm ? { confirm: true } : {}),
    }
    open.push(t)
    opened.push(t)
  }
  return {
    strategy: { ...s, balance, open, lastSignal, closed: [...s.closed, ...closed] },
    opened,
    closed,
    passed,
    wicks,
  }
}

/**
 * Close every open trade at the given price per market, with both fees booked
 * like a stop or target close: by hand (John, 2026-11-11, reason 'manual') or
 * at the 12:45 AST daily close ('session'). Trades on a market with no price
 * stay open and are listed in `missing`. Pure.
 */
export function closeAll(
  state: RaceState,
  exitPrices: Record<string, number>,
  timeSec: number,
  feeRate: (market: string) => number,
  reason: 'manual' | 'session' = 'manual',
  /** Accounts left as they are (John's Method holds for days: no 12:45 close). */
  keepOpen: readonly string[] = [],
): { state: RaceState; closed: (ClosedLiveTrade & { strategy: string })[]; missing: string[] } {
  const closed: (ClosedLiveTrade & { strategy: string })[] = []
  const missing = new Set<string>()
  /** One account's open trades closed; the ones with no price stay open. */
  const closeAccount = <T extends LiveTrade>(account: string, trades: T[], balance: number) => {
    const open: T[] = []
    const done: ReturnType<typeof bookClose<T>>[] = []
    for (const t of trades) {
      const exit = exitPrices[t.market]
      if (!(exit > 0)) {
        missing.add(t.market)
        open.push(t)
        continue
      }
      const c = bookClose(t, exit, timeSec, reason, feeRate(t.market))
      balance += c.pnl
      done.push(c)
      closed.push({ ...c, strategy: account })
    }
    return { balance, open, done }
  }
  const strategies = Object.fromEntries(
    Object.entries(state.strategies).map(([id, s]) => {
      if (keepOpen.includes(id)) return [id, s]
      const r = closeAccount(s.name, s.open, s.balance)
      return [id, { ...s, balance: r.balance, open: r.open, closed: [...s.closed, ...r.done] }]
    }),
  )
  const closeFunded = (f: FundedState): FundedState => {
    const r = closeAccount(`Funded test $${f.startMoney / 1000}K`, f.open, f.balance)
    return { ...f, balance: r.balance, open: r.open, closed: [...f.closed, ...r.done] }
  }
  const funded = state.funded && closeFunded(state.funded)
  const fundedSizes = state.fundedSizes?.map(closeFunded)
  return {
    state: { ...state, strategies, funded, ...(fundedSizes ? { fundedSizes } : {}) },
    closed,
    missing: [...missing],
  }
}

/**
 * The daily close (John, 2026-11-11), run at the end of every check: at the
 * first check at or after 12:45 AST on a weekday, every open trade closes at
 * that check's price, reason 'session'. A race that has never done one starts
 * counting from this check, so the rule begins at the next 12:45, not at once.
 */
export function applyDailyClose(
  state: RaceState,
  nowSec: number,
  feeRate: (market: string) => number,
  /** Accounts the daily close leaves alone (closeAll's keepOpen). */
  keepOpen: readonly string[] = [],
): ReturnType<typeof closeAll> {
  if (state.dailyCloseAt == null)
    return { state: { ...state, dailyCloseAt: nowSec }, closed: [], missing: [] }
  if (!dailyCloseDue(nowSec, state.dailyCloseAt)) return { state, closed: [], missing: [] }
  const r = closeAll(state, state.prices, nowSec, feeRate, 'session', keepOpen)
  return { ...r, state: { ...r.state, dailyCloseAt: nowSec } }
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
