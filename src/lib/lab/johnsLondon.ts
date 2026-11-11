// John's London Strategy v1 and v1-flip, the official code for the frozen
// spec ~/jvd-outputs/2026-11-11/london-strategy/SPEC.md (section numbers in
// the comments point there). Pure: candles and news in, signals, trades and
// scores out, no IO. The backtest runner is scripts/lab/london-v1.ts.
//
// In short (UTC unless it says London): GBP/USD and gold, 15-minute candles
// built from 1-minute BID candles, 07:00 to 15:00 London for entries, flat by
// 16:30 London. After a big move (k ATRs inside 12 candles) the Fib is drawn
// with 1 at the last opposite candle and 0 at the end of the move. A closed
// candle that reaches 0.786 without passing 1 is the signal; the trade opens
// at the next 1-minute open. Stop past 1 by b ATRs (at least 10 round trips
// of costs, plan between 1.5R and 2.5R), half off at 0, the rest at -0.272.
// v1-flip adds a reverse trade after the day's first trade is stopped, and a
// re-entry at a better price after a reverse that won.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { seeded } from './control'
import { fibLevel, impulseAt } from './fib'
import { labMarket, slippageAt, spreadAt, type LabMarket } from './markets'
import { inWindow, newsWindows, nextWindowStart, type NewsEvent, type Window } from './news'
import { directionTest } from './stats'
import { DAY, HOUR, MIN, londonSummer, utcWeekday } from './time'

/** Every fixed number of v1 (section 4, "Everything below is fixed"). */
export const V1 = {
  impulseBars: 12,
  setupLife: 24,
  atrPeriod: 14,
  zone: 0.786,
  tp2Level: -0.272,
  costFloorX: 10,
  rrMin: 1.5,
  rrMax: 2.5,
  noChase: 0.9,
  newsPad: 30 * MIN,
  minLife: 90 * MIN,
  entryWait: 5 * MIN,
  aliveSlots: 20,
  aliveMin: 14,
  riskPct: 2,
  minRiskPct: 1,
  maxOpen: 5,
  maxOpenRiskPct: 10,
  maxPerDay: 2,
  sameCurrencyMax: 2,
  flipMinLeft: 30 * MIN,
  reverseLimit: 120 * MIN,
  reWatch: 8,
  startMoney: 10_000,
  /** Within this many R the tie-breaks of section 4 apply. */
  pickWithinR: 2,
  minTradesToPick: 100,
  maxDrawdownToPick: 0.25,
} as const

/** The pre-registered settings (section 4). Defaults first. */
export const V1_GRID = { k: [2, 3], b: [0.5, 1.0], q: [0.5, 1.0] } as const
export const V1_DEFAULTS = { k: 2, b: 0.5, q: 0.5 } as const

export const M15 = 900
/** 2025-11-11 00:00 UTC: the design year starts cold here (section 10). */
export const DESIGN_START = 1_762_819_200

// ── Markets and costs (2.2) ───────────────────────────────────────────────

export type LondonMarketId = 'GBPUSD' | 'XAUUSD'
export const LONDON_MARKETS: LondonMarketId[] = ['GBPUSD', 'XAUUSD']

/** GBP/USD uses the lab's costs as they are; gold has its own (0.040% a round trip), never labMarket('XAUUSD'). */
export function londonMarket(id: LondonMarketId): LabMarket {
  if (id === 'GBPUSD') return labMarket('GBPUSD')
  if (id === 'XAUUSD')
    return {
      ...labMarket('XAUUSD'),
      spread: 0.0003,
      slippage: 0.0000125,
      pct: true,
      fee: 0.0000375,
      leverage: 20,
    }
  throw new Error(`v1 trades GBPUSD and XAUUSD only, not ${String(id)}`)
}

/** One round trip at bid p: spread + 2 x slip + 2 x fee x p. */
export const roundTrip = (m: LabMarket, p: number, mult = 1) =>
  spreadAt(m, p, mult) + 2 * slippageAt(m, p, mult) + 2 * m.fee * mult * p

/** Market entry at bid p: BUY pays bid + spread + slip, SELL gets bid - slip. */
export const entryFill = (m: LabMarket, long: boolean, p: number, mult = 1) =>
  long ? p + spreadAt(m, p, mult) + slippageAt(m, p, mult) : p - slippageAt(m, p, mult)

/** Forced close at a candle's bid open. */
export const forcedFill = (m: LabMarket, long: boolean, open: number, mult = 1) =>
  long
    ? open - slippageAt(m, open, mult)
    : open + spreadAt(m, open, mult) + slippageAt(m, open, mult)

export const stopHit = (m: LabMarket, long: boolean, b: OHLCCandle, stop: number, mult = 1) =>
  long ? b.low <= stop : b.high + spreadAt(m, b.high, mult) >= stop

/** Stop fill: the stop plus slip against us, or the open plus slip when the candle opened past it. */
export function stopFill(m: LabMarket, long: boolean, b: OHLCCandle, stop: number, mult = 1) {
  if (long)
    return b.open < stop ? b.open - slippageAt(m, b.open, mult) : stop - slippageAt(m, stop, mult)
  const ask = b.open + spreadAt(m, b.open, mult)
  return ask > stop ? ask + slippageAt(m, b.open, mult) : stop + slippageAt(m, stop, mult)
}

export const targetHit = (m: LabMarket, long: boolean, b: OHLCCandle, target: number, mult = 1) =>
  long ? b.high >= target : b.low + spreadAt(m, b.low, mult) <= target

// ── Clock (2.1) ───────────────────────────────────────────────────────────

export interface Session {
  day: number
  summer: boolean
  start: number
  lastEntry: number
  timeExit: number
}

/** Session times of a UTC day; the season is read at 12:00 UTC. */
export function sessionFor(day: number): Session {
  const summer = londonSummer(day + 12 * HOUR)
  const off = summer ? HOUR : 0
  return {
    day,
    summer,
    start: day + 7 * HOUR - off,
    lastEntry: day + 15 * HOUR - off,
    timeExit: day + 16.5 * HOUR - off,
  }
}

