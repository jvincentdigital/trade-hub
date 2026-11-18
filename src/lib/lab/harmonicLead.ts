// Harmonic study, Amendment 4 (docs/harmonic-study.md): the lead from the
// tables. GBP/JPY (EUR/JPY described beside it), order at D, all four
// patterns, both charts, both swing sizes, closed at the first minute at or
// after 120 hours from the fill ("worth after N hours", Amendment 3 point 7).
// Selecting the trades, their figures, the twins' 120-hour worth, the five
// pass lines and the reading. Pure: the runner is scripts/lab/harmonic-lead.ts.

import {
  LOOK_HOURS,
  lookBack,
  minuteAt,
  twinPosition,
  type HarmonicContext,
  type HarmonicMarket,
  type How,
  type Trade,
} from './harmonic'
import {
  aboveZero,
  aheadOf,
  inSpan,
  median,
  passLines,
  reading,
  stats,
  twinGroups,
  twinMoves,
  twinStamp,
  yearOf,
  yearStart,
  type PassLine,
  type Reading,
  type Span,
  type Stats,
  type StudyPeriods,
} from './harmonicStudy'

/** The lead's market first, then the one described beside it. */
export const LEAD_MARKETS: HarmonicMarket[] = ['GBPJPY', 'EURJPY']
export const LEAD_MARKET: HarmonicMarket = 'GBPJPY'
/** The holds shown; the lead is the last. */
export const LEAD_HOLDS = [24, 48, 72, 120]
export const LEAD_HOURS = 120
/** Index of a hold in the engine's look-back `worth` list. */
export const holdIndex = (h: number) => {
  const i = LOOK_HOURS.indexOf(h)
  if (i < 0) throw new Error(`no look-back hold of ${h} hours`)
  return i
}

/** One worth result, as the engine's Outcome and the trade file's OutRec both carry it. */
export interface Worth {
  how: How
  after: number
  before: number
  double: number
}

/** The part of a trade the lead uses. */
export interface LeadTrade {
  market: HarmonicMarket
  dir: 1 | -1
  fillTime: number
  /** The engine's look-back worth at 4, 12, 24, 48, 72 and 120 hours. */
  worth: Worth[]
}

/** The lead's trades: order at D (E0), filled, of this market, fill minute in the span. */
export function selectLead<T extends { market: HarmonicMarket; t: Trade }>(
  trades: T[],
  market: HarmonicMarket,
  span: Span,
): T[] {
  return trades.filter(
    (x) =>
      x.market === market &&
      x.t.entry === 'E0' &&
      x.t.status === 'filled' &&
      x.t.look !== null &&
      inSpan(x.t.fillTime, span),
  )
}

export const leadTrade = (market: HarmonicMarket, t: Trade): LeadTrade => ({
  market,
  dir: t.dir,
  fillTime: t.fillTime,
  worth: t.look!.worth,
})

const itemsAt = (trades: LeadTrade[], h: number) => {
  const i = holdIndex(h)
  return trades.map((x) => ({
    time: x.fillTime,
    after: x.worth[i].after,
    before: x.worth[i].before,
    double: x.worth[i].double,
  }))
}

/** Share of trades that ended at their stop within the hold. NaN with no trade. */
export function stopShare(trades: LeadTrade[], h = LEAD_HOURS): number {
  const i = holdIndex(h)
  return trades.length
    ? trades.filter((x) => x.worth[i].how === 'stop').length / trades.length
    : NaN
}

/** The ten best results after costs: their sum and its part of the whole sum (NaN when the sum is 0). */
export function tenBest(results: number[]): { sum: number; total: number; share: number } {
  const best = [...results].sort((a, b) => b - a).slice(0, 10)
  const sum = best.reduce((s, x) => s + x, 0)
  const total = results.reduce((s, x) => s + x, 0)
  return { sum, total, share: total === 0 ? NaN : sum / total }
}

export interface LeadFigures {
  market: HarmonicMarket
  trades: number
  /** Average after costs at 24, 48, 72 and 120 hours. */
  holds: { hours: number; meanAfter: number; meanBefore: number }[]
  /** At 120 hours. */
  at120: Stats
  byYear: { year: number; n: number; sum: number }[]
  buys: Stats
  sells: Stats
  stopShare: number
  medianAfter: number
  best: number
  tenBest: { sum: number; total: number; share: number }
}

