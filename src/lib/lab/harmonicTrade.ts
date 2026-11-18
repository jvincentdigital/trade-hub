// Harmonic study (docs/harmonic-study.md, with Amendments 1 to 3): the
// indicators, the entries E0, C1 and C2 (C3 to C5 are flags on them), fills
// on 1-minute candles, the seven exits, the time exit, the end of the data,
// results in R, the look-back measures and the twins. Pure.

import {
  buildChart,
  findPatterns,
  findSwings,
  MARKET_COSTS,
  type Bars,
  type Chart,
  type HarmonicMarket,
  type MarketCosts,
  type Pattern,
  type Swing,
} from './harmonicFind'

const HOUR = 3600
const DAY = 86_400

// ---------------------------------------------------------------- indicators

/** RSI(14), Wilder's: the first value (candle 14) from plain averages of 14 changes; NaN before. No losses: 100. */
export function rsi14(close: Float64Array): Float64Array {
  const n = close.length
  const out = new Float64Array(n).fill(NaN)
  let g = 0
  let l = 0
  for (let i = 1; i < n; i++) {
    const ch = close[i] - close[i - 1]
    const gain = ch > 0 ? ch : 0
    const loss = ch < 0 ? -ch : 0
    if (i <= 14) {
      g += gain
      l += loss
      if (i < 14) continue
      g /= 14
      l /= 14
    } else {
      g = (g * 13 + gain) / 14
      l = (l * 13 + loss) / 14
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return out
}

/** EMA with 2 / (period + 1), seeded with the first value. */
export function ema(values: Float64Array, period: number): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  const k = 2 / (period + 1)
  for (let i = 0; i < n; i++)
    out[i] = i === 0 ? values[0] : out[i - 1] + k * (values[i] - out[i - 1])
  return out
}

const weekday = (t: number) => (Math.floor(t / DAY) + 4) % 7
const sundayOnOrAfter = (t: number) => t + ((7 - weekday(t)) % 7) * DAY
const nySpans = new Map<number, [number, number]>()

/**
 * New York's offset from UTC in hours (-4 on daylight saving time, -5 off),
 * with the US rules of each year: from 2007 the second Sunday of March to
 * the first Sunday of November, before that the first Sunday of April to the
 * last Sunday of October, at 02:00 local time.
 */
export function nyOffsetHours(t: number): number {
  const y = new Date(t * 1000).getUTCFullYear()
  let span = nySpans.get(y)
  if (!span) {
    const at = (m: number, d: number) => Date.UTC(y, m, d) / 1000
    span =
      y >= 2007
        ? [sundayOnOrAfter(at(2, 8)) + 7 * HOUR, sundayOnOrAfter(at(10, 1)) + 6 * HOUR]
        : [sundayOnOrAfter(at(3, 1)) + 7 * HOUR, sundayOnOrAfter(at(9, 25)) + 6 * HOUR]
    nySpans.set(y, span)
  }
  return t >= span[0] && t < span[1] ? -4 : -5
}

/** New York wall-clock seconds since its midnight. */
export const nySecondOfDay = (t: number) => {
  const s = (t + nyOffsetHours(t) * HOUR) % DAY
  return s < 0 ? s + DAY : s
}

/** C4: the fill minute is stamped 03:00 to 11:59 New York time. */
export const inLondonNyHours = (t: number) => {
  const s = nySecondOfDay(t)
  return s >= 3 * HOUR && s < 12 * HOUR
}

/** 4-hour candles on New York time (17, 21, 01, 05, 09, 13) with their EMA(50). */
export interface FourHour {
  n: number
  start: Float64Array
  end: Float64Array
  close: Float64Array
  ema50: Float64Array
}

export function fourHourCandles(bars: Bars): FourHour {
  const starts: number[] = []
  const closes: number[] = []
  let key = NaN
  for (let i = 0; i < bars.n; i++) {
    const t = bars.time[i]
    const off = nyOffsetHours(t) * HOUR
    const k = Math.floor((t + off + 7 * HOUR) / (4 * HOUR))
    if (k !== key) {
      key = k
      starts.push(k * 4 * HOUR - 7 * HOUR - off)
      closes.push(bars.close[i])
    } else closes[closes.length - 1] = bars.close[i]
  }
  const start = Float64Array.from(starts)
  const close = Float64Array.from(closes)
  return {
    n: start.length,
    start,
    end: start.map((s) => s + 4 * HOUR),
    close,
    ema50: ema(close, 50),
  }
}

/** C3: the latest 4-hour candle that ended at or before t closed above its EMA(50) (sells: below). */
export function trendAt(four: FourHour, t: number, dir: 1 | -1): boolean {
  let lo = 0
  let hi = four.n - 1
  let j = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (four.end[mid] <= t) {
      j = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (j < 0) return false
  return dir === 1 ? four.close[j] > four.ema50[j] : four.close[j] < four.ema50[j]
}

// ---------------------------------------------------------------- context

export interface HarmonicContext {
  bars: Bars
  costs: MarketCosts
  chart: Chart
  rsi: Float64Array
  ema20: Float64Array
  four: FourHour
}

/** Chart candles and indicators of one market and chart, shared by both swing sizes. */
export function harmonicContext(
  bars: Bars,
  market: HarmonicMarket,
  chartMinutes: number,
  four: FourHour = fourHourCandles(bars),
): HarmonicContext {
  const chart = buildChart(bars, chartMinutes)
  return {
    bars,
    costs: MARKET_COSTS[market],
    chart,
    rsi: rsi14(chart.close),
    ema20: ema(chart.close, 20),
    four,
  }
}

// ---------------------------------------------------------------- fills

/** How a position (or part of it) ended. 'close' is a market close at N hours (look-back only). */
export type How = 'stop' | 'target' | 'time' | 'end' | 'close'

interface Leg {
  how: How
  at: number
  price: number
}

/** A position to walk through the 1-minute candles. */
export interface Position {
  dir: 1 | -1
  /** Fill minute (1-minute bar index). */
  fill: number
  /** Entry price: the Ask for a buy, the Bid for a sell. */
  entry: number
  spread: number
  stop: number
  R: number
  /** 1 for a market entry (pays the 0.2 pip), 0 for the order at D. */
  entrySlip: number
  /** First minute of the 481st chart candle, or -1. */
  timeIdx: number
  /** Last minute of the data. */
  last: number
  costs: MarketCosts
}

/** One result in R: after costs, before costs and at double cost (Amendment 1 point 4). */
export interface Outcome {
  how: How
  /** Minute of the (last) exit. */
  at: number
  time: number
  after: number
  before: number
  double: number
  /** Market fills, in 0.2-pip units (an X3 half counts 0.5). */
  slips: number
  /** X3 only: the first half was taken at X1's target. */
  half?: boolean
}

export const TIME_EXIT_CANDLE = 481

/** First minute of the 481st chart candle counting the fill candle as the first, or -1. */
export function timeExitIdx(chart: Chart, fill: number): number {
  const c = chart.ofMinute[fill] + TIME_EXIT_CANDLE - 1
  return c < chart.n ? chart.first[c] : -1
}

/**
 * Walk from minute `from`: at the time-exit minute close at its open before
 * anything else; then the stop (buys: Bid low <= stop, fills at the stop or
 * the open beyond it; sells: Bid high + spread >= stop); then, except in the
 * first minute when `stopOnlyFirst`, the target (buys: Bid high >= target;
 * sells: Bid low + spread <= target, fills at the target). The end of the
 * data (Amendment 1 point 6, Amendment 3 point 11): a position already open
 * at the last minute's open closes there at market, before any other test,
 * like the time exit; one that opened inside the last minute closes at its
 * close.
 */
function walk(
  bars: Bars,
  p: Position,
  from: number,
  stopOnlyFirst: boolean,
  stop: number,
  target: number,
): Leg {
  const { open, high, low, close } = bars
  const sp = p.spread
  if (p.dir === 1) {
    for (let m = from; m <= p.last; m++) {
      if (m === p.timeIdx) return { how: 'time', at: m, price: open[m] }
      if (m === p.last && m > p.fill) return { how: 'end', at: m, price: open[m] }
      if (low[m] <= stop) return { how: 'stop', at: m, price: open[m] < stop ? open[m] : stop }
      if (m === from && stopOnlyFirst) continue
      if (high[m] >= target) return { how: 'target', at: m, price: target }
    }
    return { how: 'end', at: p.last, price: close[p.last] }
  }
  for (let m = from; m <= p.last; m++) {
    if (m === p.timeIdx) return { how: 'time', at: m, price: open[m] + sp }
    if (m === p.last && m > p.fill) return { how: 'end', at: m, price: open[m] + sp }
    if (high[m] + sp >= stop)
      return { how: 'stop', at: m, price: open[m] + sp > stop ? open[m] + sp : stop }
    if (m === from && stopOnlyFirst) continue
    if (low[m] + sp <= target) return { how: 'target', at: m, price: target }
  }
  return { how: 'end', at: p.last, price: close[p.last] + sp }
}

const legSlips = (p: Position, l: Leg) => p.entrySlip + (l.how === 'target' ? 0 : 1)
/** Price result of a full-size leg after costs. */
const legPnl = (p: Position, l: Leg) =>
  p.dir * (l.price - p.entry) - p.costs.comm - legSlips(p, l) * p.costs.slip

function outcome(bars: Bars, p: Position, l: Leg, pnl: number, slips: number): Outcome {
  const after = pnl / p.R
  const extra = (p.spread + p.costs.comm + slips * p.costs.slip) / p.R
  return {
    how: l.how,
    at: l.at,
    time: bars.time[l.at],
    after,
    before: after + extra,
    double: after - extra,
    slips,
  }
}

/** One target (NaN for none) with the stop and the time exit. */
export function runSingle(bars: Bars, p: Position, target: number): Outcome {
  const l = walk(bars, p, p.fill, true, p.stop, target)
  return outcome(bars, p, l, legPnl(p, l), legSlips(p, l))
}

/**
 * X3: half at t1; in that minute nothing else happens to the rest; from the
 * next minute the rest has its stop at the entry price and the target t2,
 * the stop first. Each half carries half of every cost.
 */
export function runSplit(bars: Bars, p: Position, t1: number, t2: number): Outcome {
  const l1 = walk(bars, p, p.fill, true, p.stop, t1)
  if (l1.how !== 'target')
    return { ...outcome(bars, p, l1, legPnl(p, l1), legSlips(p, l1)), half: false }
  const l2 = walk(bars, p, l1.at + 1, false, p.entry, t2)
  const pnl = (legPnl(p, l1) + legPnl(p, l2)) / 2
  const slips = (legSlips(p, l1) + legSlips(p, l2)) / 2
  return { ...outcome(bars, p, l2, pnl, slips), half: true }
}

// ---------------------------------------------------------------- exits

export const EXIT_NAMES = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7'] as const
export type ExitName = (typeof EXIT_NAMES)[number]
/** X4 to X7: targets at these multiples of R. */
export const R_EXITS = [1, 1.5, 2, 3]

/** X1 and X2 target levels: D + f x (A - D) for buys, D - f x (D - A) for sells. */
export function patternTargets(p: Pattern): [number, number] {
  const a = p.a.price
  return p.dir === 1
    ? [p.d + 0.382 * (a - p.d), p.d + 0.618 * (a - p.d)]
    : [p.d - 0.382 * (p.d - a), p.d - 0.618 * (p.d - a)]
}

/** The seven exits X1 to X7 of one position. */
export function runExits(bars: Bars, p: Position, t1: number, t2: number): Outcome[] {
  return [
    runSingle(bars, p, t1),
    runSingle(bars, p, t2),
    runSplit(bars, p, t1, t2),
    ...R_EXITS.map((m) => runSingle(bars, p, p.entry + p.dir * m * p.R)),
  ]
}

// ---------------------------------------------------------------- look-back

export const LOOK_R = [0.5, 1, 1.5, 2, 3]
/** Fixed targets in pips (Amendment 1 point 8); gold's are in dollars. */
export const LOOK_PIPS = [5, 10, 15, 20, 30, 50]
export const LOOK_GOLD_DOLLARS = [1, 2, 3, 5, 8, 12]
export const LOOK_HOURS = [4, 12, 24, 48, 72, 120]

/** Price distances of the fixed pip targets for a market. */
export const pipTargets = (costs: MarketCosts) =>
  costs.market === 'XAUUSD' ? LOOK_GOLD_DOLLARS : LOOK_PIPS.map((x) => x * costs.pip)

export interface Look {
  /** Furthest Bid move in the trade's favour and against it, from the Bid at entry, in price. */
  favour: number
  against: number
  favourR: number
  againstR: number
  favourPips: number
  againstPips: number
  /** The trade with only its stop and the time exit. */
  path: Outcome
  /** Targets at 0.5, 1, 1.5, 2 and 3 R from the entry; reached when how is 'target'. */
  targetsR: Outcome[]
  /** Targets at 5 to 50 pips (gold $1 to $12) from the entry. */
  targetsPips: Outcome[]
  /** Worth at the first minute at or after 4, 12, 24, 48, 72 and 120 hours. */
  worth: Outcome[]
}

/** First bar index at or after `from` whose stamp is at or after t (bars.n if none). */
export function minuteAtOrAfter(bars: Bars, t: number, from = 0): number {
  let lo = from
  let hi = bars.n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars.time[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The bar stamped exactly t, or -1. */
export function minuteAt(bars: Bars, t: number): number {
  const i = minuteAtOrAfter(bars, t)
  return i < bars.n && bars.time[i] === t ? i : -1
}

/** Look-back measures of Parts 2 and 3, as Amendment 3 point 7 defines them. */
export function lookBack(bars: Bars, p: Position): Look {
  const { open, high, low } = bars
  const bid = p.dir === 1 ? p.entry - p.spread : p.entry
  const toStop = p.dir === 1 ? bid - p.stop : p.stop - p.spread - bid
  let favour = 0
  let against = 0
  let leg: Leg | null = null
  for (let m = p.fill; m <= p.last && !leg; m++) {
    if (m === p.timeIdx || (m === p.last && m > p.fill)) {
      const mv = p.dir * (open[m] - bid)
      if (mv > favour) favour = mv
      if (-mv > against) against = -mv
      const how = m === p.timeIdx ? 'time' : 'end'
      leg = { how, at: m, price: p.dir === 1 ? open[m] : open[m] + p.spread }
      break
    }
    const stopHit = p.dir === 1 ? low[m] <= p.stop : high[m] + p.spread >= p.stop
    if (stopHit) {
      if (toStop > against) against = toStop
      const o = p.dir === 1 ? open[m] : open[m] + p.spread
      leg = { how: 'stop', at: m, price: p.dir * (o - p.stop) < 0 ? o : p.stop }
      break
    }
    if (m === p.fill) continue
    const f = p.dir === 1 ? high[m] - bid : bid - low[m]
    const g = p.dir === 1 ? bid - low[m] : high[m] - bid
    if (f > favour) favour = f
    if (g > against) against = g
  }
  if (!leg) leg = walk(bars, p, p.last + 1, false, p.stop, NaN)
  const path = outcome(bars, p, leg, legPnl(p, leg), legSlips(p, leg))

  const worth = LOOK_HOURS.map((h) => {
    const m = minuteAtOrAfter(bars, bars.time[p.fill] + h * HOUR, p.fill)
    if (m > p.last) return path
    if (path.how === 'stop' && path.at < m) return path
    if (path.how === 'time' && path.at <= m) return path
    const l: Leg = { how: 'close', at: m, price: p.dir === 1 ? open[m] : open[m] + p.spread }
    return outcome(bars, p, l, legPnl(p, l), legSlips(p, l))
  })

  return {
    favour,
    against,
    favourR: favour / p.R,
    againstR: against / p.R,
    favourPips: favour / p.costs.pip,
    againstPips: against / p.costs.pip,
    path,
    targetsR: LOOK_R.map((x) => runSingle(bars, p, p.entry + p.dir * x * p.R)),
    targetsPips: pipTargets(p.costs).map((x) => runSingle(bars, p, p.entry + p.dir * x)),
    worth,
  }
}

// ---------------------------------------------------------------- entries

export type EntryName = 'E0' | 'C1' | 'C2'
export const ENTRY_NAMES: EntryName[] = ['E0', 'C1', 'C2']
export type TradeStatus =
  /** Filled: exits and look-back are set. */
  | 'filled'
  /** R under 5 times the round-trip cost (counted and reported). */
  | 'skipRisk'
  /** C1, C2: the entry Ask at or above X1's target or the entry Bid at or below the stop (sells mirrored). */
  | 'skipEntry'
  /** C1, C2: a minute from the completing minute through the trigger candle reached the stop or X1's target. */
  | 'cancelled'
  /** C1, C2: no trigger in candles 1 to 12. */
  | 'noTrigger'
  /** C1, C2: the data ended before the entry candle, or before candle 12 with no trigger. */
  | 'noData'

export interface Trade {
  pattern: Pattern
  entry: EntryName
  dir: 1 | -1
  status: TradeStatus
  /** C1, C2: the trigger candle, else -1. */
  trigger: number
  /** Fill minute (bar index), -1 when there is none. */
  fill: number
  fillTime: number
  /** Chart candle of the fill minute. */
  fillCandle: number
  /** Entry price: the Ask for a buy, the Bid for a sell. */
  entryPrice: number
  entryBid: number
  spread: number
  /** Round-trip cost: the spread, plus $0.07 for gold. */
  cost: number
  R: number
  /** R in pips (a result in R times this is the result in pips). */
  rPips: number
  entrySlip: number
  /** X1's and X2's target levels. */
  target1: number
  target2: number
  /** C3's test: the 4-hour trend at the confirming candle's close agrees. */
  trend: boolean
  /** C4's test: the fill minute is stamped 03:00 to 11:59 New York time. */
  hours: boolean
  /** X1 to X7 (filled trades only). */
  exits: Outcome[]
  look: Look | null
}

export const MIN_R_COSTS = 5
export const CONFIRM_CANDLES = 12

function makeTrade(
  ctx: HarmonicContext,
  p: Pattern,
  entry: EntryName,
  status: TradeStatus,
  trigger = -1,
): Trade {
  const [target1, target2] = patternTargets(p)
  return {
    pattern: p,
    entry,
    dir: p.dir,
    status,
    trigger,
    fill: -1,
    fillTime: NaN,
    fillCandle: -1,
    entryPrice: NaN,
    entryBid: NaN,
    spread: NaN,
    cost: NaN,
    R: NaN,
    rPips: NaN,
    entrySlip: 0,
    target1,
    target2,
    trend: trendAt(ctx.four, p.confirmClose, p.dir),
    hours: false,
    exits: [],
    look: null,
  }
}

/** Fill a trade at minute `fill`: R, the skip under 5 round-trip costs, the exits and the look-back. */
function fillTrade(ctx: HarmonicContext, t: Trade, fill: number, entry: number, spread: number) {
  const { bars, chart, costs } = ctx
  const p = t.pattern
  t.fill = fill
  t.fillTime = bars.time[fill]
  t.fillCandle = chart.ofMinute[fill]
  t.entryPrice = entry
  t.entryBid = p.dir === 1 ? entry - spread : entry
  t.spread = spread
  t.cost = spread + costs.comm
  t.R = p.dir === 1 ? entry - p.stop : p.stop - entry
  t.rPips = t.R / costs.pip
  t.hours = inLondonNyHours(t.fillTime)
  if (t.R < MIN_R_COSTS * t.cost) {
    t.status = 'skipRisk'
    return t
  }
  const pos: Position = {
    dir: p.dir,
    fill,
    entry,
    spread,
    stop: p.stop,
    R: t.R,
    entrySlip: t.entrySlip,
    timeIdx: timeExitIdx(chart, fill),
    last: bars.n - 1,
    costs,
  }
  t.status = 'filled'
  t.exits = runExits(bars, pos, t.target1, t.target2)
  t.look = lookBack(bars, pos)
  return t
}

/** E0: the order at D fills in the completing minute at D. */
export function entryE0(ctx: HarmonicContext, p: Pattern): Trade {
  const t = makeTrade(ctx, p, 'E0', 'filled')
  return fillTrade(ctx, t, p.wait.minute, p.d, ctx.costs.spreadAt(p.d))
}

/** Does C1's (RSI and EMA) or C2's (reversal candle) trigger come within candles 1 to 12? */
export function findTrigger(ctx: HarmonicContext, p: Pattern, entry: 'C1' | 'C2'): number {
  const { chart, rsi, ema20 } = ctx
  const { high, low, close } = chart
  const first = chart.ofMinute[p.wait.minute]
  const lastC = Math.min(first + CONFIRM_CANDLES - 1, chart.n - 1)
  let seen = false
  for (let j = first; j <= lastC; j++) {
    if (entry === 'C1') {
      if (p.dir === 1 ? rsi[j] <= 30 : rsi[j] >= 70) seen = true
      if (seen && (p.dir === 1 ? close[j] > ema20[j] : close[j] < ema20[j])) return j
    } else {
      const rng = high[j] - low[j]
      if (!(rng > 0)) continue
      const reversal =
        p.dir === 1
          ? close[j] > high[j - 1] && close[j] >= low[j] + (2 * rng) / 3
          : close[j] < low[j - 1] && close[j] <= low[j] + rng / 3
      if (reversal) return j
    }
  }
  return -1
}

/** C1 and C2: trigger, the cancel, entry at the next chart candle's open at market, the skips. */
export function entryConfirmed(ctx: HarmonicContext, p: Pattern, entry: 'C1' | 'C2'): Trade {
  const { bars, chart, costs } = ctx
  const trig = findTrigger(ctx, p, entry)
  if (trig < 0) {
    // Candles 1 to 12 did not all exist: the data ended first (Amendment 3 point 11).
    const cut = chart.ofMinute[p.wait.minute] + CONFIRM_CANDLES - 1 >= chart.n
    return makeTrade(ctx, p, entry, cut ? 'noData' : 'noTrigger')
  }
  const [t1] = patternTargets(p)
  const sw = costs.spreadAt(p.d)
  const { high, low } = bars
  for (let m = p.wait.minute; m < chart.end[trig]; m++) {
    const reached =
      p.dir === 1 ? low[m] <= p.stop || high[m] >= t1 : high[m] + sw >= p.stop || low[m] + sw <= t1
    if (reached) return makeTrade(ctx, p, entry, 'cancelled', trig)
  }
  if (trig + 1 >= chart.n) return makeTrade(ctx, p, entry, 'noData', trig)
  const e = chart.first[trig + 1]
  const bid = bars.open[e]
  const spread = costs.spreadAt(bid)
  const ask = bid + spread
  const t = makeTrade(ctx, p, entry, 'filled', trig)
  t.entrySlip = 1
  const beyond = p.dir === 1 ? ask >= t1 || bid <= p.stop : bid <= t1 || ask >= p.stop
  if (beyond) {
    t.fill = e
    t.fillTime = bars.time[e]
    t.fillCandle = trig + 1
    t.entryPrice = p.dir === 1 ? ask : bid
    t.entryBid = bid
    t.spread = spread
    t.cost = spread + costs.comm
    t.hours = inLondonNyHours(t.fillTime)
    t.status = 'skipEntry'
    return t
  }
  return fillTrade(ctx, t, e, p.dir === 1 ? ask : bid, spread)
}

// ---------------------------------------------------------------- the run

export interface HarmonicRun {
  ctx: HarmonicContext
  k: number
  swings: Swing[]
  /** Every pattern that qualifies by the ratios, with its wait outcome, in order of C. */
  patterns: Pattern[]
  /** For each completed pattern, its E0, C1 and C2 trades (any status), in that order. */
  trades: Trade[]
}

/**
 * One market, one chart and one swing size: every pattern and every trade of
 * the three distinct entries. C3 = E0 with trend, C4 = E0 with hours, C5 = C1
 * with trend. The context's bars end where the run may read prices.
 */
export function runHarmonic(ctx: HarmonicContext, k: number): HarmonicRun {
  const { chart } = ctx
  const swings = findSwings(chart.high, chart.low, chart.close, k)
  const patterns = findPatterns(ctx.bars, chart, ctx.costs, k, swings)
  const trades: Trade[] = []
  for (const p of patterns) {
    if (p.wait.outcome !== 'completed') continue
    trades.push(entryE0(ctx, p), entryConfirmed(ctx, p, 'C1'), entryConfirmed(ctx, p, 'C2'))
  }
  return { ctx, k, swings, patterns, trades }
}

// ---------------------------------------------------------------- twins

/**
 * The position a twin of a filled trade starts from (Amendment 1 point 7,
 * Amendment 3 point 12): it enters at market at the open of minute
 * `entryMinute` (an exact stamp the caller found), with the trade's direction
 * and stop distance (R) and the entry slip its trade paid. Gold's spread is
 * set from the twin's own entry Bid. Its time exit counts from its own entry
 * candle.
 */
export function twinPosition(ctx: HarmonicContext, trade: Trade, entryMinute: number): Position {
  const { bars, chart, costs } = ctx
  const dir = trade.dir
  const bid = bars.open[entryMinute]
  const spread = costs.spreadAt(bid)
  const entry = dir === 1 ? bid + spread : bid
  return {
    dir,
    fill: entryMinute,
    entry,
    spread,
    stop: entry - dir * trade.R,
    R: trade.R,
    entrySlip: trade.entrySlip,
    timeIdx: timeExitIdx(chart, entryMinute),
    last: bars.n - 1,
    costs,
  }
}

/** A twin of a filled trade, from twinPosition, with the trade's target distances and exit rule. */
export function simulateTwin(
  ctx: HarmonicContext,
  trade: Trade,
  exit: number,
  entryMinute: number,
): Outcome {
  const { bars } = ctx
  const dir = trade.dir
  const pos = twinPosition(ctx, trade, entryMinute)
  const entry = pos.entry
  const t1 = entry + (trade.target1 - trade.entryPrice)
  const t2 = entry + (trade.target2 - trade.entryPrice)
  if (exit === 0) return runSingle(bars, pos, t1)
  if (exit === 1) return runSingle(bars, pos, t2)
  if (exit === 2) return runSplit(bars, pos, t1, t2)
  return runSingle(bars, pos, entry + dir * R_EXITS[exit - 3] * trade.R)
}

/** Bars that end with the last minute stamped before t (the choosing run reads nothing after 2018). */
export function barsBefore(bars: Bars, t: number): Bars {
  const n = minuteAtOrAfter(bars, t)
  return {
    n,
    time: bars.time.subarray(0, n),
    open: bars.open.subarray(0, n),
    high: bars.high.subarray(0, n),
    low: bars.low.subarray(0, n),
    close: bars.close.subarray(0, n),
  }
}