export const isTradingDay = (day: number) => {
  const w = utcWeekday(day)
  return w >= 1 && w <= 5
}

// ── Candles ───────────────────────────────────────────────────────────────

/** 15-minute candles (:00, :15, :30, :45) from 1-minute candles. */
export function resample15(m1: OHLCCandle[]): OHLCCandle[] {
  const out: OHLCCandle[] = []
  for (const b of m1) {
    const t = Math.floor(b.time / M15) * M15
    const c = out[out.length - 1]
    if (c && c.time === t) {
      if (b.high > c.high) c.high = b.high
      if (b.low < c.low) c.low = b.low
      c.close = b.close
    } else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close })
  }
  return out
}

export function firstAtOrAfter(c: OHLCCandle[], t: number): number {
  let lo = 0
  let hi = c.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (c[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the first 1-minute candle that starts at T or up to and including T + 5 minutes, or -1. */
export function entryMinute(m1: OHLCCandle[], T: number): number {
  const i = firstAtOrAfter(m1, T)
  return i < m1.length && m1[i].time <= T + V1.entryWait ? i : -1
}

// ── One market's data ─────────────────────────────────────────────────────

export interface LondonData {
  market: LabMarket
  id: LondonMarketId
  m1: OHLCCandle[]
  c15: OHLCCandle[]
  atr: number[]
  /** 15-minute candle start time to index. */
  byTime: Map<number, number>
  /** Red-news blocks for this market: 30 minutes before to 30 minutes after, merged. */
  windows: Window[]
}

/** Build a market's 15-minute chart, ATR and news blocks from its 1-minute candles. */
export function prepareMarket(id: LondonMarketId, m1: OHLCCandle[], news: NewsEvent[]): LondonData {
  const market = londonMarket(id)
  const c15 = resample15(m1)
  return {
    market,
    id,
    m1,
    c15,
    atr: atrSeries(c15, V1.atrPeriod),
    byTime: new Map(c15.map((c, i) => [c.time, i])),
    windows: newsWindows(news, market.currencies, 'block'),
  }
}

/** The forced close for a trade at `t`: the time exit, or 30 minutes before the next red event if earlier. */
export function forcedCloseAt(
  d: LondonData,
  s: Session,
  t: number,
): { at: number; why: 'time' | 'news' } {
  const n = nextWindowStart(d.windows, t)
  return n < s.timeExit ? { at: n, why: 'news' } : { at: s.timeExit, why: 'time' }
}

/** Check 3: of the 20 fifteen-minute slots before T, at least 14 hold a candle with high above low. */
export function dataAlive(d: LondonData, T: number): boolean {
  let n = 0
  for (let k = 1; k <= V1.aliveSlots; k++) {
    const i = d.byTime.get(T - k * M15)
    if (i != null && d.c15[i].high > d.c15[i].low) n++
  }
  return n >= V1.aliveMin
}

// ── Setups and signals (2.3) ──────────────────────────────────────────────

export interface LondonSignal {
  day: number
  /** Index of the signal candle in the 15-minute chart. */
  i: number
  /** Start of the signal candle. */
  time: number
  /** Order time: the signal candle's close. */
  T: number
  long: boolean
  one: number
  zero: number
  oneIdx: number
  armedIdx: number
  level: number
  /** ATR[i], for the stop buffer. */
  atr: number
}

interface Armed {
  one: number
  zero: number
  oneIdx: number
  armedIdx: number
}

/**
 * Every signal of one day, both trackers. Uses only 15-minute candles that
 * start at or after session start and close by last entry, and at candle j
 * reads nothing after j (the impulse test looks back, ATR[j] ends at j).
 */
export function daySignals(
  c15: OHLCCandle[],
  atr: number[],
  s: Session,
  k: number,
): LondonSignal[] {
  const out: LondonSignal[] = []
  const tr: Record<'down' | 'up', Armed | null> = { down: null, up: null }
  for (let j = firstAtOrAfter(c15, s.start); j < c15.length; j++) {
    const b = c15[j]
    if (b.time + M15 > s.lastEntry) break
    const fired: Partial<Record<'down' | 'up', LondonSignal>> = {}
    for (const dir of ['down', 'up'] as const) {
      const long = dir === 'up'
      const st = tr[dir]
      // A: a setup armed on an earlier candle.
      if (st && j > st.armedIdx) {
        let signal = false
        if (long ? b.high > st.zero : b.low < st.zero) {
          st.zero = long ? b.high : b.low // A1: 0 follows the move, no signal
        } else {
          const level = fibLevel(st.one, st.zero, V1.zone)
          signal = long ? b.low <= level && b.low >= st.one : b.high >= level && b.high <= st.one
          if (signal)
            fired[dir] = {
              day: s.day,
              i: j,
              time: b.time,
              T: b.time + M15,
              long,
              one: st.one,
              zero: st.zero,
              oneIdx: st.oneIdx,
              armedIdx: st.armedIdx,
              level,
              atr: atr[j],
            }
        }
        // A3, always.
        const past1 = long ? b.low < st.one : b.high > st.one
        if (signal || past1 || j - st.armedIdx >= V1.setupLife) tr[dir] = null
      }
      // B: an empty tracker runs the impulse test on this candle.
      if (!tr[dir]) {
        const imp = impulseAt(c15, atr, j, dir, k, V1.impulseBars, 'candle')
        if (imp) tr[dir] = { one: imp.one, zero: imp.zero, oneIdx: imp.oneIdx, armedIdx: j }
      }
    }
    const { down, up } = fired
    if (down && up) {
      // Both on one candle: the one armed later; armed together, neither.
      if (down.armedIdx > up.armedIdx) out.push(down)
      else if (up.armedIdx > down.armedIdx) out.push(up)
    } else if (down) out.push(down)
    else if (up) out.push(up)
  }
  return out
}

// ── Stop and targets (2.5) ────────────────────────────────────────────────

export interface Plan {
  rawStop: number
  rawDist: number
  dist: number
  stop: number
  tp1: number
  tp2: number
  reward: number
  rr: number
  floored: boolean
  capped: boolean
}

/**
 * Steps 2 to 7 of 2.5 at fill E (bid p): the raw stop, the cost floor of 10
 * round trips, both targets on the winning side, the 2.5R cap by a wider
 * stop. Returns the reason when the plan cannot be worked out. The 1.5R
 * minimum is the caller's check (the no-chase reference has none).
 */
export function planFrom(
  m: LabMarket,
  long: boolean,
  E: number,
  p: number,
  rawStop: number,
  tp1: number,
  tp2: number,
  mult = 1,
): Plan | { why: string } {
  const rawDist = long ? E - rawStop : rawStop - E
  if (!(rawDist > 0)) return { why: 'stop not on the losing side' }
  const floor = V1.costFloorX * roundTrip(m, p, mult)
  let dist = Math.max(rawDist, floor)
  const floored = floor > rawDist
  const d1 = long ? tp1 - E : E - tp1
  const d2 = long ? tp2 - E : E - tp2
  if (!(d1 > 0) || !(d2 > 0)) return { why: 'target not on the winning side' }
  const reward = 0.5 * d1 + 0.5 * d2
  const capped = reward / dist > V1.rrMax
  if (capped) dist = reward / V1.rrMax
  return {
    rawStop,
    rawDist,
    dist,
    stop: long ? E - dist : E + dist,
    tp1,
    tp2,
    reward,
    rr: reward / dist,
    floored,
    capped,
  }
}

const isWhy = <T extends object>(x: T | { why: string }): x is { why: string } => 'why' in x

// ── Exits (2.6) ───────────────────────────────────────────────────────────

export type ExitWhy = 'stop' | 'tp1' | 'tp2' | 'target' | 'time' | 'news' | 'limit' | 'end'

export interface Fill {
  time: number
  /** A forced close at the candle's open (before anything else in that minute). */
  atOpen: boolean
  share: number
  price: number
  why: ExitWhy
}

export interface Target {
  price: number
  share: number
  why: ExitWhy
}

export interface Walk {
  fills: Fill[]
  /** Net result per unit, after the fee on every part. */
  pnl: number
  exitTime: number
  why: ExitWhy
  tp1Hit: boolean
}

/**
 * Walk 1-minute candles from index `from`: forced close at the open of the
 * first candle at or after the deadline, else the stop (it counts first),
 * else each target in order (the last one closes the rest).
 */
export function walkExits(o: {
  m: LabMarket
  m1: OHLCCandle[]
  from: number
  long: boolean
  E: number
  stop: number
  targets: Target[]
  deadline: number
  deadlineWhy: ExitWhy
  mult?: number
}): Walk {
  const { m, m1, long, E, stop, targets, deadline } = o
  const mult = o.mult ?? 1
  const fee = m.fee * mult
  const dir = long ? 1 : -1
  const fills: Fill[] = []
  let left = 1
  let next = 0
  const close = (b: OHLCCandle, share: number, price: number, why: ExitWhy, atOpen = false) => {
    fills.push({ time: b.time, atOpen, share, price, why })
    left -= share
  }
  for (let i = o.from; i < m1.length && left > 1e-12; i++) {
    const b = m1[i]
    if (b.time >= deadline) {
      close(b, left, forcedFill(m, long, b.open, mult), o.deadlineWhy, true)
      break
    }
    if (stopHit(m, long, b, stop, mult)) {
      close(b, left, stopFill(m, long, b, stop, mult), 'stop')
      break
    }
    while (next < targets.length && targetHit(m, long, b, targets[next].price, mult)) {
      const t = targets[next++]
      close(b, next === targets.length ? left : Math.min(t.share, left), t.price, t.why)
    }
  }
  if (left > 1e-12 && m1.length) {
    const last = m1[m1.length - 1]
    fills.push({
      time: last.time,
      atOpen: false,
      share: left,
      price: forcedFill(m, long, last.close, mult),
      why: 'end',
    })
  }
  const pnl = fills.reduce((a, f) => a + f.share * (dir * (f.price - E) - fee * (E + f.price)), 0)
  const lastFill = fills[fills.length - 1]
  return {
    fills,
    pnl,
    exitTime: lastFill?.time ?? NaN,
    why: lastFill?.why ?? 'end',
    tp1Hit: fills.some((f) => f.why === 'tp1'),
  }
}

/** Risk per unit (2.8): distance to the stop + slip at p + fee on both sides. */
export const riskPerUnit = (m: LabMarket, E: number, stop: number, p: number, mult = 1) =>
  Math.abs(E - stop) + slippageAt(m, p, mult) + m.fee * mult * (E + stop)

// ── The account (2.8) ─────────────────────────────────────────────────────

/** Same-currency exposure: what move of which currency a trade wins on. Gold long = USD down. */
export function exposures(id: LondonMarketId, long: boolean): string[] {
  if (id === 'GBPUSD') return long ? ['GBP+', 'USD-'] : ['GBP-', 'USD+']
  return long ? ['USD-'] : ['USD+']
}

/** Event order inside one minute: forced closes at the open, entries at the open, fills inside, then the reverse entry. */
export const eventKey = (t: number, order: 0 | 1 | 2 | 3) => t * 4 + order
const fillKey = (f: Fill) => eventKey(f.time, f.atOpen ? 0 : 2)

interface Pos {
  market: LondonMarketId
  long: boolean
  E: number
  rpu: number
  lev: number
  fee: number
  units: number
  unitsOpen: number
  exposures: string[]
}

export interface OpenRequest {
  market: LondonMarketId
  long: boolean
  E: number
  rpu: number
  leverage: number
  fee: number
  fills: Fill[]
  key: number
}

export class LondonAccount {
  balance: number
  peak: number
  maxDrawdown = 0
  maxOpenSeen = 0
  maxOpenRiskSeen = 0
  private open: Pos[] = []
  private pending: { key: number; seq: number; pos: Pos; fill: Fill; last: boolean }[] = []
  private seq = 0

  constructor(readonly start: number = V1.startMoney) {
    this.balance = start
    this.peak = start
  }

  /** Book every fill up to and including this event key, in time order. */
  book(key: number) {
    this.pending.sort((a, b) => a.key - b.key || a.seq - b.seq)
    while (this.pending.length && this.pending[0].key <= key) {
      const p = this.pending.shift()!
      const { pos, fill } = p
      const units = pos.units * fill.share
      const dir = pos.long ? 1 : -1
      this.balance += units * (dir * (fill.price - pos.E) - pos.fee * (pos.E + fill.price))
      pos.unitsOpen -= units
      if (p.last) this.open = this.open.filter((x) => x !== pos)
      if (this.balance > this.peak) this.peak = this.balance
      const dd = (this.peak - this.balance) / this.peak
      if (dd > this.maxDrawdown) this.maxDrawdown = dd
    }
  }

  openCount() {
    return this.open.length
  }

  openRisk() {
    return this.open.reduce((a, x) => a + x.unitsOpen * x.rpu, 0)
  }

  /** Size and open a trade, or say which limit stops it. Fills are booked later at their own times. */
  tryOpen(
    r: OpenRequest,
  ): { units: number; riskUsd: number; balance: number; cut: boolean } | { why: string } {
    this.book(r.key)
    const bal = this.balance
    if (this.open.length >= V1.maxOpen) return { why: 'account: 5 trades open' }
    const ex = exposures(r.market, r.long)
    for (const e of ex)
      if (this.open.filter((x) => x.exposures.includes(e)).length >= V1.sameCurrencyMax)
        return { why: `account: 2 trades already on ${e}` }
    let units = (bal * V1.riskPct) / 100 / r.rpu
    const used = this.open.reduce((a, x) => a + (x.unitsOpen * x.E) / x.lev, 0)
    const maxUnits = (Math.max(0, bal - used) * r.leverage) / r.E
    let cut = false
    if (units > maxUnits) {
      units = maxUnits
      cut = true
      if (units * r.rpu < (bal * V1.minRiskPct) / 100)
        return { why: 'account: margin cut under 1%' }
    }
    const risk = units * r.rpu
    if (this.openRisk() + risk > (bal * V1.maxOpenRiskPct) / 100 + 1e-9)
      return { why: 'account: open risk over 10%' }
    const pos: Pos = {
      market: r.market,
      long: r.long,
      E: r.E,
      rpu: r.rpu,
      lev: r.leverage,
      fee: r.fee,
      units,
      unitsOpen: units,
      exposures: ex,
    }
    this.open.push(pos)
    r.fills.forEach((f, n) =>
      this.pending.push({
        key: fillKey(f),
        seq: this.seq++,
        pos,
        fill: f,
        last: n === r.fills.length - 1,
      }),
    )
    this.maxOpenSeen = Math.max(this.maxOpenSeen, this.open.length)
    this.maxOpenRiskSeen = Math.max(this.maxOpenRiskSeen, this.openRisk() / bal)
    return { units, riskUsd: risk, balance: bal, cut }
  }
}

// ── A run ─────────────────────────────────────────────────────────────────

export type Leg = 'v1' | 'reverse' | 'reentry'

export interface LondonTrade {
  id: number
  market: LondonMarketId
  leg: Leg
  side: 'BUY' | 'SELL'
  long: boolean
  day: string
  summer: boolean
  /** Signal candle start (v1), trigger candle start (re-entry), null for a reverse. */
  signalCandle: number | null
  one: number
  zero: number
  /** Order time (signal close, reverse: the stop minute). */
  T: number
  entryTime: number
  /** Bid reference of the fill. */
  p: number
  E: number
  rawStop: number | null
  stop: number
  dist: number
  tp1: number
  /** null for a reverse trade (one target, in tp1). */
  tp2: number | null
  planRR: number
  deadline: number
  deadlineWhy: ExitWhy
  rpu: number
  units: number
  riskUsd: number
  balanceAtEntry: number
  fills: Fill[]
  exitTime: number
  why: ExitWhy
  tp1Hit: boolean
  r: number
  usd: number
  /** Net dollars as a share of the balance at entry, in %. */
  pct: number
  /** Index of the original (for reverse and re-entry legs). */
  original: number | null
}

export interface RunOptions {
  k: number
  b: number
  flip: boolean
  q?: number
  startMoney?: number
}

export interface Outcome {
  market: LondonMarketId
  leg: Leg
  T: number
  side: 'BUY' | 'SELL'
  result: string
}

export interface RunResult {
  options: Required<Omit<RunOptions, 'q'>> & { q: number | null }
  trades: LondonTrade[]
  /** Every signal and flip step, with what came of it. */
  outcomes: Outcome[]
  signals: number
  endBalance: number
  maxDrawdown: number
  maxOpenSeen: number
  maxOpenRiskSeen: number
}

interface Ready {
  entryIdx: number
  entryTime: number
  p: number
  E: number
  plan: Plan
  deadline: { at: number; why: 'time' | 'news' }
  walk: Walk
}

/** Checks 2 to 6 of 2.4 and the exit walk for a v1 signal. All from data, none from the account. */
export function prepareV1(
  d: LondonData,
  s: Session,
  sig: LondonSignal,
  b: number,
): Ready | { why: string } {
  const m = d.market
  const T = sig.T
  if (inWindow(d.windows, T)) return { why: 'news block' }
  const fc = forcedCloseAt(d, s, T)
  if (fc.at - T < V1.minLife) return { why: 'under 90 minutes to the forced close' }
  if (!dataAlive(d, T)) return { why: 'thin data' }
  const iE = entryMinute(d.m1, T)
  if (iE < 0) return { why: 'no 1-minute candle' }
  const p = d.m1[iE].open
  const E = entryFill(m, sig.long, p)
  const rawStop = sig.long ? sig.one - b * sig.atr : sig.one + b * sig.atr
  const tp1 = sig.zero
  const tp2 = fibLevel(sig.one, sig.zero, V1.tp2Level)
  const plan = planFrom(m, sig.long, E, p, rawStop, tp1, tp2)
  if (isWhy(plan)) return plan
  if (plan.rr < V1.rrMin) return { why: 'plan under 1.5R' }
  const close = d.c15[sig.i].close
  const ref = planFrom(
    m,
    sig.long,
    sig.long ? close + spreadAt(m, close) : close,
    close,
    rawStop,
    tp1,
    tp2,
  )
  if (isWhy(ref)) return { why: 'no chase: no plan at the signal close' }
  if (plan.reward < V1.noChase * ref.reward || plan.rr < V1.noChase * ref.rr)
    return { why: 'no chase' }
  const walk = walkExits({
    m,
    m1: d.m1,
    from: iE,
    long: sig.long,
    E,
    stop: plan.stop,
    targets: [
      { price: tp1, share: 0.5, why: 'tp1' },
      { price: tp2, share: 0.5, why: 'tp2' },
    ],
    deadline: fc.at,
    deadlineWhy: fc.why,
  })
  return { entryIdx: iE, entryTime: d.m1[iE].time, p, E, plan, deadline: fc, walk }
}

/** Index of the 15-minute candle that holds time t (or the first after it). */
const candleOf = (d: LondonData, t: number) =>
  d.byTime.get(Math.floor(t / M15) * M15) ?? firstAtOrAfter(d.c15, t)

/**
 * F3: after a reverse trade that won, find the re-entry. Watches the 8
 * fifteen-minute candles from the one the reverse closed in (each must close
 * by last entry) for the first that closes the original's way at a better
 * price than the original's fill. Reads candles only up to that one.
 */
export function prepareReentry(
  d: LondonData,
  s: Session,
  orig: LondonTrade,
  reverseExit: number,
  b: number,
):
  | { trigger: null; watchEnd: number }
  | { trigger: number; T: number; ready: Ready | { why: string } } {
  const c = d.c15
  const long = orig.long
  const j0 = candleOf(d, reverseExit)
  let watchEnd = reverseExit
  let j = -1
  for (let n = 0; n < V1.reWatch && j0 + n < c.length; n++) {
    const x = c[j0 + n]
    if (x.time + M15 > s.lastEntry) break
    watchEnd = x.time + M15
    const ourWay = long ? x.close > x.open : x.close < x.open
    const better = long ? x.close < orig.E : x.close > orig.E
    if (ourWay && better) {
      j = j0 + n
      break
    }
  }
  if (j < 0) return { trigger: null, watchEnd }
  const T = c[j].time + M15
  const fail = (why: string) => ({ trigger: j, T, ready: { why } })
  if (inWindow(d.windows, T)) return fail('news block')
  const fc = forcedCloseAt(d, s, T)
  if (fc.at - T < V1.minLife) return fail('under 90 minutes to the forced close')
  if (!dataAlive(d, T)) return fail('thin data')
  const iE = entryMinute(d.m1, T)
  if (iE < 0) return fail('no 1-minute candle')
  // The extreme since the original's entry: candles from the one that starts at its T through j.
  let ext = long ? Infinity : -Infinity
  for (let x = candleOf(d, orig.T); x <= j; x++)
    ext = long ? Math.min(ext, c[x].low) : Math.max(ext, c[x].high)
  const m = d.market
  const p = d.m1[iE].open
  const E = entryFill(m, long, p)
  const rawStop = long ? ext - b * d.atr[j] : ext + b * d.atr[j]
  const tp2 = orig.tp2 ?? fibLevel(orig.one, orig.zero, V1.tp2Level)
  const plan = planFrom(m, long, E, p, rawStop, orig.tp1, tp2)
  if (isWhy(plan)) return fail(plan.why)
  if (plan.rr < V1.rrMin) return fail('plan under 1.5R')
  const walk = walkExits({
    m,
    m1: d.m1,
    from: iE,
    long,
    E,
    stop: plan.stop,
    targets: [
      { price: orig.tp1, share: 0.5, why: 'tp1' },
      { price: tp2, share: 0.5, why: 'tp2' },
    ],
    deadline: fc.at,
    deadlineWhy: fc.why,
  })
  return {
    trigger: j,
    T,
    ready: { entryIdx: iE, entryTime: d.m1[iE].time, p, E, plan, deadline: fc, walk },
  }
}

/** F2: the reverse trade after a stopped original, at the original's stop fill, checked from the next minute. */
export function prepareReverse(
  d: LondonData,
  s: Session,
  orig: LondonTrade,
  q: number,
): Ready & { stopIdx: number } {
  const m = d.market
  const stopFillPrice = orig.fills[orig.fills.length - 1].price
  const X = orig.exitTime
  const stopIdx = firstAtOrAfter(d.m1, X)
  const bar = d.m1[stopIdx]
  const long = !orig.long
  const E = stopFillPrice
  // Bid reference of this fill: after a stopped SELL the BUY paid the ask (bid = ask - spread).
  const gapped = orig.long ? bar.open < orig.stop : bar.open + spreadAt(m, bar.open) > orig.stop
  const p = gapped ? bar.open : orig.long ? orig.stop : orig.stop - spreadAt(m, orig.stop)
  const dist = orig.dist
  const stop = long ? E - dist : E + dist
  const target = long ? E + q * dist : E - q * dist
  const fc = forcedCloseAt(d, s, X)
  const limit = X + V1.reverseLimit
  const deadline = limit <= fc.at ? { at: limit, why: 'limit' as const } : fc
  const walk = walkExits({
    m,
    m1: d.m1,
    from: stopIdx + 1,
    long,
    E,
    stop,
    targets: [{ price: target, share: 1, why: 'target' }],
    deadline: deadline.at,
    deadlineWhy: deadline.why,
  })
  const plan: Plan = {
    rawStop: stop,
    rawDist: dist,
    dist,
    stop,
    tp1: target,
    tp2: target,
    reward: q * dist,
    rr: q,
    floored: false,
    capped: false,
  }
  return {
    entryIdx: stopIdx,
    entryTime: X,
    p,
    E,
    plan,
    deadline: deadline as Ready['deadline'],
    walk,
    stopIdx,
  }
}

const dayIso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

/**
 * One full run over every trading day in [from, to): both markets in one
 * $10,000 account, events in time order (fills before entries at the same
 * moment, the stopped original before its reverse).
 */
export function runLondon(data: LondonData[], o: RunOptions, from: number, to: number): RunResult {
  const q = o.q ?? V1_DEFAULTS.q
  const acct = new LondonAccount(o.startMoney ?? V1.startMoney)
  const trades: LondonTrade[] = []
  const outcomes: Outcome[] = []
  let signals = 0
  const side = (long: boolean) => (long ? 'BUY' : 'SELL') as 'BUY' | 'SELL'

  for (let day = Math.floor(from / DAY) * DAY; day < to; day += DAY) {
    if (!isTradingDay(day)) continue
    const s = sessionFor(day)
    type Action = { key: number; run: () => void }
    const mk = data.map((d) => {
      const st = {
        d,
        actions: [] as Action[],
        open: null as { trade: LondonTrade; endKey: number } | null,
        opened: 0,
        ownedUntil: -Infinity,
      }
      const add = (a: Action) => {
        st.actions.push(a)
        st.actions.sort((x, y) => x.key - y.key)
      }
      const openTrade = (
        leg: Leg,
        long: boolean,
        r: Ready,
        key: number,
        meta: {
          signalCandle: number | null
          one: number
          zero: number
          T: number
          original: number | null
        },
      ): LondonTrade | string => {
        const m = d.market
        const rpu = riskPerUnit(m, r.E, r.plan.stop, r.p)
        const got = acct.tryOpen({
          market: d.id,
          long,
          E: r.E,
          rpu,
          leverage: m.leverage,
          fee: m.fee,
          fills: r.walk.fills,
          key,
        })
        if ('why' in got) return got.why
        const t: LondonTrade = {
          id: trades.length,
          market: d.id,
          leg,
          side: side(long),
          long,
          day: dayIso(day),
          summer: s.summer,
          signalCandle: meta.signalCandle,
          one: meta.one,
          zero: meta.zero,
          T: meta.T,
          entryTime: r.entryTime,
          p: r.p,
          E: r.E,
          rawStop: leg === 'reverse' ? null : r.plan.rawStop,
          stop: r.plan.stop,
          dist: r.plan.dist,
          tp1: r.plan.tp1,
          tp2: leg === 'reverse' ? null : r.plan.tp2,
          planRR: r.plan.rr,
          deadline: r.deadline.at,
          deadlineWhy: r.deadline.why,
          rpu,
          units: got.units,
          riskUsd: got.riskUsd,
          balanceAtEntry: got.balance,
          fills: r.walk.fills,
          exitTime: r.walk.exitTime,
          why: r.walk.why,
          tp1Hit: r.walk.tp1Hit,
          r: r.walk.pnl / rpu,
          usd: got.units * r.walk.pnl,
          pct: ((got.units * r.walk.pnl) / got.balance) * 100,
          original: meta.original,
        }
        trades.push(t)
        st.open = { trade: t, endKey: Math.max(...t.fills.map(fillKey)) }
        return t
      }

      const startFlip = (orig: LondonTrade) => {
        const X = orig.exitTime
        const key = eventKey(X, 3)
        add({
          key,
          run: () => {
            const note = (result: string) =>
              outcomes.push({ market: d.id, leg: 'reverse', T: X, side: side(!orig.long), result })
            if (inWindow(d.windows, X)) return note('no flip: news block')
            if (forcedCloseAt(d, s, X).at - X < V1.flipMinLeft)
              return note('no flip: under 30 minutes to the forced close')
            st.ownedUntil = Infinity
            const rev = prepareReverse(d, s, orig, q)
            const t = openTrade('reverse', !orig.long, rev, key, {
              signalCandle: null,
              one: orig.one,
              zero: orig.zero,
              T: X,
              original: orig.id,
            })
            if (typeof t === 'string') {
              st.ownedUntil = key // the flip ends at once; the second trade stays free
              return note(`reverse not opened (${t})`)
            }
            st.opened++
            note('trade')
            if (t.why !== 'target') {
              st.ownedUntil = st.open!.endKey
              return
            }
            const re = prepareReentry(d, s, orig, t.exitTime, o.b)
            if (re.trigger === null) {
              st.ownedUntil = eventKey(re.watchEnd, 1)
              return
            }
            const reKey = isWhy(re.ready) ? eventKey(re.T, 1) : eventKey(re.ready.entryTime, 1)
            st.ownedUntil = Infinity
            add({
              key: reKey,
              run: () => {
                const noteRe = (result: string) =>
                  outcomes.push({
                    market: d.id,
                    leg: 'reentry',
                    T: re.T,
                    side: side(orig.long),
                    result,
                  })
                st.ownedUntil = reKey
                if (isWhy(re.ready)) return noteRe(re.ready.why)
                if (st.open && st.open.endKey >= eventKey(re.T, 1)) return noteRe('trade open')
                const t2 = openTrade('reentry', orig.long, re.ready, reKey, {
                  signalCandle: d.c15[re.trigger].time,
                  one: orig.one,
                  zero: orig.zero,
                  T: re.T,
                  original: orig.id,
                })
                if (typeof t2 === 'string') return noteRe(t2)
                st.ownedUntil = st.open!.endKey
                noteRe('trade')
              },
            })
          },
        })
      }

      for (const sig of daySignals(d.c15, d.atr, s, o.k)) {
        signals++
        const ready = prepareV1(d, s, sig, o.b)
        const decKey = eventKey(sig.T, 1)
        const key = isWhy(ready) ? decKey : eventKey(ready.entryTime, 1)
        add({
          key,
          run: () => {
            const note = (result: string) =>
              outcomes.push({ market: d.id, leg: 'v1', T: sig.T, side: side(sig.long), result })
            if (st.ownedUntil > decKey) return note('flip owns the market')
            if (st.open && st.open.endKey >= decKey) return note('trade open')
            if (st.opened >= V1.maxPerDay) return note('2 trades today')
            if (isWhy(ready)) return note(ready.why)
            const t = openTrade('v1', sig.long, ready, key, {
              signalCandle: sig.time,
              one: sig.one,
              zero: sig.zero,
              T: sig.T,
              original: null,
            })
            if (typeof t === 'string') return note(t)
            st.opened++
            note('trade')
            if (o.flip && st.opened === 1 && t.why === 'stop' && !t.tp1Hit) startFlip(t)
          },
        })
      }
      return st
    })
    // Run both markets' actions in time order.
    for (;;) {
      let best = -1
      for (let n = 0; n < mk.length; n++) {
        const a = mk[n].actions[0]
        if (a && (best < 0 || a.key < mk[best].actions[0].key)) best = n
      }
      if (best < 0) break
      mk[best].actions.shift()!.run()
    }
  }
  acct.book(Infinity)
  return {
    options: { k: o.k, b: o.b, flip: o.flip, q: o.flip ? q : null, startMoney: acct.start },
    trades,
    outcomes,
    signals,
    endBalance: acct.balance,
    maxDrawdown: acct.maxDrawdown,
    maxOpenSeen: acct.maxOpenSeen,
    maxOpenRiskSeen: acct.maxOpenRiskSeen,
  }
}

// ── Luck checks (section 5) ───────────────────────────────────────────────

/** The trade's targets as distances from its fill, with their shares. */
function targetDists(t: LondonTrade): { d: number; share: number; why: ExitWhy }[] {
  if (t.tp2 == null) return [{ d: Math.abs(t.tp1 - t.E), share: 1, why: 'target' }]
  return [
    { d: Math.abs(t.tp1 - t.E), share: 0.5, why: 'tp1' },
    { d: Math.abs(t.tp2 - t.E), share: 0.5, why: 'tp2' },
  ]
}

/** One leg from bid p at minute index iE, with stop and targets at the given distances from its own fill. R. */
function legR(
  d: LondonData,
  t: LondonTrade,
  long: boolean,
  iE: number,
  p: number,
  deadline: { at: number; why: ExitWhy },
): number {
  const m = d.market
  const E = entryFill(m, long, p)
  const stop = long ? E - t.dist : E + t.dist
  const w = walkExits({
    m,
    m1: d.m1,
    from: t.leg === 'reverse' ? iE + 1 : iE,
    long,
    E,
    stop,
    targets: targetDists(t).map((x) => ({
      price: long ? E + x.d : E - x.d,
      share: x.share,
      why: x.why,
    })),
    deadline: deadline.at,
    deadlineWhy: deadline.why,
  })
  return w.pnl / riskPerUnit(m, E, stop, p)
}

/** Mirror: the same minute, the other way, same distances from its own fill, same exit rules and costs. */
export function mirrorR(t: LondonTrade, d: LondonData): number {
  const iE = firstAtOrAfter(d.m1, t.entryTime)
  return legR(d, t, !t.long, iE, t.p, { at: t.deadline, why: t.deadlineWhy })
}

/** Mirror z for a list of trades (directionTest in stats.ts). */
export function mirrorTest(trades: LondonTrade[], byId: Map<LondonMarketId, LondonData>) {
  const real = trades.map((t) => t.r)
  const mirror = trades.map((t) => mirrorR(t, byId.get(t.market)!))
  return { ...directionTest(real, mirror), mirrorTotal: mirror.reduce((a, x) => a + x, 0) }
}

/** One coin-flip draw: a 15-minute open from session start + 15 minutes to last entry, and a side. */
export function coinDraw(rnd: () => number, s: Session): { T: number; long: boolean } {
  const slots = (s.lastEntry - s.start) / M15
  const T = s.start + (1 + Math.floor(rnd() * slots)) * M15
  return { T, long: rnd() < 0.5 }
}

/**
 * One coin-flip run: every trade swapped for a random one on the same market
 * and day, a random 15-minute open from session start + 15 minutes to last
 * entry and a random side, with the trade's own stop and target distances and
 * exit rules. A draw in a news block, with under 90 minutes to its forced
 * close or with no 1-minute candle is drawn again (20 tries). Total R.
 */
export function coinRun(
  trades: LondonTrade[],
  byId: Map<LondonMarketId, LondonData>,
  seed: number,
): { total: number; missed: number } {
  const rnd = seeded(seed)
  let total = 0
  let missed = 0
  for (const t of trades) {
    const d = byId.get(t.market)!
    const s = sessionFor(Date.parse(t.day) / 1000)
    let done = false
    for (let tries = 0; tries < 20 && !done; tries++) {
      const { T, long } = coinDraw(rnd, s)
      if (inWindow(d.windows, T)) continue
      const fc = forcedCloseAt(d, s, T)
      if (fc.at - T < V1.minLife) continue
      const iE = entryMinute(d.m1, T)
      if (iE < 0) continue
      const limit = d.m1[iE].time + V1.reverseLimit
      const deadline: { at: number; why: ExitWhy } =
        t.leg === 'reverse' && limit <= fc.at ? { at: limit, why: 'limit' } : fc
      total += legR(d, t, long, iE, d.m1[iE].open, deadline)
      done = true
    }
    if (!done) missed++
  }
  return { total, missed }
}

/** The same trade with every cost scaled: same entry minute and levels, exits walked again. R. */
export function rescoreCosts(t: LondonTrade, d: LondonData, mult: number): number {
  const m = d.market
  const iE = firstAtOrAfter(d.m1, t.entryTime)
  const E = entryFill(m, t.long, t.p, mult)
  const targets: Target[] =
    t.tp2 == null
      ? [{ price: t.tp1, share: 1, why: 'target' }]
      : [
          { price: t.tp1, share: 0.5, why: 'tp1' },
          { price: t.tp2, share: 0.5, why: 'tp2' },
        ]
  const w = walkExits({
    m,
    m1: d.m1,
    from: t.leg === 'reverse' ? iE + 1 : iE,
    long: t.long,
    E,
    stop: t.stop,
    targets,
    deadline: t.deadline,
    deadlineWhy: t.deadlineWhy,
    mult,
  })
  return w.pnl / riskPerUnit(m, E, t.stop, t.p, mult)
}

// ── Counting (section 5) ──────────────────────────────────────────────────

export interface Summary {
  trades: number
  wins: number
  winRate: number
  totalR: number
  avgR: number
  profitFactor: number | null
  usd: number
  /** Average gain of a winning trade, in % of the balance at its entry. */
  avgWinPct: number | null
  avgLossPct: number | null
  longestLosingRun: number
  /** Share of trades that ended on the clock or before news (or the reverse time limit). */
  timeOrNewsShare: number
  withoutBest3R: number
}

export function summarize(ts: LondonTrade[]): Summary {
  const rs = ts.map((t) => t.r)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const wins = ts.filter((t) => t.r > 0)
  const losses = ts.filter((t) => t.r < 0)
  const lossR = -sum(losses.map((t) => t.r))
  let run = 0
  let longest = 0
  for (const t of [...ts].sort((a, b) => a.exitTime - b.exitTime || a.id - b.id)) {
    run = t.r < 0 ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  const best = [...rs].sort((a, b) => b - a)
  return {
    trades: ts.length,
    wins: wins.length,
    winRate: ts.length ? wins.length / ts.length : 0,
    totalR: sum(rs),
    avgR: ts.length ? sum(rs) / ts.length : 0,
    profitFactor: lossR > 0 ? sum(wins.map((t) => t.r)) / lossR : null,
    usd: sum(ts.map((t) => t.usd)),
    avgWinPct: wins.length ? sum(wins.map((t) => t.pct)) / wins.length : null,
    avgLossPct: losses.length ? sum(losses.map((t) => t.pct)) / losses.length : null,
    longestLosingRun: longest,
    timeOrNewsShare: ts.length
      ? ts.filter((t) => t.why === 'time' || t.why === 'news' || t.why === 'limit').length /
        ts.length
      : 0,
    withoutBest3R: sum(best.slice(3)),
  }
}

/** 95th percentile of the coin-flip totals (the 950th of 1,000 sorted). */
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]
}

/** The six pass lines of section 5. */
export function passLines(o: {
  trades: number
  endBalance: number
  start: number
  avgR: number
  profitFactor: number | null
  maxDrawdown: number
  totalR: number
  coinP95: number
  mirrorZ: number | null
}) {
  const lines = [
    { line: 1, text: 'at least 80 trades', ok: o.trades >= 80 },
    {
      line: 2,
      text: 'ends above $10,000 and averages at least +0.10R',
      ok: o.endBalance > o.start && o.avgR >= 0.1,
    },
    { line: 3, text: 'profit factor at least 1.20', ok: (o.profitFactor ?? 0) >= 1.2 },
    { line: 4, text: 'max drawdown at most 25%', ok: o.maxDrawdown <= 0.25 },
    { line: 5, text: 'total R above the coin flips 95th percentile', ok: o.totalR > o.coinP95 },
    { line: 6, text: 'mirror z at least 1.0', ok: (o.mirrorZ ?? -Infinity) >= 1 },
  ]
  const verdict =
    o.trades < 80
      ? 'no verdict'
      : lines.every((l) => l.ok)
        ? 'pass'
        : o.endBalance > o.start
          ? 'fail (made money, not proven)'
          : 'fail'
  return { lines, verdict }
}

/** "Flip beats plain" (section 5). */
export function flipBeatsPlain(o: {
  reverseTrades: number
  flipLegsR: number
  flipTotalR: number
  plainTotalR: number
  flipDrawdown: number
  plainDrawdown: number
}) {
  const checks = [
    { text: 'at least 30 reverse trades', ok: o.reverseTrades >= 30 },
    { text: 'flip legs alone above 0R', ok: o.flipLegsR > 0 },
    { text: 'v1-flip at least 3R above v1', ok: o.flipTotalR >= o.plainTotalR + 3 },
    { text: 'drawdown at most 5 points above v1', ok: o.flipDrawdown <= o.plainDrawdown + 0.05 },
  ]
  return { checks, beats: checks.every((c) => c.ok) }
}

// ── Picking a setting (section 4) ─────────────────────────────────────────

export interface PairRow {
  k: number
  b: number
  trades: number
  totalR: number
  maxDrawdown: number
}

/** Eligible: 100+ trades, drawdown 25% or less. Top total R; within 2R the most trades; then k = 2, then b = 0.5. */
export function pickPair(rows: PairRow[]): {
  k: number
  b: number
  qualified: boolean
  eligible: PairRow[]
} {
  const eligible = rows.filter(
    (r) => r.trades >= V1.minTradesToPick && r.maxDrawdown <= V1.maxDrawdownToPick,
  )
  if (!eligible.length) return { k: V1_DEFAULTS.k, b: V1_DEFAULTS.b, qualified: false, eligible }
  const top = Math.max(...eligible.map((r) => r.totalR))
  const close = eligible
    .filter((r) => top - r.totalR <= V1.pickWithinR)
    .sort((x, y) => y.trades - x.trades || x.k - y.k || x.b - y.b)
  return { k: close[0].k, b: close[0].b, qualified: true, eligible }
}

/** The higher total R of q = 0.5 and q = 1.0, counting all legs; within 2R, q = 0.5. */
export function pickQ(rows: { q: number; totalR: number }[]): number {
  const half = rows.find((r) => r.q === 0.5)
  const one = rows.find((r) => r.q === 1)
  if (!half || !one) return (half ?? one)?.q ?? V1_DEFAULTS.q
  return one.totalR - half.totalR > V1.pickWithinR ? 1 : 0.5
}

// ── Loader guard (section 10, design mode) ────────────────────────────────

/** Only <dir>/<MARKET>/<MARKET>_1m.csv.gz for GBPUSD or XAUUSD, never the clean or old folders. */
export function assertDesignFile(path: string, id: string) {
  if (/history-1m-24mo|history-old/.test(path))
    throw new Error(`design loader: refusing ${path} (clean or old history)`)
  if (!LONDON_MARKETS.includes(id as LondonMarketId))
    throw new Error(`design loader: v1 has no market ${id}`)
  if (!path.endsWith(`/${id}/${id}_1m.csv.gz`))
    throw new Error(`design loader: only the 1-minute file, not ${path}`)
}

/** The design year starts cold: no candle before 2025-11-11 00:00 UTC. */
export function assertDesignCandles(c: OHLCCandle[], path: string) {
  if (!c.length) throw new Error(`design loader: ${path} is empty`)
  if (c[0].time < DESIGN_START)
    throw new Error(`design loader: ${path} starts before 2025-11-11 00:00 UTC`)
}