/** The figures of one market's lead trades, by year over `years`. */
export function leadFigures(
  market: HarmonicMarket,
  trades: LeadTrade[],
  years: number[],
): LeadFigures {
  const items = itemsAt(trades, LEAD_HOURS)
  const after = items.map((x) => x.after)
  const dirStats = (d: 1 | -1) => stats(items.filter((_, i) => trades[i].dir === d))
  return {
    market,
    trades: trades.length,
    holds: LEAD_HOLDS.map((h) => {
      const s = stats(itemsAt(trades, h))
      return { hours: h, meanAfter: s.mean, meanBefore: s.meanBefore }
    }),
    at120: stats(items),
    byYear: years.map((y) => {
      const v = items.filter((x) => inSpan(x.time, [yearStart(y), yearStart(y + 1)]))
      return { year: y, n: v.length, sum: v.reduce((s, x) => s + x.after, 0) }
    }),
    buys: dirStats(1),
    sells: dirStats(-1),
    stopShare: stopShare(trades),
    medianAfter: median(after),
    best: after.length ? Math.max(...after) : NaN,
    tenBest: tenBest(after),
  }
}

/** The years of a span [from, to) whose 1 January is inside it. */
export const spanYears = ([a, b]: Span) => {
  const out: number[] = []
  for (let y = yearOf(a); yearStart(y) < b; y++) if (yearStart(y) >= a) out.push(y)
  return out
}

// ---------------------------------------------------------------- twins

/** The 120-hour worth of a twin entered at the open of `entryMinute`: lookBack on twinPosition. */
export function twinWorth(ctx: HarmonicContext, trade: Trade, entryMinute: number): Worth {
  return lookBack(ctx.bars, twinPosition(ctx, trade, entryMinute)).worth[holdIndex(LEAD_HOURS)]
}

export interface TwinSum {
  n: number
  sumAfter: number
  sumBefore: number
}

/**
 * The twins of one list of lead trades, seeds 1 to `seeds`: one move per
 * (market, UTC fill date) group with the plan's generator; the moved stamp
 * must exist exactly, one more day the same way up to 4 times, else the
 * trade is left out of that twin.
 */
export function leadTwins(
  trades: { market: HarmonicMarket; t: Trade; ctx: HarmonicContext }[],
  seeds: number,
): TwinSum[] {
  const tw = twinGroups(trades.map((x) => ({ market: x.market, fillTime: x.t.fillTime })))
  const out: TwinSum[] = []
  for (let s = 1; s <= seeds; s++) {
    const moves = twinMoves(s, tw.groups.length)
    const acc: TwinSum = { n: 0, sumAfter: 0, sumBefore: 0 }
    trades.forEach((x, i) => {
      const bars = x.ctx.bars
      const stamp = twinStamp(x.t.fillTime, moves[tw.ofTrade[i]], (u) => minuteAt(bars, u) >= 0)
      if (stamp === null) return
      const w = twinWorth(x.ctx, x.t, minuteAt(bars, stamp))
      acc.n++
      acc.sumAfter += w.after
      acc.sumBefore += w.before
    })
    out.push(acc)
  }
  return out
}

// ---------------------------------------------------------------- the verdict

export interface LeadVerdict {
  lines: PassLine[]
  pass: boolean
  aheadAfter: number
  aheadBefore: number
  clears2and4Before: boolean
  reading: Reading
}

/**
 * Amendment 4's five lines (the pair candidate's: line 1 at passTradesPair,
 * no line 6) and the reading in the order of Amendment 2 point 5. A twin is
 * passed when its average result per trade is strictly lower.
 */
export function leadVerdict(f: LeadFigures, twins: TwinSum[], P: StudyPeriods): LeadVerdict {
  const s = f.at120
  const aheadAfter = aheadOf(
    s.mean,
    twins.map((x) => (x.n ? x.sumAfter / x.n : NaN)),
  )
  const aheadBefore = aheadOf(
    s.meanBefore,
    twins.map((x) => (x.n ? x.sumBefore / x.n : NaN)),
  )
  const lines = passLines(
    {
      n: s.n,
      t: s.t,
      yearsAbove: f.byYear.filter(aboveZero).length,
      ahead: aheadAfter,
      doubleSum: s.sumDouble,
      marketsAbove: null,
      marketsUsed: null,
    },
    P.passTradesPair,
    P,
  )
  const pass = lines.every((l) => l.ok)
  return {
    lines,
    pass,
    aheadAfter,
    aheadBefore,
    clears2and4Before: s.tBefore >= P.minT && aheadBefore >= P.minAhead,
    reading: reading({ pass, meanAfter: s.mean, aheadAfter, tBefore: s.tBefore, aheadBefore }, P),
  }
}
