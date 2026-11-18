// Harmonic study, Amendment 5 (docs/harmonic-study.md): the lead of
// Amendment 4, frozen, on four yen pairs the study never opened. The
// settings, the pooled figures, the pooled twins (one move per UTC fill
// date, whatever the pair), the seven lines and the reading, each pair alone
// as description, the daily correlation with GBP/JPY, and the gate before the
// one run. Pure: the runner is scripts/lab/harmonic-repl.ts.

import {
  minuteAt,
  type Bars,
  type HarmonicContext,
  type HarmonicMarket,
  type Trade,
} from './harmonic'
import {
  holdIndex,
  LEAD_HOLDS,
  LEAD_HOURS,
  spanYears,
  stopShare,
  tenBest,
  twinWorth,
  type LeadFigures,
  type LeadTrade,
  type TwinSum,
  type Worth,
} from './harmonicLead'
import {
  aboveZero,
  aheadOf,
  inSpan,
  median,
  READINGS,
  stats,
  twinMoves,
  twinStamp,
  yearStart,
  type Reading,
  type Span,
  type Stats,
} from './harmonicStudy'

const DAY = 86_400

/** The four yen pairs Amendment 5 names, before step 2 of its order of work. */
export const REPL_CANDIDATES: HarmonicMarket[] = ['AUDJPY', 'CADJPY', 'NZDJPY', 'CHFJPY']

/**
 * The pairs used. The lead removes a pair here if step 2 of the order of
 * work leaves it out (clock check failed, or first candle at or after
 * 2009-07-01 00:00 UTC). The run refuses with fewer than 3. The tests
 * only ask that this list keeps the candidates' order and has 3 or more.
 * Amendment 5a: AUD/JPY is left out (the source has no data for eleven
 * months of 2012), so the test runs on three pairs.
 */
export const REPL_MARKETS: HarmonicMarket[] = ['CADJPY', 'NZDJPY', 'CHFJPY']

/** The pair whose daily changes the others are compared with. */
export const REPL_REFERENCE: HarmonicMarket = 'GBPJPY'

// ---------------------------------------------------------------- settings

export interface ReplSettings {
  rehearsal: boolean
  label: string
  pairs: HarmonicMarket[]
  /** Fewer pairs than this: no reading. */
  minPairs: number
  /** A pair's file with a bar stamped at or after this is refused. */
  refuseFrom: number
  /** Fill minutes in [from, to). */
  span: Span
  periods: [Span, Span]
  years: number[]
  twins: number
  /** Line 1 to line 4, and the middle reading's twins. */
  minTrades: number
  minT: number
  minYears: number
  minAhead: number
  positiveAhead: number
}

/** The real run: fills 2010 to 2025, periods 2010 to 2018 and 2019 to 2025, 200 twins. */
export const REPL_SETTINGS: ReplSettings = {
  rehearsal: false,
  label: 'real',
  pairs: REPL_MARKETS,
  minPairs: 3,
  refuseFrom: yearStart(2026),
  span: [yearStart(2010), yearStart(2026)],
  periods: [
    [yearStart(2010), yearStart(2019)],
    [yearStart(2019), yearStart(2026)],
  ],
  years: spanYears([yearStart(2010), yearStart(2026)]),
  twins: 200,
  minTrades: 200,
  minT: 2.5,
  minYears: 12,
  minAhead: 190,
  positiveAhead: 100,
}

/**
 * The rehearsal on the development copies: GBP/JPY and EUR/JPY stand in as
 * the pairs, fills 2010 to 2018, periods 2010 to 2014 and 2015 to 2018, 7 of
 * 9 years, 19 and 10 of 20 twins. Line 6 stays "more than half" (2 of 2).
 * Its reading is not a result.
 */
export const REPL_REHEARSAL: ReplSettings = {
  ...REPL_SETTINGS,
  rehearsal: true,
  label: 'REHEARSAL',
  pairs: ['GBPJPY', 'EURJPY'],
  minPairs: 2,
  refuseFrom: yearStart(2019),
  span: [yearStart(2010), yearStart(2019)],
  periods: [
    [yearStart(2010), yearStart(2015)],
    [yearStart(2015), yearStart(2019)],
  ],
  years: spanYears([yearStart(2010), yearStart(2019)]),
  twins: 20,
  minYears: 7,
  minAhead: 19,
  positiveAhead: 10,
}

// ---------------------------------------------------------------- pooled figures

export interface PartSum {
  n: number
  sum: number
  above: boolean
}

