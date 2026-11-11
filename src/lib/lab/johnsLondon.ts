// John's London Strategy v1 and its variants, the official code for the spec
// ~/jvd-outputs/2026-11-11/london-strategy/SPEC.md (section numbers in the
// comments point there). Pure: candles and news in, signals, trades and scores
// out, no IO. The backtest runner is scripts/lab/london-v1.ts.
//
// In short (UTC unless it says London or New York): GBP/USD and gold,
// 15-minute candles built from 1-minute BID candles, 07:00 to 15:00 London for
// entries, flat by 16:30 London. After a big move (k ATRs inside 12 candles)
// the Fib is drawn with 1 at the last opposite candle and 0 at the end of the
// move. A closed candle that reaches 0.786 without passing 1 is the signal;
// the trade opens at the next 1-minute open. Stop past 1 by b ATRs (at least
// 10 round trips of costs, plan between 1.5R and 2.5R), half off at 0, the
// rest at -0.272. GBP/USD and gold are one dollar bet (2.8).
//
// Variants:
// - v1-flip (3): v1 plus "the ride", one trade with the big move while it
//   runs (stop at the move's 0.786 level, one quick target, 120 minutes at
//   most, closed when its own setup gives the Fib signal), then v1's Fib entry.
// - v1-NY (3A): its own account. The first break of the New York opening
//   range (with or without London's high and low), then v1's Fib entry on the
//   break's side.
// - thirds (3B): how a Fib entry is put on. A signal candle that already
//   closed our way goes in at once; otherwise by thirds at 0.786, 0.836 and
//   0.886 with one stop, plus one add to the full 2% at the first candle that
//   closes our way.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { seeded } from './control'
import { fibLevel, impulseAt } from './fib'
import { labMarket, slippageAt, spreadAt, type LabMarket } from './markets'
import { inWindow, newsWindows, nextWindowStart, type NewsEvent, type Window } from './news'
import { directionTest } from './stats'
import { DAY, HOUR, MIN, londonSummer, nyOffset, nySummer, utcWeekday } from './time'

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
  /** The ride's time limit (M2). */
  rideLimit: 120 * MIN,
  startMoney: 10_000,
  /** Within this many R the tie-breaks of section 4 apply. */
  pickWithinR: 2,
  minTradesToPick: 100,
  maxDrawdownToPick: 0.25,
} as const

/** The pre-registered settings (section 4). Defaults (tie winners) first. */
export const V1_GRID = { k: [2, 3], b: [0.5, 1.0] } as const
export const V1_DEFAULTS = { k: 2, b: 0.5 } as const
/** v1-flip: ext = the ride's target past 0 as a share of the move; g = how big the move must be. */
export const FLIP_GRID = { ext: [0.272, 0.702], g: [1.5, 2.5] } as const
/** v1-NY: c = chart size in minutes; w = London rule (the break must also close past London's high or low). */
export const NY_GRID = { c: [15, 5], w: [true, false] } as const
export const NY_DEFAULTS = { c: 15, w: true } as const

/** v1-NY's fixed numbers (3A), times after the New York open (08:00 New York). */
export const NY = {
  range: 30 * MIN,
  lastEntry: 2 * HOUR,
  timeExit: 3.5 * HOUR,
  rangeMinutes: 20,
  targetR: 1.5,
  chase: 0.1,
  /** London's lines report: candles that start before 11:00 New York. */
  linesUntil: 3 * HOUR,
} as const

/** Thirds (3B): the rungs, the start, middle and end of John's zone. */
export const THIRDS = { rungs: [0.786, 0.836, 0.886] } as const

/**
 * John's race hours (section 6), as a backstop: new entries only from
 * 02:00 to 12:30 AST, flat at 12:45 AST. AST = UTC - 4, so 06:00, 16:30 and
 * 16:45 UTC of the trading day. Every v1 and v1-NY moment is inside them.
 */
export const RACE = { entryFrom: 6 * HOUR, entryTo: 16.5 * HOUR, flat: 16.75 * HOUR } as const

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

// ── Clock (2.1, N1) ───────────────────────────────────────────────────────

export interface Session {
  day: number
  summer: boolean
  /** First moment a setup candle may start. */
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

export interface NySession extends Session {
  /** 08:30 New York: the range is fixed, breaks may start. */
  rangeEnd: number
  /** 07:00 London: London's high and low start here. */
  londonStart: number
}

/** v1-NY's clock (N1): open 08:00, range to 08:30, last entry 10:00, time exit 11:30 New York. Summer = US summer time. */
export function nySessionFor(day: number): NySession {
  const noon = day + 12 * HOUR
  const open = day + (8 - nyOffset(noon)) * HOUR
  return {
    day,
    summer: nySummer(noon),
    start: open,
    rangeEnd: open + NY.range,
    lastEntry: open + NY.lastEntry,
    timeExit: open + NY.timeExit,
    londonStart: sessionFor(day).start,
  }
}

export const isTradingDay = (day: number) => {
  const w = utcWeekday(day)
  return w >= 1 && w <= 5
}

/** John's race hours: a new entry may fill from 02:00 to 12:30 AST (06:00 to 16:30 UTC). */
export const inRaceHours = (s: Session, t: number) =>
  t >= s.day + RACE.entryFrom && t <= s.day + RACE.entryTo

// ── Candles ───────────────────────────────────────────────────────────────

/** Candles of `sec` seconds (starting on whole multiples) from 1-minute candles. */
export function resample(m1: OHLCCandle[], sec: number): OHLCCandle[] {
  const out: OHLCCandle[] = []
  for (const b of m1) {
    const t = Math.floor(b.time / sec) * sec
    const c = out[out.length - 1]
    if (c && c.time === t) {
      if (b.high > c.high) c.high = b.high
      if (b.low < c.low) c.low = b.low
      c.close = b.close
    } else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close })
  }
  return out
}

/** 15-minute candles (:00, :15, :30, :45) from 1-minute candles. */
export const resample15 = (m1: OHLCCandle[]) => resample(m1, M15)

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

/** A closed candle that closes our way (T1): below its open for a sell, above for a buy. */
export const turnCandle = (b: OHLCCandle, long: boolean) =>
  long ? b.close > b.open : b.close < b.open

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

/** A chart of `sec`-second candles with its 14-candle ATR. */
export interface Chart {
  sec: number
  c: OHLCCandle[]
  atr: number[]
}

const chartCache = new WeakMap<OHLCCandle[], Map<number, Chart>>()

/** The market's chart of `sec` seconds: its own 15-minute chart, or one built from the 1-minute candles (N2). */
export function chartOf(d: LondonData, sec: number): Chart {
  if (sec === M15) return { sec, c: d.c15, atr: d.atr }
  let m = chartCache.get(d.m1)
  if (!m) chartCache.set(d.m1, (m = new Map()))
  let ch = m.get(sec)
  if (!ch) {
    const c = resample(d.m1, sec)
    ch = { sec, c, atr: atrSeries(c, V1.atrPeriod) }
    m.set(sec, ch)
  }
  return ch
}

/** The forced close for a trade at `t`: the time exit, or 30 minutes before the next red event if earlier. 12:45 AST is the backstop. */
export function forcedCloseAt(
  d: LondonData,
  s: Session,
  t: number,
): { at: number; why: 'time' | 'news' | 'race' } {
  const n = nextWindowStart(d.windows, t)
  const flat = s.day + RACE.flat
  const end =
    s.timeExit <= flat
      ? { at: s.timeExit, why: 'time' as const }
      : { at: flat, why: 'race' as const }
  return n < end.at ? { at: n, why: 'news' } : end
}

/** Check 3: of the 20 fifteen-minute slots before T (T rounded down to a 15-minute mark), at least 14 hold a candle with high above low. */
export function dataAlive(d: LondonData, T: number): boolean {
  const t0 = Math.floor(T / M15) * M15
  let n = 0
  for (let k = 1; k <= V1.aliveSlots; k++) {
    const i = d.byTime.get(t0 - k * M15)
    if (i != null && d.c15[i].high > d.c15[i].low) n++
  }
  return n >= V1.aliveMin
}

// ── Setups and signals (2.3) ──────────────────────────────────────────────

export interface LondonSignal {
  day: number
  /** Index of the signal candle in its chart. */
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
  /** Which setup of the day gave it (index into the day's setups). */
  setup: number
}

/** One setup of a day, as the tracker saw it. */
export interface SetupTrack {
  id: number
  long: boolean
  armedIdx: number
  oneIdx: number
  /**
   * Its move candles (M1): the candle that armed it, and every later candle
   * that moved its 0 and left the setup alive, with 1, 0 and ATR as they
   * stood at that candle's close.
   */
  moves: { j: number; one: number; zero: number; atr: number }[]
  /** The candle of its Fib signal (step A2), whether or not the signal was taken. */
  signalIdx: number | null
}

interface Armed {
  id: number
  one: number
  zero: number
  oneIdx: number
  armedIdx: number
}