export interface PooledFigures {
  pairs: HarmonicMarket[]
  trades: number
  /** Averages at 24, 48, 72 and 120 hours. */
  holds: { hours: number; meanAfter: number; meanBefore: number; meanDouble: number }[]
  /** At 120 hours; weeks hold every pair's trades summed. */
  at120: Stats
  byYear: (PartSum & { year: number })[]
  yearsAbove: number
  byPair: (PartSum & { market: HarmonicMarket })[]
  pairsAbove: number
  byPeriod: (PartSum & { span: Span })[]
  periodsAbove: number
  buys: Stats
  sells: Stats
  stopShare: number
  medianAfter: number
  best: number
  tenBest: { sum: number; total: number; share: number }
}

const itemsAt = (trades: LeadTrade[], h: number) => {
  const i = holdIndex(h)
  return trades.map((x) => ({
    time: x.fillTime,
    after: x.worth[i].after,
    before: x.worth[i].before,
    double: x.worth[i].double,
  }))
}

const part = (v: { after: number }[]): PartSum => {
  const s = { n: v.length, sum: v.reduce((a, x) => a + x.after, 0) }
  return { ...s, above: aboveZero(s) }
}

/** The figures of the pairs' lead trades together, at 120 hours unless said. */
export function pooledFigures(trades: LeadTrade[], S: ReplSettings): PooledFigures {
  const items = itemsAt(trades, LEAD_HOURS)
  const after = items.map((x) => x.after)
  const dirStats = (d: 1 | -1) => stats(items.filter((_, i) => trades[i].dir === d))
  const byYear = S.years.map((year) => ({
    year,
    ...part(items.filter((x) => inSpan(x.time, [yearStart(year), yearStart(year + 1)]))),
  }))
  const byPair = S.pairs.map((market) => ({
    market,
    ...part(items.filter((_, i) => trades[i].market === market)),
  }))
  const byPeriod = S.periods.map((span) => ({
    span,
    ...part(items.filter((x) => inSpan(x.time, span))),
  }))
  return {
    pairs: S.pairs,
    trades: trades.length,
    holds: LEAD_HOLDS.map((h) => {
      const s = stats(itemsAt(trades, h))
      return { hours: h, meanAfter: s.mean, meanBefore: s.meanBefore, meanDouble: s.meanDouble }
    }),
    at120: stats(items),
    byYear,
    yearsAbove: byYear.filter((y) => y.above).length,
    byPair,
    pairsAbove: byPair.filter((p) => p.above).length,
    byPeriod,
    periodsAbove: byPeriod.filter((p) => p.above).length,
    buys: dirStats(1),
    sells: dirStats(-1),
    stopShare: stopShare(trades),
    medianAfter: median(after),
    best: after.length ? Math.max(...after) : NaN,
    tenBest: tenBest(after),
  }
}

// ---------------------------------------------------------------- twins

/** UTC fill dates in ascending order, and each trade's place in that list. */
export function dateGroups(fillTimes: number[]): { dates: number[]; ofTrade: number[] } {
  const dates = [...new Set(fillTimes.map((t) => Math.floor(t / DAY)))].sort((a, b) => a - b)
  const at = new Map(dates.map((d, i) => [d, i]))
  return { dates, ofTrade: fillTimes.map((t) => at.get(Math.floor(t / DAY))!) }
}

export interface TwinTrade {
  market: HarmonicMarket
  t: Trade
  ctx: HarmonicContext
}

/**
 * The pooled twins, seeds 1 to `seeds`: one draw per UTC fill date (dates
 * in order, the plan's generator), the same move for every trade filled on
 * that date whatever its pair. The moved minute is looked for in the
 * trade's own pair (one more day the same way, up to 4 times); a trade left
 * out of a twin counts in neither its sum nor its number.
 */
export function pooledTwins(
  trades: TwinTrade[],
  seeds: number,
  worth: (ctx: HarmonicContext, t: Trade, entryMinute: number) => Worth = twinWorth,
): TwinSum[] {
  const g = dateGroups(trades.map((x) => x.t.fillTime))
  const out: TwinSum[] = []
  for (let s = 1; s <= seeds; s++) {
    const moves = twinMoves(s, g.dates.length)
    const acc: TwinSum = { n: 0, sumAfter: 0, sumBefore: 0 }
    trades.forEach((x, i) => {
      const bars = x.ctx.bars
      const stamp = twinStamp(x.t.fillTime, moves[g.ofTrade[i]], (u) => minuteAt(bars, u) >= 0)
      if (stamp === null) return
      const w = worth(x.ctx, x.t, minuteAt(bars, stamp))
      acc.n++
      acc.sumAfter += w.after
      acc.sumBefore += w.before
    })
    out.push(acc)
  }
  return out
}

/** The plan's own way, as description: each pair's twins (leadTwins), summed seed by seed. */
export function sumTwins(perPair: TwinSum[][]): TwinSum[] {
  const seeds = perPair.length ? perPair[0].length : 0
  if (perPair.some((p) => p.length !== seeds)) throw new Error('sumTwins: seed counts differ')
  return Array.from({ length: seeds }, (_, s) =>
    perPair.reduce(
      (a, p) => ({
        n: a.n + p[s].n,
        sumAfter: a.sumAfter + p[s].sumAfter,
        sumBefore: a.sumBefore + p[s].sumBefore,
      }),
      { n: 0, sumAfter: 0, sumBefore: 0 },
    ),
  )
}

/** Each twin's average per trade, after or before costs; NaN for a twin with no trade. */
export const twinMeans = (twins: TwinSum[], which: 'after' | 'before') =>
  twins.map((x) => (x.n ? (which === 'after' ? x.sumAfter : x.sumBefore) / x.n : NaN))

// ---------------------------------------------------------------- the seven lines and the reading

export interface ReplLine {
  line: number
  rule: string
  value: number
  ok: boolean
}

export interface ReplVerdict {
  lines: ReplLine[]
  pass: boolean
  aheadAfter: number
  aheadBefore: number
  clears2and4Before: boolean
  reading: Reading
}

const yearsText = ([a, b]: Span) => {
  const y = spanYears([a, b])
  return `${y[0]} to ${y[y.length - 1]}`
}

/**
 * Amendment 5's seven lines on the pairs together, after costs at 120
 * hours, and the reading, tried in the amendment's order. A twin is passed
 * when its average is strictly lower; a twin with no trade is not passed.
 */
export function replVerdict(f: PooledFigures, twins: TwinSum[], S: ReplSettings): ReplVerdict {
  const k = f.pairs.length
  if (k < S.minPairs) throw new Error(`${k} pairs: at least ${S.minPairs} are needed for a reading`)
  const s = f.at120
  const aheadAfter = aheadOf(s.mean, twinMeans(twins, 'after'))
  const aheadBefore = aheadOf(s.meanBefore, twinMeans(twins, 'before'))
  const lines: ReplLine[] = [
    { line: 1, rule: `at least ${S.minTrades} trades`, value: s.n, ok: s.n >= S.minTrades },
    { line: 2, rule: `a weekly t-statistic of ${S.minT} or more`, value: s.t, ok: s.t >= S.minT },
    {
      line: 3,
      rule: `at least ${S.minYears} of the ${S.years.length} years above zero`,
      value: f.yearsAbove,
      ok: f.yearsAbove >= S.minYears,
    },
    {
      line: 4,
      rule: `ahead of at least ${S.minAhead} of the ${twins.length} pooled twins`,
      value: aheadAfter,
      ok: aheadAfter >= S.minAhead,
    },
    {
      line: 5,
      rule: 'still above zero at double cost',
      value: s.sumDouble,
      ok: aboveZero({ n: s.n, sum: s.sumDouble }),
    },
    {
      line: 6,
      rule: `more than half of the ${k} pairs above zero (${Math.floor(k / 2) + 1} of ${k})`,
      value: f.pairsAbove,
      ok: f.pairsAbove * 2 > k,
    },
    {
      line: 7,
      rule: `above zero in each of the two periods, ${f.byPeriod.map((p) => yearsText(p.span)).join(' and ')}`,
      value: f.periodsAbove,
      ok: f.periodsAbove === f.byPeriod.length,
    },
  ]
  const pass = lines.every((l) => l.ok)
  const clears2and4Before = s.tBefore >= S.minT && aheadBefore >= S.minAhead
  let r: Reading
  if (pass) r = READINGS[0]
  else if (s.mean > 0 && aheadAfter >= S.positiveAhead && lines[5].ok && lines[6].ok)
    r = READINGS[1]
  else if (clears2and4Before) r = READINGS[2]
  else r = READINGS[3]
  return { lines, pass, aheadAfter, aheadBefore, clears2and4Before, reading: r }
}

/** What Amendment 5 ties to each reading, printed under it. */
export const READING_NOTES: Record<Reading, string> = {
  'Worth a play account':
    'All seven lines hold. Before John is told so, a second implementation and two reviewers must fail to break it.',
  'Positive, not proven':
    'In those words the rule may be offered to John for a play-money account as the next test, never as a proven rule.',
  'Real but too small to trade':
    'Neither reading above applies, and before costs the pairs together clear lines 2 and 4.',
  'Not there':
    'Then the GBP/JPY result is most likely the luck of picking the best of 42 cells, and the lead is closed.',
}