/**
 * Both trackers over one day. Uses only candles that start at or after
 * session start and close by last entry, and at candle j reads nothing after
 * j (the impulse test looks back, ATR[j] ends at j). Returns the signals
 * (after the same-candle tie-break) and every setup with its move candles.
 */
export function trackDay(
  c: OHLCCandle[],
  atr: number[],
  s: { day: number; start: number; lastEntry: number },
  k: number,
  sec = M15,
): { signals: LondonSignal[]; setups: SetupTrack[] } {
  const out: LondonSignal[] = []
  const setups: SetupTrack[] = []
  const tr: Record<'down' | 'up', Armed | null> = { down: null, up: null }
  for (let j = firstAtOrAfter(c, s.start); j < c.length; j++) {
    const b = c[j]
    if (b.time + sec > s.lastEntry) break
    const fired: Partial<Record<'down' | 'up', LondonSignal>> = {}
    for (const dir of ['down', 'up'] as const) {
      const long = dir === 'up'
      const st = tr[dir]
      // A: a setup armed on an earlier candle.
      if (st && j > st.armedIdx) {
        let signal = false
        let moved = false
        if (long ? b.high > st.zero : b.low < st.zero) {
          st.zero = long ? b.high : b.low // A1: 0 follows the move, no signal
          moved = true
        } else {
          const level = fibLevel(st.one, st.zero, V1.zone)
          signal = long ? b.low <= level && b.low >= st.one : b.high >= level && b.high <= st.one
          if (signal) {
            setups[st.id].signalIdx = j
            fired[dir] = {
              day: s.day,
              i: j,
              time: b.time,
              T: b.time + sec,
              long,
              one: st.one,
              zero: st.zero,
              oneIdx: st.oneIdx,
              armedIdx: st.armedIdx,
              level,
              atr: atr[j],
              setup: st.id,
            }
          }
        }
        // A3, always.
        const past1 = long ? b.low < st.one : b.high > st.one
        if (signal || past1 || j - st.armedIdx >= V1.setupLife) tr[dir] = null
        else if (moved) setups[st.id].moves.push({ j, one: st.one, zero: st.zero, atr: atr[j] })
      }
      // B: an empty tracker runs the impulse test on this candle.
      if (!tr[dir]) {
        const imp = impulseAt(c, atr, j, dir, k, V1.impulseBars, 'candle')
        if (imp) {
          const id = setups.length
          tr[dir] = { id, one: imp.one, zero: imp.zero, oneIdx: imp.oneIdx, armedIdx: j }
          setups.push({
            id,
            long,
            armedIdx: j,
            oneIdx: imp.oneIdx,
            moves: [{ j, one: imp.one, zero: imp.zero, atr: atr[j] }],
            signalIdx: null,
          })
        }
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
  return { signals: out, setups }
}

/** Every signal of one day, both trackers (2.3). */
export const daySignals = (
  c: OHLCCandle[],
  atr: number[],
  s: { day: number; start: number; lastEntry: number },
  k: number,
  sec = M15,
): LondonSignal[] => trackDay(c, atr, s, k, sec).signals

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

export type ExitWhy =
  | 'stop'
  | 'tp1'
  | 'tp2'
  | 'target'
  | 'time'
  | 'news'
  | 'race'
  | 'limit'
  | 'fib'
  | 'end'

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

/**
 * The exit walk of a trade put on in parts (3B, T7): every part shares the
 * forced close, the stop (which may move once, from a given minute on) and
 * the two targets. TP1 closes half of the units open in that minute, TP2 the
 * rest. A part enters at the open of its 1-minute candle, after a forced
 * close at that open and before anything inside the minute. Fills are per
 * part, as shares of that part's units.
 */
export function walkParts(o: {
  m: LabMarket
  m1: OHLCCandle[]
  long: boolean
  parts: { from: number; E: number }[]
  /** The stop from each time on; the first one must start at or before the first part. */
  stops: { from: number; price: number }[]
  tp1: number
  tp2: number
  deadline: number
  deadlineWhy: ExitWhy
  mult?: number
}): { fills: Fill[][]; pnl: number[]; exitTime: number; why: ExitWhy; tp1Hit: boolean } {
  const { m, m1, long, parts } = o
  const mult = o.mult ?? 1
  const fee = m.fee * mult
  const dir = long ? 1 : -1
  const fills: Fill[][] = parts.map(() => [])
  const left = parts.map(() => 0)
  let tp1Done = false
  let done = false
  const closeAll = (b: OHLCCandle, price: number, why: ExitWhy, atOpen: boolean, half = false) => {
    parts.forEach((_, n) => {
      if (left[n] <= 1e-12) return
      const share = half ? 0.5 * left[n] : left[n]
      fills[n].push({ time: b.time, atOpen, share, price, why })
      left[n] -= share
    })
  }
  const start = Math.min(...parts.map((p) => p.from))
  for (let i = start; i < m1.length && !done; i++) {
    const b = m1[i]
    if (b.time >= o.deadline) {
      closeAll(b, forcedFill(m, long, b.open, mult), o.deadlineWhy, true)
      done = true
      break
    }
    parts.forEach((p, n) => {
      if (p.from === i) left[n] = 1
    })
    if (!left.some((x) => x > 1e-12)) continue
    let stop = o.stops[0].price
    for (const s of o.stops) if (s.from <= b.time) stop = s.price
    if (stopHit(m, long, b, stop, mult)) {
      closeAll(b, stopFill(m, long, b, stop, mult), 'stop', false)
      done = true
      break
    }
    if (!tp1Done && targetHit(m, long, b, o.tp1, mult)) {
      closeAll(b, o.tp1, 'tp1', false, true)
      tp1Done = true
    }
    if (tp1Done && targetHit(m, long, b, o.tp2, mult)) {
      closeAll(b, o.tp2, 'tp2', false)
      done = true
    }
  }
  if (!done && m1.length) {
    const last = m1[m1.length - 1]
    closeAll(last, forcedFill(m, long, last.close, mult), 'end', false)
  }
  const pnl = parts.map((p, n) =>
    fills[n].reduce((a, f) => a + f.share * (dir * (f.price - p.E) - fee * (p.E + f.price)), 0),
  )
  const all = fills.flat().sort((a, b) => a.time - b.time)
  const lastFill = all[all.length - 1]
  return {
    fills,
    pnl,
    exitTime: lastFill?.time ?? NaN,
    why: lastFill?.why ?? 'end',
    tp1Hit: all.some((f) => f.why === 'tp1'),
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

/** The dollar side of a trade (2.8, one dollar bet): GBP/USD long and gold long are "USD down". */
export const dollarSide = (id: LondonMarketId, long: boolean) =>
  exposures(id, long).find((e) => e.startsWith('USD'))!

/** Event order inside one minute: forced closes at the open, entries at the open, then fills inside. */
export const eventKey = (t: number, order: 0 | 1 | 2 | 3) => t * 4 + order
const fillKey = (f: Fill) => eventKey(f.time, f.atOpen ? 0 : 2)

interface PartPos {
  E: number
  units: number
  unitsOpen: number
  rpu: number
  done: boolean
}

/** An open trade in the account: one part, or several for a thirds trade. */
export interface Pos {
  market: LondonMarketId
  long: boolean
  lev: number
  fee: number
  parts: PartPos[]
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
  /** Share of the 2% this part risks (a third: 1/3). */
  share?: number
  /** The 1% floor after a margin cut (off for a third). */
  floor?: boolean
}

export class LondonAccount {
  balance: number
  peak: number
  maxDrawdown = 0
  maxOpenSeen = 0
  maxOpenRiskSeen = 0
  private open: Pos[] = []
  private pending: {
    key: number
    seq: number
    pos: Pos
    part: number
    fill: Fill
    last: boolean
  }[] = []
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
      const part = pos.parts[p.part]
      const units = part.units * fill.share
      const dir = pos.long ? 1 : -1
      this.balance += units * (dir * (fill.price - part.E) - pos.fee * (part.E + fill.price))
      part.unitsOpen -= units
      if (p.last) {
        part.done = true
        if (pos.parts.every((x) => x.done)) this.open = this.open.filter((x) => x !== pos)
      }
      if (this.balance > this.peak) this.peak = this.balance
      const dd = (this.peak - this.balance) / this.peak
      if (dd > this.maxDrawdown) this.maxDrawdown = dd
    }
  }

  openCount() {
    return this.open.length
  }

  isOpen(pos: Pos) {
    return this.open.includes(pos)
  }

  private posRisk(x: Pos) {
    return x.parts.reduce((a, p) => a + (p.done ? 0 : p.unitsOpen * p.rpu), 0)
  }

  openRisk() {
    return this.open.reduce((a, x) => a + this.posRisk(x), 0)
  }

  /** The open risk of one trade (all its open parts). */
  tradeRisk(pos: Pos) {
    return this.posRisk(pos)
  }

  private marginUsed() {
    return this.open.reduce(
      (a, x) => a + x.parts.reduce((s, p) => s + (p.done ? 0 : (p.unitsOpen * p.E) / x.lev), 0),
      0,
    )
  }

  /** Every 2.8 limit on a new trade, after booking up to its key. Mutates nothing else. */
  private sizeNew(
    r: OpenRequest,
  ): { units: number; risk: number; bal: number; cut: boolean; ex: string[] } | { why: string } {
    this.book(r.key)
    const bal = this.balance
    if (this.open.length >= V1.maxOpen) return { why: 'account: 5 trades open' }
    const ex = exposures(r.market, r.long)
    const usd = dollarSide(r.market, r.long)
    const other = usd === 'USD+' ? 'USD-' : 'USD+'
    if (this.open.some((x) => x.exposures.includes(other)))
      return { why: 'account: dollar bet (a trade on the other dollar side is open)' }
    for (const e of ex)
      if (this.open.filter((x) => x.exposures.includes(e)).length >= V1.sameCurrencyMax)
        return { why: `account: 2 trades already on ${e}` }
    let units = (((bal * V1.riskPct) / 100) * (r.share ?? 1)) / r.rpu
    const maxUnits = (Math.max(0, bal - this.marginUsed()) * r.leverage) / r.E
    let cut = false
    if (units > maxUnits) {
      units = maxUnits
      cut = true
      if ((r.floor ?? true) && units * r.rpu < (bal * V1.minRiskPct) / 100)
        return { why: 'account: margin cut under 1%' }
      if (!(units > 0)) return { why: 'account: no margin left' }
    }
    const risk = units * r.rpu
    if (this.openRisk() + risk > (bal * V1.maxOpenRiskPct) / 100 + 1e-9)
      return { why: 'account: open risk over 10%' }
    return { units, risk, bal, cut, ex }
  }

  /** Would 2.8 let this trade open (check 7)? Books up to its key, opens nothing. */
  canOpen(r: OpenRequest): { why: string } | null {
    const s = this.sizeNew(r)
    return isWhy(s) ? s : null
  }

  /** Size and open a trade, or say which limit stops it. Fills are booked later at their own times. */
  tryOpen(
    r: OpenRequest,
  ): { units: number; riskUsd: number; balance: number; cut: boolean; pos: Pos } | { why: string } {
    const s = this.sizeNew(r)
    if (isWhy(s)) return s
    const pos: Pos = {
      market: r.market,
      long: r.long,
      lev: r.leverage,
      fee: r.fee,
      parts: [{ E: r.E, units: s.units, unitsOpen: s.units, rpu: r.rpu, done: false }],
      exposures: s.ex,
    }
    this.open.push(pos)
    this.addFills(pos, 0, r.fills, -Infinity)
    this.maxOpenSeen = Math.max(this.maxOpenSeen, this.open.length)
    this.maxOpenRiskSeen = Math.max(this.maxOpenRiskSeen, this.openRisk() / s.bal)
    return { units: s.units, riskUsd: s.risk, balance: s.bal, cut: s.cut, pos }
  }

  /**
   * A later part of an open trade (a third or the add, 3B). `want`: 'third'
   * risks a third of 2% of the balance; 'rest' brings the trade to 2%.
   * Either way the trade's open risk stays at most 2% of the balance, and
   * the margin and the 10% open risk must fit (no 1% floor). `newRpus` are
   * the open parts' risk per unit to a new stop, applied first (the add);
   * they are put back if the part does not open.
   */
  addPart(
    pos: Pos,
    r: { E: number; rpu: number; key: number; want: 'third' | 'rest'; newRpus?: number[] },
  ):
    | { units: number; riskUsd: number; balance: number; tradeRisk: number; part: number }
    | { why: string } {
    this.book(r.key)
    if (!this.isOpen(pos)) return { why: 'trade already closed' }
    const bal = this.balance
    const old = pos.parts.map((p) => p.rpu)
    if (r.newRpus) r.newRpus.forEach((x, n) => (pos.parts[n].rpu = x))
    const fail = (why: string) => {
      old.forEach((x, n) => (pos.parts[n].rpu = x))
      return { why }
    }
    const full = (bal * V1.riskPct) / 100
    const room = full - this.posRisk(pos)
    const want = r.want === 'third' ? full / 3 : room
    let risk = Math.min(want, room)
    if (!(risk > 1e-9)) return fail('trade already at 2%')
    let units = risk / r.rpu
    const maxUnits = (Math.max(0, bal - this.marginUsed()) * pos.lev) / r.E
    if (units > maxUnits) units = maxUnits
    if (!(units > 0)) return fail('account: no margin left')
    risk = units * r.rpu
    if (this.openRisk() + risk > (bal * V1.maxOpenRiskPct) / 100 + 1e-9)
      return fail('account: open risk over 10%')
    pos.parts.push({ E: r.E, units, unitsOpen: units, rpu: r.rpu, done: false })
    this.maxOpenRiskSeen = Math.max(this.maxOpenRiskSeen, this.openRisk() / bal)
    return {
      units,
      riskUsd: risk,
      balance: bal,
      tradeRisk: this.posRisk(pos),
      part: pos.parts.length - 1,
    }
  }

  /** Replace a part's fills from `fromKey` on (the trade was walked again after a new part or a stop move). */
  replaceFills(pos: Pos, part: number, fills: Fill[], fromKey: number) {
    this.pending = this.pending.filter(
      (x) => !(x.pos === pos && x.part === part && x.key >= fromKey),
    )
    this.addFills(pos, part, fills, fromKey)
  }

  private addFills(pos: Pos, part: number, fills: Fill[], fromKey: number) {
    fills.forEach((f, n) => {
      const key = fillKey(f)
      if (key < fromKey) return
      this.pending.push({ key, seq: this.seq++, pos, part, fill: f, last: n === fills.length - 1 })
    })
  }
}

// ── Trades and runs ───────────────────────────────────────────────────────

/** fib = v1's Fib entry; ride = v1-flip's ride; break = v1-NY's break trade; thirds = a Fib entry put on by thirds. */
export type Kind = 'fib' | 'ride' | 'break' | 'thirds'

/** One part of a thirds trade (3B). */
export interface ThirdsPart {
  /** 1, 2 or 3 for the rungs, 4 for the add. */
  rung: 1 | 2 | 3 | 4
  /** Start of the candle whose close put it on. */
  candle: number
  entryTime: number
  p: number
  E: number
  /** The trade's stop when this part opened. */
  stopAtEntry: number
  units: number
  /** This part's risk at entry, to stopAtEntry. */
  riskUsd: number
  /** The whole trade's open risk right after this part opened (never above 2%). */
  tradeRiskAfter: number
  balanceAtEntry: number
  fills: Fill[]
  usd: number
}

export interface LondonTrade {
  id: number
  strategy: 'v1' | 'ny'
  market: LondonMarketId
  kind: Kind
  side: 'BUY' | 'SELL'
  long: boolean
  day: string
  /** UK summer for v1, US summer for v1-NY. */
  summer: boolean
  /** Chart size of the signal candle, in seconds. */
  chartSec: number
  /** Signal candle start (Fib entry, thirds), move candle (ride), break candle (break). */
  signalCandle: number
  /** Fib 1 and 0 at the signal (a break trade: the range high and low). */
  one: number
  zero: number
  /** Setup index of the day (Fib entry, ride, thirds), null for a break. */
  setup: number | null
  /** Thirds run: the signal candle already closed our way, so it went in at once. */
  confident?: boolean
  /** Order time (the signal candle's close). */
  T: number
  entryTime: number
  /** Bid reference of the fill (first part for thirds). */
  p: number
  E: number
  rawStop: number
  /** Final stop (thirds: after the add, if any). */
  stop: number
  dist: number
  tp1: number
  /** null for a trade with one target (ride, break). */
  tp2: number | null
  planRR: number
  deadline: number
  deadlineWhy: ExitWhy
  rpu: number
  units: number
  /** Risk at entry (thirds: 2% of the balance at its first entry, the R base). */
  riskUsd: number
  balanceAtEntry: number
  /** Fills (thirds: every part's, shares of that part's units). */
  fills: Fill[]
  exitTime: number
  why: ExitWhy
  tp1Hit: boolean
  r: number
  usd: number
  /** Net dollars as a share of the balance at entry, in %. */
  pct: number
  parts?: ThirdsPart[]
  stopMove?: { time: number; from: number; to: number } | null
}

export interface Outcome {
  market: LondonMarketId
  kind: Kind
  T: number
  side: 'BUY' | 'SELL'
  result: string
}

export interface ThirdsStats {
  /** v1 signals that passed every all-at-once check. */
  taken: number
  confident: number
  ladders: number
  /** Ladders where at least one part opened (thirds trades). */
  ladderTrades: number
  thirdsOpened: [number, number, number]
  addsTried: number
  addsOpened: number
  ends: Record<string, number>
  /** Ladders that ended because price traded past 1 before any turn candle after the signal. */
  pastOneBeforeTurn: number
}

export interface LinesCount {
  breaks: number
  rejections: number
  untouched: number
}

export interface RunResult {
  strategy: 'v1' | 'ny'
  options: Record<string, number | boolean | string>
  trades: LondonTrade[]
  /** Every signal and step, with what came of it. */
  outcomes: Outcome[]
  signals: number
  rideSignals: number
  breaks: number
  endBalance: number
  maxDrawdown: number
  maxOpenSeen: number
  maxOpenRiskSeen: number
  thirds?: ThirdsStats
  /** v1-NY: London's lines (N8), per market and line. */
  lines?: Record<string, { high: LinesCount; low: LinesCount }>
}

export interface Ready {
  entryIdx: number
  entryTime: number
  p: number
  E: number
  plan: Plan
  deadline: { at: number; why: ExitWhy }
  walk: Walk
}

/** Checks 2 to 4 of 2.4 (and the race hours) at order time T. */
function entryChecks(
  d: LondonData,
  s: Session,
  T: number,
): { iE: number; p: number; fc: { at: number; why: ExitWhy } } | { why: string } {
  if (inWindow(d.windows, T)) return { why: 'news block' }
  const fc = forcedCloseAt(d, s, T)
  if (fc.at - T < V1.minLife) return { why: 'under 90 minutes to the forced close' }
  if (!dataAlive(d, T)) return { why: 'thin data' }
  const iE = entryMinute(d.m1, T)
  if (iE < 0) return { why: 'no 1-minute candle' }
  if (!inRaceHours(s, d.m1[iE].time)) return { why: 'outside race hours' }
  return { iE, p: d.m1[iE].open, fc }
}

/** Checks 2 to 6 of 2.4 and the exit walk for a v1 signal on a chart (default: the 15-minute one). All from data, none from the account. */
export function prepareV1(
  d: LondonData,
  s: Session,
  sig: LondonSignal,
  b: number,
  chart?: Chart,
): Ready | { why: string } {
  const m = d.market
  const T = sig.T
  const ec = entryChecks(d, s, T)
  if (isWhy(ec)) return ec
  const { iE, p, fc } = ec
  const E = entryFill(m, sig.long, p)
  const rawStop = sig.long ? sig.one - b * sig.atr : sig.one + b * sig.atr
  const tp1 = sig.zero
  const tp2 = fibLevel(sig.one, sig.zero, V1.tp2Level)
  const plan = planFrom(m, sig.long, E, p, rawStop, tp1, tp2)
  if (isWhy(plan)) return plan
  if (plan.rr < V1.rrMin) return { why: 'plan under 1.5R' }
  const close = (chart?.c ?? d.c15)[sig.i].close
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

// ── v1-flip: the ride (section 3) ─────────────────────────────────────────

export interface RideSignal {
  setup: number
  /** The move candle. */
  i: number
  time: number
  T: number
  long: boolean
  one: number
  zero: number
  /** L, the 0.786 level of the move at the signal: the ride's stop. */
  level: number
  atr: number
  /** v1's plan at a fill exactly at L, before the 2.5R cap (M1 item 3). */
  size: number
}

/** M1 item 3: v1's plan for a fill exactly at the 0.786 level, without the 2.5R cap. */
export function rideSize(
  m: LabMarket,
  long: boolean,
  one: number,
  zero: number,
  atr: number,
  b: number,
): { L: number; size: number } {
  const L = fibLevel(one, zero, V1.zone)
  const tp2 = fibLevel(one, zero, V1.tp2Level)
  const rawStop = long ? one - b * atr : one + b * atr
  const dist = Math.max(long ? L - rawStop : rawStop - L, V1.costFloorX * roundTrip(m, L))
  const reward = 0.5 * Math.abs(L - zero) + 0.5 * Math.abs(L - tp2)
  return { L, size: reward / dist }
}

/**
 * M1: each setup's first move candle that closed with the move and passes
 * the size test. One ride signal per setup at most. Everything is known at
 * the close of the move candle.
 */
export function rideSignals(
  m: LabMarket,
  c: OHLCCandle[],
  setups: SetupTrack[],
  b: number,
  g: number,
  sec = M15,
): RideSignal[] {
  const out: RideSignal[] = []
  for (const st of setups)
    for (const mv of st.moves) {
      const x = c[mv.j]
      if (!turnCandle(x, st.long)) continue
      const { L, size } = rideSize(m, st.long, mv.one, mv.zero, mv.atr, b)
      if (!(size >= g)) continue
      out.push({
        setup: st.id,
        i: mv.j,
        time: x.time,
        T: x.time + sec,
        long: st.long,
        one: mv.one,
        zero: mv.zero,
        level: L,
        atr: mv.atr,
        size,
      })
      break
    }
  return out.sort((a, b2) => a.i - b2.i || a.setup - b2.setup)
}

/**
 * M2 and M3: the ride trade, from data only. `fibT` is the close of the
 * candle on which the ride's own setup gives its Fib signal (null if it
 * never does): the ride closes at the first 1-minute open at or after it.
 */
export function prepareRide(
  d: LondonData,
  s: Session,
  r: RideSignal,
  ext: number,
  fibT: number | null,
): Ready | { why: string } {
  const m = d.market
  const long = r.long
  const ec = entryChecks(d, s, r.T)
  if (isWhy(ec)) return ec
  const { iE, p, fc } = ec
  const E = entryFill(m, long, p)
  const L = r.level
  const raw = long ? E - L : L - E
  if (!(raw > 0)) return { why: 'stop not on the losing side' }
  const floor = V1.costFloorX * roundTrip(m, p)
  const dist = Math.max(raw, floor)
  const target = fibLevel(r.one, r.zero, -ext)
  const reward = long ? target - E : E - target
  if (!(reward > 0)) return { why: 'target not on the winning side' }
  // Check 6 with the ride's own stop and target, worked out the same way at the move candle's close.
  const close = d.c15[r.i].close
  const Eref = long ? close + spreadAt(m, close) : close
  const rawRef = long ? Eref - L : L - Eref
  const rewardRef = long ? target - Eref : Eref - target
  if (!(rawRef > 0) || !(rewardRef > 0)) return { why: 'no chase: no plan at the signal close' }
  const distRef = Math.max(rawRef, V1.costFloorX * roundTrip(m, close))
  if (reward < V1.noChase * rewardRef || reward / dist < V1.noChase * (rewardRef / distRef))
    return { why: 'no chase' }
  const entryTime = d.m1[iE].time
  // M3: the earliest of the forced close, the time limit and the setup's Fib signal close.
  let deadline: { at: number; why: ExitWhy } = fc
  if (entryTime + V1.rideLimit < deadline.at)
    deadline = { at: entryTime + V1.rideLimit, why: 'limit' }
  if (fibT != null && fibT < deadline.at) deadline = { at: fibT, why: 'fib' }
  const stop = long ? E - dist : E + dist
  const walk = walkExits({
    m,
    m1: d.m1,
    from: iE,
    long,
    E,
    stop,
    targets: [{ price: target, share: 1, why: 'target' }],
    deadline: deadline.at,
    deadlineWhy: deadline.why,
  })
  const plan: Plan = {
    rawStop: L,
    rawDist: raw,
    dist,
    stop,
    tp1: target,
    tp2: target,
    reward,
    rr: reward / dist,
    floored: floor > raw,
    capped: false,
  }
  return { entryIdx: iE, entryTime, p, E, plan, deadline, walk }
}

// ── v1-NY (section 3A) ────────────────────────────────────────────────────

export interface NyLevels {
  /** London high and low: 07:00 London to 08:00 New York. */
  LH: number
  LL: number
  /** Opening range high and low: 08:00 to 08:30 New York. */
  RH: number
  RL: number
  rangeMinutes: number
  londonMinutes: number
}

function hiLo(m1: OHLCCandle[], from: number, to: number) {
  let hi = -Infinity
  let lo = Infinity
  let n = 0
  for (let i = firstAtOrAfter(m1, from); i < m1.length && m1[i].time < to; i++) {
    if (m1[i].high > hi) hi = m1[i].high
    if (m1[i].low < lo) lo = m1[i].low
    n++
  }
  return { hi, lo, n }
}

/** N3: the four levels from 1-minute candles, fixed at 08:30 New York. Reads nothing at or after 08:30. Null without 20 range minutes and one London minute. */
export function nyLevels(m1: OHLCCandle[], s: NySession): NyLevels | null {
  const ldn = hiLo(m1, s.londonStart, s.start)
  const or = hiLo(m1, s.start, s.rangeEnd)
  if (or.n < NY.rangeMinutes || ldn.n < 1) return null
  return { LH: ldn.hi, LL: ldn.lo, RH: or.hi, RL: or.lo, rangeMinutes: or.n, londonMinutes: ldn.n }
}

/** N4: the break lines. w = on: the outer of the range and London's high or low. */
export const breakLines = (lv: NyLevels, w: boolean) => ({
  BH: w ? Math.max(lv.RH, lv.LH) : lv.RH,
  BL: w ? Math.min(lv.RL, lv.LL) : lv.RL,
})

export interface NyBreak {
  i: number
  time: number
  T: number
  long: boolean
  BH: number
  BL: number
}

/** N4: the first closed candle from 08:30 New York (closing by last entry) that closes above BH or below BL. */
export function nyBreak(ch: Chart, s: NySession, lv: NyLevels, w: boolean): NyBreak | null {
  const { BH, BL } = breakLines(lv, w)
  for (let j = firstAtOrAfter(ch.c, s.rangeEnd); j < ch.c.length; j++) {
    const b = ch.c[j]
    if (b.time + ch.sec > s.lastEntry) break
    if (b.close > BH || b.close < BL)
      return { i: j, time: b.time, T: b.time + ch.sec, long: b.close > BH, BH, BL }
  }
  return null
}

/** N5: the break trade, from data only. */
export function prepareBreak(
  d: LondonData,
  s: NySession,
  ch: Chart,
  brk: NyBreak,
  lv: NyLevels,
  b: number,
): Ready | { why: string } {
  const m = d.market
  const long = brk.long
  const ec = entryChecks(d, s, brk.T)
  if (isWhy(ec)) return ec
  const { iE, p, fc } = ec
  const E = entryFill(m, long, p)
  const atr = ch.atr[brk.i]
  const rawStop = long ? lv.RL - b * atr : lv.RH + b * atr
  const raw = long ? E - rawStop : rawStop - E
  if (!(raw > 0)) return { why: 'stop not on the losing side' }
  const floor = V1.costFloorX * roundTrip(m, p)
  const dist = Math.max(raw, floor)
  const close = ch.c[brk.i].close
  const worse = long ? E - (close + spreadAt(m, close)) : close - E
  if (worse > NY.chase * dist) return { why: 'no chase' }
  const stop = long ? E - dist : E + dist
  const target = long ? E + NY.targetR * dist : E - NY.targetR * dist
  const walk = walkExits({
    m,
    m1: d.m1,
    from: iE,
    long,
    E,
    stop,
    targets: [{ price: target, share: 1, why: 'target' }],
    deadline: fc.at,
    deadlineWhy: fc.why,
  })
  const plan: Plan = {
    rawStop,
    rawDist: raw,
    dist,
    stop,
    tp1: target,
    tp2: target,
    reward: NY.targetR * dist,
    rr: NY.targetR,
    floored: floor > raw,
    capped: false,
  }
  return { entryIdx: iE, entryTime: d.m1[iE].time, p, E, plan, deadline: fc, walk }
}

/**
 * N8 report: for London's high and low, the first candle from 08:00 to
 * 11:00 New York that trades past the line. A close past it is a break, a
 * close back inside a rejection.
 */
export function londonLines(
  ch: Chart,
  s: NySession,
  lv: NyLevels,
): { high: 'break' | 'rejection' | 'untouched'; low: 'break' | 'rejection' | 'untouched' } {
  let high: 'break' | 'rejection' | 'untouched' = 'untouched'
  let low: 'break' | 'rejection' | 'untouched' = 'untouched'
  for (let j = firstAtOrAfter(ch.c, s.start); j < ch.c.length; j++) {
    const b = ch.c[j]
    if (b.time >= s.start + NY.linesUntil) break
    if (high === 'untouched' && b.high > lv.LH) high = b.close > lv.LH ? 'break' : 'rejection'
    if (low === 'untouched' && b.low < lv.LL) low = b.close < lv.LL ? 'break' : 'rejection'
  }
  return { high, low }
}

// ── The day engine ────────────────────────────────────────────────────────

interface Action {
  key: number
  pri: number
  seq: number
  run: () => void
}

interface MarketDay {
  d: LondonData
  s: Session
  actions: Action[]
  open: { trade: LondonTrade; endKey: number } | null
  opened: number
  /** Thirds: a ladder is alive in this market. */
  ladder: boolean
}

const dayIso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
const sideOf = (long: boolean) => (long ? 'BUY' : 'SELL') as 'BUY' | 'SELL'

class Engine {
  acct: LondonAccount
  trades: LondonTrade[] = []
  outcomes: Outcome[] = []
  private seq = 0

  constructor(
    readonly strategy: 'v1' | 'ny',
    start: number,
  ) {
    this.acct = new LondonAccount(start)
  }

  market(d: LondonData, s: Session): MarketDay {
    return { d, s, actions: [], open: null, opened: 0, ladder: false }
  }

  add(st: MarketDay, key: number, pri: number, run: () => void) {
    st.actions.push({ key, pri, seq: this.seq++, run })
    st.actions.sort((x, y) => x.key - y.key || x.pri - y.pri || x.seq - y.seq)
  }

  note(st: MarketDay, kind: Kind, T: number, long: boolean, result: string) {
    this.outcomes.push({ market: st.d.id, kind, T, side: sideOf(long), result })
  }

  /** Check 1 and the day count: is a trade open at decision key `decKey`, or were 2 opened today? */
  busy(st: MarketDay, decKey: number, exceptRideOf?: number): string | null {
    if (st.ladder) return 'ladder alive'
    if (
      st.open &&
      st.open.endKey >= decKey &&
      !(
        exceptRideOf != null &&
        st.open.trade.kind === 'ride' &&
        st.open.trade.setup === exceptRideOf
      )
    )
      return 'trade open'
    if (st.opened >= V1.maxPerDay) return '2 trades today'
    return null
  }

  /** Open a one-part trade through the account (check 7) and record it. */
  open(
    st: MarketDay,
    kind: Kind,
    long: boolean,
    r: Ready,
    key: number,
    meta: {
      signalCandle: number
      one: number
      zero: number
      T: number
      setup: number | null
      chartSec: number
      confident?: boolean
    },
  ): LondonTrade | string {
    const { d, s } = st
    const m = d.market
    const rpu = riskPerUnit(m, r.E, r.plan.stop, r.p)
    const got = this.acct.tryOpen({
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
    const one = r.plan.tp1 === r.plan.tp2
    const t: LondonTrade = {
      id: this.trades.length,
      strategy: this.strategy,
      market: d.id,
      kind,
      side: sideOf(long),
      long,
      day: dayIso(s.day),
      summer: s.summer,
      chartSec: meta.chartSec,
      signalCandle: meta.signalCandle,
      one: meta.one,
      zero: meta.zero,
      setup: meta.setup,
      ...(meta.confident != null ? { confident: meta.confident } : {}),
      T: meta.T,
      entryTime: r.entryTime,
      p: r.p,
      E: r.E,
      rawStop: r.plan.rawStop,
      stop: r.plan.stop,
      dist: r.plan.dist,
      tp1: r.plan.tp1,
      tp2: one ? null : r.plan.tp2,
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
    }
    this.trades.push(t)
    st.open = { trade: t, endKey: Math.max(...t.fills.map(fillKey)) }
    st.opened++
    return t
  }

  /** Run every market's actions in time order; at the same key GBP/USD (the first market) goes first. */
  runDay(mk: MarketDay[]) {
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

  result(
    options: RunResult['options'],
    counts: { signals: number; rideSignals: number; breaks: number },
  ): RunResult {
    this.acct.book(Infinity)
    return {
      strategy: this.strategy,
      options,
      trades: this.trades,
      outcomes: this.outcomes,
      ...counts,
      endBalance: this.acct.balance,
      maxDrawdown: this.acct.maxDrawdown,
      maxOpenSeen: this.acct.maxOpenSeen,
      maxOpenRiskSeen: this.acct.maxOpenRiskSeen,
    }
  }
}

/** The decision key of a signal: its entry minute if it has one (account state as of the fill), else its order time. */
const decisionKey = (r: Ready | { why: string }, T: number) =>
  isWhy(r) ? eventKey(T, 1) : eventKey(r.entryTime, 1)

// ── v1, v1-flip and v1 with thirds ────────────────────────────────────────

export type V1Mode = 'v1' | 'flip' | 'thirds'

export interface RunOptions {
  k: number
  b: number
  /** v1 (default), v1-flip, or v1 with thirds. */
  mode?: V1Mode
  /** v1-flip settings. */
  ext?: number
  g?: number
  startMoney?: number
}

/**
 * One full run over every trading day in [from, to): both markets in one
 * $10,000 account, events in time order (fills at a minute's open first,
 * then entries, then fills inside the minute).
 */
export function runLondon(data: LondonData[], o: RunOptions, from: number, to: number): RunResult {
  const mode = o.mode ?? 'v1'
  const ext = o.ext ?? FLIP_GRID.ext[0]
  const g = o.g ?? FLIP_GRID.g[0]
  const eng = new Engine('v1', o.startMoney ?? V1.startMoney)
  let signals = 0
  let rideCount = 0
  const stats: ThirdsStats = {
    taken: 0,
    confident: 0,
    ladders: 0,
    ladderTrades: 0,
    thirdsOpened: [0, 0, 0],
    addsTried: 0,
    addsOpened: 0,
    ends: {},
    pastOneBeforeTurn: 0,
  }

  for (let day = Math.floor(from / DAY) * DAY; day < to; day += DAY) {
    if (!isTradingDay(day)) continue
    const s = sessionFor(day)
    const mk = data.map((d) => {
      const st = eng.market(d, s)
      const tr = trackDay(d.c15, d.atr, s, o.k)
      for (const sig of tr.signals) {
        signals++
        const ready = prepareV1(d, s, sig, o.b)
        const decKey = eventKey(sig.T, 1)
        const key = decisionKey(ready, sig.T)
        eng.add(st, key, 1, () => {
          const note = (result: string) => eng.note(st, 'fib', sig.T, sig.long, result)
          const busy = eng.busy(st, decKey, mode === 'flip' ? sig.setup : undefined)
          if (busy) return note(busy)
          if (isWhy(ready)) return note(ready.why)
          const meta = {
            signalCandle: sig.time,
            one: sig.one,
            zero: sig.zero,
            T: sig.T,
            setup: sig.setup,
            chartSec: M15,
          }
          if (mode === 'thirds') {
            const m = d.market
            const can = eng.acct.canOpen({
              market: d.id,
              long: sig.long,
              E: ready.E,
              rpu: riskPerUnit(m, ready.E, ready.plan.stop, ready.p),
              leverage: m.leverage,
              fee: m.fee,
              fills: [],
              key,
            })
            if (can) return note(can.why)
            stats.taken++
            if (!turnCandle(d.c15[sig.i], sig.long)) {
              note('ladder')
              return startLadder(eng, st, sig, o.b, stats)
            }
            stats.confident++
            const t = eng.open(st, 'fib', sig.long, ready, key, { ...meta, confident: true })
            return note(typeof t === 'string' ? t : 'trade (confident, all at once)')
          }
          const t = eng.open(st, 'fib', sig.long, ready, key, meta)
          note(typeof t === 'string' ? t : 'trade')
        })
      }
      if (mode === 'flip')
        for (const r of rideSignals(d.market, d.c15, tr.setups, o.b, g)) {
          rideCount++
          const si = tr.setups[r.setup].signalIdx
          const fibT = si == null ? null : d.c15[si].time + M15
          const ready = prepareRide(d, s, r, ext, fibT)
          const decKey = eventKey(r.T, 1)
          const key = decisionKey(ready, r.T)
          eng.add(st, key, 2, () => {
            const note = (result: string) => eng.note(st, 'ride', r.T, r.long, result)
            const busy = eng.busy(st, decKey)
            if (busy) return note(busy)
            if (st.opened > 0) return note("not the market's first trade of the day")
            if (isWhy(ready)) return note(ready.why)
            const t = eng.open(st, 'ride', r.long, ready, key, {
              signalCandle: r.time,
              one: r.one,
              zero: r.zero,
              T: r.T,
              setup: r.setup,
              chartSec: M15,
            })
            note(typeof t === 'string' ? t : 'trade')
          })
        }
      return st
    })
    eng.runDay(mk)
  }
  const options: RunResult['options'] = { k: o.k, b: o.b, mode }
  if (mode === 'flip') Object.assign(options, { ext, g })
  const res = eng.result(options, { signals, rideSignals: rideCount, breaks: 0 })
  if (mode === 'thirds') res.thirds = stats
  return res
}

// ── Thirds (section 3B) ───────────────────────────────────────────────────

/**
 * T3 to T7: a ladder on a v1 signal that all-at-once would have traded and
 * whose candle is not a turn candle. Runs candle by candle as actions in the
 * engine, each at its candle's close (keyed at its entry minute). Every
 * decision reads closed candles only; the trade's 1-minute walk is redone
 * whenever a part opens or the stop moves.
 */
function startLadder(eng: Engine, st: MarketDay, sig: LondonSignal, b: number, stats: ThirdsStats) {
  const { d, s } = st
  const m = d.market
  const c = d.c15
  const long = sig.long
  const one = sig.one
  const zero = sig.zero
  const tp1 = zero
  const tp2 = fibLevel(one, zero, V1.tp2Level)
  const L = THIRDS.rungs.map((f) => fibLevel(one, zero, f))
  // T3: one stop for every third, the one 2.5 gives a fill exactly at the last rung.
  const last = planFrom(m, long, L[2], L[2], long ? one - b * sig.atr : one + b * sig.atr, tp1, tp2)
  const note = (result: string, T = sig.T) => eng.note(st, 'thirds', T, long, result)
  if (isWhy(last)) return note(`no ladder: ${last.why}`)
  const S = last.stop
  stats.ladders++
  st.ladder = true
  const looked = [false, false, false]
  const parts: (ThirdsPart & { idx: number; pRef: number })[] = []
  const stops: { from: number; price: number }[] = [{ from: -Infinity, price: S }]
  let trade: LondonTrade | null = null
  let pos: Pos | null = null
  let deadline: { at: number; why: ExitWhy } | null = null
  let turnSeen = false

  const over = (why: string) => {
    st.ladder = false
    stats.ends[why] = (stats.ends[why] ?? 0) + 1
    if (why === 'past 1' && !turnSeen) stats.pastOneBeforeTurn++
    if (!trade) note(`ladder over, nothing opened (${why})`)
  }

  /** Walk the whole trade again from `fromKey` and refresh its record. */
  const rewalk = (fromKey: number) => {
    const w = walkParts({
      m,
      m1: d.m1,
      long,
      parts: parts.map((x) => ({ from: x.idx, E: x.E })),
      stops,
      tp1,
      tp2,
      deadline: deadline!.at,
      deadlineWhy: deadline!.why,
    })
    parts.forEach((x, n) => {
      eng.acct.replaceFills(pos!, n, w.fills[n], fromKey)
      x.fills = w.fills[n]
      x.usd = x.units * w.pnl[n]
    })
    const t = trade!
    t.fills = w.fills.flat().sort((a, b2) => a.time - b2.time)
    t.exitTime = w.exitTime
    t.why = w.why
    t.tp1Hit = w.tp1Hit
    t.usd = parts.reduce((a, x) => a + x.usd, 0)
    t.r = t.usd / t.riskUsd
    t.pct = (t.usd / t.balanceAtEntry) * 100
    t.stop = stops[stops.length - 1].price
    t.units = parts.reduce((a, x) => a + x.units, 0)
    t.parts = parts.map(publicPart)
    st.open = { trade: t, endKey: Math.max(...t.fills.map(fillKey)) }
  }

  /** T4: one third at the close of candle i, for rung n. */
  const third = (i: number, n: 0 | 1 | 2) => {
    const T = c[i].time + M15
    const fail = (why: string) => note(`third ${n + 1}: ${why}`, T)
    const ec = entryChecks(d, s, T)
    if (isWhy(ec)) return fail(ec.why)
    const { iE, p } = ec
    const E = entryFill(m, long, p)
    const dist = long ? E - S : S - E
    if (!(dist >= V1.costFloorX * roundTrip(m, p))) return fail('stop under 10 round trips')
    const d1 = long ? tp1 - E : E - tp1
    const d2 = long ? tp2 - E : E - tp2
    if (!(d1 > 0) || !(d2 > 0)) return fail('target not on the winning side')
    const reward = 0.5 * d1 + 0.5 * d2
    const close = c[i].close
    const Eref = long ? close + spreadAt(m, close) : close
    const distRef = long ? Eref - S : S - Eref
    const rewardRef =
      0.5 * (long ? tp1 - Eref : Eref - tp1) + 0.5 * (long ? tp2 - Eref : Eref - tp2)
    if (!(distRef > 0) || !(rewardRef > 0)) return fail('no chase: no plan at the close')
    if (reward < V1.noChase * rewardRef || reward / dist < V1.noChase * (rewardRef / distRef))
      return fail('no chase')
    const rpu = riskPerUnit(m, E, S, p)
    const entryTime = d.m1[iE].time
    const key = eventKey(entryTime, 1)
    if (!trade) {
      // The third that opens the trade: checks 1 and 7, like any new trade.
      const busy =
        st.open && st.open.endKey >= eventKey(T, 1)
          ? 'trade open'
          : st.opened >= V1.maxPerDay
            ? '2 trades today'
            : null
      if (busy) return fail(busy)
      const got = eng.acct.tryOpen({
        market: d.id,
        long,
        E,
        rpu,
        leverage: m.leverage,
        fee: m.fee,
        fills: [],
        key,
        share: 1 / 3,
        floor: false,
      })
      if ('why' in got) return fail(got.why)
      deadline = ec.fc
      pos = got.pos
      const R0 = (got.balance * V1.riskPct) / 100
      trade = {
        id: eng.trades.length,
        strategy: 'v1',
        market: d.id,
        kind: 'thirds',
        side: sideOf(long),
        long,
        day: dayIso(s.day),
        summer: s.summer,
        chartSec: M15,
        signalCandle: sig.time,
        one,
        zero,
        setup: sig.setup,
        T,
        entryTime,
        p,
        E,
        rawStop: long ? one - b * sig.atr : one + b * sig.atr,
        stop: S,
        dist,
        tp1,
        tp2,
        planRR: reward / dist,
        deadline: ec.fc.at,
        deadlineWhy: ec.fc.why,
        rpu,
        units: got.units,
        riskUsd: R0,
        balanceAtEntry: got.balance,
        fills: [],
        exitTime: NaN,
        why: 'end',
        tp1Hit: false,
        r: 0,
        usd: 0,
        pct: 0,
        parts: [],
        stopMove: null,
      }
      eng.trades.push(trade)
      st.opened++
      stats.ladderTrades++
      parts.push({
        rung: (n + 1) as 1 | 2 | 3,
        candle: c[i].time,
        entryTime,
        p,
        E,
        stopAtEntry: S,
        units: got.units,
        riskUsd: got.riskUsd,
        tradeRiskAfter: eng.acct.tradeRisk(pos),
        balanceAtEntry: got.balance,
        fills: [],
        usd: 0,
        idx: iE,
        pRef: p,
      })
    } else {
      const got = eng.acct.addPart(pos!, { E, rpu, key, want: 'third' })
      if ('why' in got) return fail(got.why)
      parts.push({
        rung: (n + 1) as 1 | 2 | 3,
        candle: c[i].time,
        entryTime,
        p,
        E,
        stopAtEntry: S,
        units: got.units,
        riskUsd: got.riskUsd,
        tradeRiskAfter: got.tradeRisk,
        balanceAtEntry: got.balance,
        fills: [],
        usd: 0,
        idx: iE,
        pRef: p,
      })
    }
    stats.thirdsOpened[n]++
    note(`third ${n + 1}: opened`, T)
    rewalk(key)
  }

  /** T5: the add at the close of turn candle i. */
  const add = (i: number) => {
    stats.addsTried++
    const T = c[i].time + M15
    const fail = (why: string) => note(`add: ${why}`, T)
    const ec = entryChecks(d, s, T)
    if (isWhy(ec)) return fail(ec.why)
    const { iE, p } = ec
    let P = long ? Infinity : -Infinity
    for (let y = sig.i; y <= i; y++) P = long ? Math.min(P, c[y].low) : Math.max(P, c[y].high)
    const rawStop = long ? P - b * d.atr[i] : P + b * d.atr[i]
    const planAt = (E: number, pp: number) => {
      const floor = V1.costFloorX * roundTrip(m, pp)
      let dd = Math.max(long ? E - rawStop : rawStop - E, floor)
      const d1 = long ? tp1 - E : E - tp1
      const d2 = long ? tp2 - E : E - tp2
      if (!(d1 > 0) || !(d2 > 0)) return null
      const reward = 0.5 * d1 + 0.5 * d2
      if (reward / dd > V1.rrMax) dd = reward / V1.rrMax
      const S2 = long ? Math.max(S, E - dd) : Math.min(S, E + dd)
      const dist2 = long ? E - S2 : S2 - E
      return { S2, dist2, reward, rr: reward / dist2, floor }
    }
    const E = entryFill(m, long, p)
    const pl = planAt(E, p)
    if (!pl) return fail('target not on the winning side')
    if (pl.dist2 < pl.floor * (1 - 1e-9)) return fail('stop under 10 round trips')
    if (pl.rr < V1.rrMin) return fail('plan under 1.5R')
    const close = c[i].close
    const ref = planAt(long ? close + spreadAt(m, close) : close, close)
    if (!ref || !(ref.dist2 > 0)) return fail('no chase: no plan at the close')
    if (pl.reward < V1.noChase * ref.reward || pl.rr < V1.noChase * ref.rr) return fail('no chase')
    const entryTime = d.m1[iE].time
    const key = eventKey(entryTime, 1)
    const got = eng.acct.addPart(pos!, {
      E,
      rpu: riskPerUnit(m, E, pl.S2, p),
      key,
      want: 'rest',
      newRpus: parts.map((x) => riskPerUnit(m, x.E, pl.S2, x.pRef)),
    })
    if ('why' in got) return fail(got.why)
    stats.addsOpened++
    stops.push({ from: entryTime, price: pl.S2 })
    trade!.stopMove = { time: entryTime, from: S, to: pl.S2 }
    parts.push({
      rung: 4,
      candle: c[i].time,
      entryTime,
      p,
      E,
      stopAtEntry: pl.S2,
      units: got.units,
      riskUsd: got.riskUsd,
      tradeRiskAfter: got.tradeRisk,
      balanceAtEntry: got.balance,
      fills: [],
      usd: 0,
      idx: iE,
      pRef: p,
    })
    note('add: opened', T)
    rewalk(key)
  }

  const reach = (x: OHLCCandle, lvl: number) =>
    long ? x.low <= lvl && x.low >= one : x.high >= lvl && x.high <= one

  const step = (i: number) => {
    const x = c[i]
    const T = x.time + M15
    if (i > sig.i) {
      // T6, in order.
      if (long ? x.low < one : x.high > one) return over('past 1')
      if (i - sig.armedIdx >= V1.setupLife) return over('24 candles')
      if (T > s.lastEntry) return over('last entry')
      if (long ? x.high >= zero : x.low <= zero) return over('reached 0')
      if (trade && trade.exitTime < T) return over('every part closed')
      if (looked.every(Boolean) && !trade) return over('every rung looked, nothing opened')
      if (turnCandle(x, long)) {
        turnSeen = true
        if (trade && trade.exitTime >= T) {
          add(i)
          return over('the add was tried')
        }
      }
    }
    for (const n of [0, 1, 2] as const)
      if (!looked[n] && (i === sig.i ? n === 0 || reach(x, L[n]) : reach(x, L[n]))) {
        looked[n] = true
        third(i, n)
      }
    if (i + 1 < c.length) {
      const T1 = c[i + 1].time + M15
      const iE = entryMinute(d.m1, T1)
      eng.add(st, eventKey(iE >= 0 ? d.m1[iE].time : T1, 1), 0, () => step(i + 1))
    } else over('end of data')
  }

  step(sig.i)
}

const publicPart = (x: ThirdsPart & { idx: number; pRef: number }): ThirdsPart => ({
  rung: x.rung,
  candle: x.candle,
  entryTime: x.entryTime,
  p: x.p,
  E: x.E,
  stopAtEntry: x.stopAtEntry,
  units: x.units,
  riskUsd: x.riskUsd,
  tradeRiskAfter: x.tradeRiskAfter,
  balanceAtEntry: x.balanceAtEntry,
  fills: x.fills,
  usd: x.usd,
})

/** Net R of a thirds trade at scaled costs: same entry minutes, same levels and stop move, exits walked again. */
export function rescoreThirds(t: LondonTrade, d: LondonData, mult: number): number {
  const m = d.market
  const parts = t.parts ?? []
  if (!parts.length) return 0
  const stops = [{ from: -Infinity, price: parts[0].stopAtEntry }]
  if (t.stopMove) stops.push({ from: t.stopMove.time, price: t.stopMove.to })
  const ins = parts.map((x) => ({
    from: firstAtOrAfter(d.m1, x.entryTime),
    E: entryFill(m, t.long, x.p, mult),
  }))
  const w = walkParts({
    m,
    m1: d.m1,
    long: t.long,
    parts: ins,
    stops,
    tp1: t.tp1,
    tp2: t.tp2!,
    deadline: t.deadline,
    deadlineWhy: t.deadlineWhy,
    mult,
  })
  return parts.reduce((a, x, n) => a + x.units * w.pnl[n], 0) / t.riskUsd
}

// ── v1-NY run ─────────────────────────────────────────────────────────────

export interface NyOptions {
  k: number
  b: number
  /** Chart size in minutes: 15 or 5. */
  c: number
  /** London rule. */
  w: boolean
  startMoney?: number
}

/** One full v1-NY run (3A): its own $10,000 account, GBP/USD and gold. */
export function runNY(data: LondonData[], o: NyOptions, from: number, to: number): RunResult {
  const eng = new Engine('ny', o.startMoney ?? V1.startMoney)
  const sec = o.c * MIN
  let signals = 0
  let breaks = 0
  const lines: Record<string, { high: LinesCount; low: LinesCount }> = {}
  const count = (m: string, side: 'high' | 'low', what: 'break' | 'rejection' | 'untouched') => {
    lines[m] ??= {
      high: { breaks: 0, rejections: 0, untouched: 0 },
      low: { breaks: 0, rejections: 0, untouched: 0 },
    }
    const x = lines[m][side]
    if (what === 'break') x.breaks++
    else if (what === 'rejection') x.rejections++
    else x.untouched++
  }
  for (let day = Math.floor(from / DAY) * DAY; day < to; day += DAY) {
    if (!isTradingDay(day)) continue
    const s = nySessionFor(day)
    const mk = data.map((d) => {
      const st = eng.market(d, s)
      const ch = chartOf(d, sec)
      const lv = nyLevels(d.m1, s)
      if (!lv) {
        eng.note(
          st,
          'break',
          s.rangeEnd,
          true,
          'no levels (under 20 range minutes or no London minute)',
        )
        return st
      }
      const ll = londonLines(ch, s, lv)
      count(d.id, 'high', ll.high)
      count(d.id, 'low', ll.low)
      const brk = nyBreak(ch, s, lv, o.w)
      if (brk) {
        breaks++
        const ready = prepareBreak(d, s, ch, brk, lv, o.b)
        const decKey = eventKey(brk.T, 1)
        eng.add(st, decisionKey(ready, brk.T), 0, () => {
          const note = (result: string) => eng.note(st, 'break', brk.T, brk.long, result)
          const busy = eng.busy(st, decKey)
          if (busy) return note(busy)
          if (isWhy(ready)) return note(ready.why)
          const t = eng.open(st, 'break', brk.long, ready, decisionKey(ready, brk.T), {
            signalCandle: brk.time,
            one: lv.RH,
            zero: lv.RL,
            T: brk.T,
            setup: null,
            chartSec: sec,
          })
          note(typeof t === 'string' ? t : 'trade')
        })
      }
      for (const sig of daySignals(ch.c, ch.atr, s, o.k, sec)) {
        signals++
        const decKey = eventKey(sig.T, 1)
        if (!brk || sig.T <= brk.T) {
          eng.note(st, 'fib', sig.T, sig.long, 'before the break (or no break)')
          continue
        }
        if (sig.long !== brk.long) {
          eng.note(st, 'fib', sig.T, sig.long, "not on the break's side")
          continue
        }
        const ready = prepareV1(d, s, sig, o.b, ch)
        const key = decisionKey(ready, sig.T)
        eng.add(st, key, 1, () => {
          const note = (result: string) => eng.note(st, 'fib', sig.T, sig.long, result)
          const busy = eng.busy(st, decKey)
          if (busy) return note(busy)
          if (isWhy(ready)) return note(ready.why)
          const t = eng.open(st, 'fib', sig.long, ready, key, {
            signalCandle: sig.time,
            one: sig.one,
            zero: sig.zero,
            T: sig.T,
            setup: sig.setup,
            chartSec: sec,
          })
          note(typeof t === 'string' ? t : 'trade')
        })
      }
      return st
    })
    eng.runDay(mk)
  }
  const res = eng.result({ k: o.k, b: o.b, c: o.c, w: o.w }, { signals, rideSignals: 0, breaks })
  res.lines = lines
  return res
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

/** One trade from bid p at minute index iE, with stop and targets at the given distances from its own fill. R. */
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
    from: iE,
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

/** Mirror: the same minute, the other way, same distances from its own fill, same exit rules and clock closes, same costs. */
export function mirrorR(t: LondonTrade, d: LondonData): number {
  const iE = firstAtOrAfter(d.m1, t.entryTime)
  return legR(d, t, !t.long, iE, t.p, { at: t.deadline, why: t.deadlineWhy })
}

/** Mirror z for a list of trades (directionTest in stats.ts). Not for thirds trades. */
export function mirrorTest(trades: LondonTrade[], byId: Map<LondonMarketId, LondonData>) {
  const real = trades.map((t) => t.r)
  const mirror = trades.map((t) => mirrorR(t, byId.get(t.market)!))
  return { ...directionTest(real, mirror), mirrorTotal: mirror.reduce((a, x) => a + x, 0) }
}

/** One coin-flip draw for v1: a 15-minute open from session start + 15 minutes to last entry, and a side. */
export function coinDraw(rnd: () => number, s: Session): { T: number; long: boolean } {
  const slots = (s.lastEntry - s.start) / M15
  const T = s.start + (1 + Math.floor(rnd() * slots)) * M15
  return { T, long: rnd() < 0.5 }
}

/** One coin-flip draw for v1-NY: a `sec` mark from 08:30 New York + `sec` to 10:00 New York, and a side. */
export function coinDrawNY(
  rnd: () => number,
  s: NySession,
  sec: number,
): { T: number; long: boolean } {
  const slots = (s.lastEntry - s.rangeEnd) / sec
  const T = s.rangeEnd + (1 + Math.floor(rnd() * slots)) * sec
  return { T, long: rnd() < 0.5 }
}

/**
 * One coin-flip run: every trade swapped for a random one on the same market
 * and day (v1: a random 15-minute open from session start + 15 minutes to last
 * entry; v1-NY: a random chart mark from 08:30 + c minutes to 10:00 New York)
 * and a random side, with the trade's own stop and target distances and exit
 * rules (a ride keeps its 120-minute limit, but has no setup, so no Fib
 * close). A draw in a news block, with under 90 minutes to its forced close or
 * with no 1-minute candle is drawn again (20 tries). Total R. Not for thirds.
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
    const day = Date.parse(t.day) / 1000
    const ny = t.strategy === 'ny' ? nySessionFor(day) : null
    const s = ny ?? sessionFor(day)
    let done = false
    for (let tries = 0; tries < 20 && !done; tries++) {
      const { T, long } = ny ? coinDrawNY(rnd, ny, t.chartSec) : coinDraw(rnd, s)
      if (inWindow(d.windows, T)) continue
      const fc = forcedCloseAt(d, s, T)
      if (fc.at - T < V1.minLife) continue
      const iE = entryMinute(d.m1, T)
      if (iE < 0) continue
      const limit = d.m1[iE].time + V1.rideLimit
      const deadline: { at: number; why: ExitWhy } =
        t.kind === 'ride' && limit < fc.at ? { at: limit, why: 'limit' } : fc
      total += legR(d, t, long, iE, d.m1[iE].open, deadline)
      done = true
    }
    if (!done) missed++
  }
  return { total, missed }
}

/** The same trade with every cost scaled: same entry minute and levels, exits walked again. R. */
export function rescoreCosts(t: LondonTrade, d: LondonData, mult: number): number {
  if (t.kind === 'thirds') return rescoreThirds(t, d, mult)
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
    from: iE,
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
  /** Share of trades that ended on a clock close: time exit, before news, 12:45, the ride's limit or Fib close. */
  timeOrNewsShare: number
  withoutBest3R: number
}

const CLOCK: ExitWhy[] = ['time', 'news', 'race', 'limit', 'fib']

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
    timeOrNewsShare: ts.length ? ts.filter((t) => CLOCK.includes(t.why)).length / ts.length : 0,
    withoutBest3R: sum(best.slice(3)),
  }
}

/** 95th percentile of the coin-flip totals (the 950th of 1,000 sorted). */
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]
}

/** The six pass lines of section 5 (v1 and v1-NY, each on its own account). */
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

/** "Flip beats plain" (section 5), on one year. */
export function flipBeatsPlain(o: {
  rides: number
  ridesR: number
  flipTotalR: number
  plainTotalR: number
  flipDrawdown: number
  plainDrawdown: number
}) {
  const checks = [
    { text: 'at least 30 rides', ok: o.rides >= 30 },
    { text: 'rides alone above 0R', ok: o.ridesR > 0 },
    { text: 'v1-flip at least 3R above v1', ok: o.flipTotalR >= o.plainTotalR + 3 },
    { text: 'drawdown at most 5 points above v1', ok: o.flipDrawdown <= o.plainDrawdown + 0.05 },
  ]
  return { checks, beats: checks.every((c) => c.ok) }
}

/** "Thirds beats all-at-once" (section 5), on one year. */
export function thirdsBeats(o: {
  ladders: number
  thirdsTotalR: number
  plainTotalR: number
  thirdsDrawdown: number
  plainDrawdown: number
}) {
  const checks = [
    { text: 'at least 30 trades started as a ladder', ok: o.ladders >= 30 },
    { text: 'total R not lower', ok: o.thirdsTotalR >= o.plainTotalR },
    { text: 'max drawdown not deeper', ok: o.thirdsDrawdown <= o.plainDrawdown },
    {
      text: 'at least 3R more, or at least 3 points less drawdown',
      ok: o.thirdsTotalR >= o.plainTotalR + 3 || o.thirdsDrawdown <= o.plainDrawdown - 0.03,
    },
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

export interface FlipRow {
  ext: number
  g: number
  totalR: number
  rides: number
}

/** v1-flip: top total R (rides and Fib entries); within 2R the fewest rides; then ext = 0.272; then g = 1.5. No eligibility line. */
export function pickFlip(rows: FlipRow[]): { ext: number; g: number } {
  const top = Math.max(...rows.map((r) => r.totalR))
  const close = rows
    .filter((r) => top - r.totalR <= V1.pickWithinR)
    .sort((x, y) => x.rides - y.rides || x.ext - y.ext || x.g - y.g)
  return { ext: close[0].ext, g: close[0].g }
}

export interface NyRow {
  c: number
  w: boolean
  trades: number
  totalR: number
  maxDrawdown: number
}

/** v1-NY: as pickPair; tie c = 15 before 5, then w = on before off. None eligible: c = 15, w = on, flagged. */
export function pickNY(rows: NyRow[]): {
  c: number
  w: boolean
  qualified: boolean
  eligible: NyRow[]
} {
  const eligible = rows.filter(
    (r) => r.trades >= V1.minTradesToPick && r.maxDrawdown <= V1.maxDrawdownToPick,
  )
  if (!eligible.length) return { ...NY_DEFAULTS, qualified: false, eligible }
  const top = Math.max(...eligible.map((r) => r.totalR))
  const close = eligible
    .filter((r) => top - r.totalR <= V1.pickWithinR)
    .sort((x, y) => y.trades - x.trades || y.c - x.c || Number(y.w) - Number(x.w))
  return { c: close[0].c, w: close[0].w, qualified: true, eligible }
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