// ---------------------------------------------------------------- each pair alone (description)

export interface PairDescription {
  figures: LeadFigures
  yearsAbove: number
  aheadAfter: number
  aheadBefore: number
  sumDouble: number
}

/** One pair with Amendment 4's figures and its own twins (leadTwins on that pair alone). */
export function pairDescription(f: LeadFigures, twins: TwinSum[]): PairDescription {
  return {
    figures: f,
    yearsAbove: f.byYear.filter(aboveZero).length,
    aheadAfter: aheadOf(f.at120.mean, twinMeans(twins, 'after')),
    aheadBefore: aheadOf(f.at120.meanBefore, twinMeans(twins, 'before')),
    sumDouble: f.at120.sumDouble,
  }
}

// ---------------------------------------------------------------- daily correlation

/** The last Bid close of each UTC date (day number), bars stamped inside the span. */
export function dailyCloses(bars: Pick<Bars, 'n' | 'time' | 'close'>, span: Span) {
  const out = new Map<number, number>()
  for (let i = 0; i < bars.n; i++)
    if (inSpan(bars.time[i], span)) out.set(Math.floor(bars.time[i] / DAY), bars.close[i])
  return out
}

/** Pearson correlation; NaN with fewer than 2 values or no spread. */
export function pearson(x: number[], y: number[]): number {
  const n = x.length
  if (n !== y.length) throw new Error('pearson: lengths differ')
  if (n < 2) return NaN
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN
}

/**
 * Correlation of daily changes: the dates present in both series, in order;
 * on each date after the first, the change in percent of the last close
 * from the previous such date, for each series.
 */
export function dailyCorrelation(
  a: Map<number, number>,
  b: Map<number, number>,
): { dates: number; changes: number; r: number } {
  const common = [...a.keys()].filter((d) => b.has(d)).sort((x, y) => x - y)
  const ca: number[] = []
  const cb: number[] = []
  for (let i = 1; i < common.length; i++) {
    ca.push(100 * (a.get(common[i])! / a.get(common[i - 1])! - 1))
    cb.push(100 * (b.get(common[i])! / b.get(common[i - 1])! - 1))
  }
  return { dates: common.length, changes: ca.length, r: pearson(ca, cb) }
}

// ---------------------------------------------------------------- the gate

export interface ReplGateFacts {
  afterError: boolean
  pairs: HarmonicMarket[]
  minPairs: number
  /** The candidate pairs whose file is in the data folder (existence only). */
  present: HarmonicMarket[]
  /** The reference file (GBP/JPY) exists. */
  reference: boolean
  /** REPL-RAN.json and REPL-RAN-2.json exist. */
  marker: boolean
  marker2: boolean
  /** REPL-DONE.json exists: a run reached the point of writing its figures. */
  done: boolean
  /** The out folder, or the first run's, holds repl.json, repl.md or repl-trades.csv.gz. */
  outHasResults: boolean
  /** The first run's process is still going. */
  firstAlive: boolean
  /** A note of the error and the fix was given, and it is not empty. */
  errorNote: boolean
}

/**
 * Which marker to write (1: REPL-RAN.json, 2: REPL-RAN-2.json, after an
 * error), or why the run is refused. Exactly the files of the pairs used
 * must be there. Once a figure is written there is no second run.
 */
export function replGate(f: ReplGateFacts): { refuse: string } | { write: 1 | 2 } {
  if (f.pairs.length < f.minPairs)
    return { refuse: `${f.pairs.length} pairs: at least ${f.minPairs} are needed` }
  const want = [...f.pairs].sort().join(', ')
  const have = [...f.present].sort().join(', ')
  if (want !== have)
    return { refuse: `the data folder holds files for ${have || 'no pair'}, not ${want}` }
  if (!f.reference) return { refuse: `no ${REPL_REFERENCE} file` }
  if (f.done) return { refuse: 'a run already wrote its figures: REPL-DONE.json exists' }
  if (f.outHasResults)
    return { refuse: 'a results file is already in the out folder of this or the first run' }
  if (!f.afterError) {
    if (f.marker) return { refuse: 'the run already ran: REPL-RAN.json exists' }
    return { write: 1 }
  }
  if (!f.marker) return { refuse: '--after-error, but REPL-RAN.json does not exist' }
  if (f.marker2) return { refuse: 'the second run already ran: REPL-RAN-2.json exists' }
  if (f.firstAlive) return { refuse: 'the first run is still going' }
  if (!f.errorNote)
    return { refuse: '--after-error needs --error-note <file> with the error and the fix' }
  return { write: 2 }
}
