// Levels study (docs/levels-study.md, Amendment 1, "Every rule is read
// against prices with no memory"): the arithmetic of the baselines. A rule's
// baseline against one kind of prices with no memory (ten shuffled-days
// series, ten mirrored-minutes series) is the mean of its lifts there, for all
// markets, each market and each half, with their spread (B); the rest is the
// lift minus the baseline, with its standard error and t (C); every line the
// plan puts on a lift is put on the rest against both baselines and must hold
// against both (D); the smallest lift the test could have seen (E). Pure.

import { SHUFFLE_GENERATOR } from './levelsShuffle'
import {
  notSeenText,
  pairBar,
  rankByT,
  runNote,
  smallestSeen,
  type Line,
  type RuleReading,
  type RuleStats,
} from './levelsStudy'

/** Amendment 1, A: ten series of each kind. */
export const BASELINE_SEEDS = 10
export const BASELINE_KINDS = ['shuffled', 'mirrored'] as const
export type BaselineKind = (typeof BASELINE_KINDS)[number]
export const BASELINE_NAMES: Record<BaselineKind, string> = {
  shuffled: 'shuffled days',
  mirrored: 'mirrored minutes',
}

/**
 * Amendment 1, A and point 30: the generator of the shuffled-days series.
 * Placebo 2's text says "seeded with 1"; each baseline series is seeded with
 * its own seed number instead.
 */
const SEEDED_WITH_1 = 'seeded with 1,'
if (!SHUFFLE_GENERATOR.includes(SEEDED_WITH_1))
  throw new Error('levelsBaseline: the shuffle generator text no longer says "seeded with 1,"')
export const SHUFFLES_GENERATOR = SHUFFLE_GENERATOR.replace(
  SEEDED_WITH_1,
  'seeded with the seed number of the series (the seeds listed beside this),',
)

/** The series, kind by kind, seeds 1 to `seeds` (Amendment 1, A). */
export const baselineSeries = (seeds = BASELINE_SEEDS) =>
  BASELINE_KINDS.flatMap((kind) => Array.from({ length: seeds }, (_, i) => ({ kind, seed: i + 1 })))

/** A rule's lifts on one series: all markets, each market, each half (null or NaN: no lift there). */
export type Lifts = Pick<RuleStats, 'lift' | 'marketLift' | 'halves'>
export const liftsOf = (s: Lifts): Lifts => ({
  lift: s.lift,
  marketLift: s.marketLift,
  halves: s.halves,
})

/** Mean, spread (standard deviation with n - 1) and number of the series that had a lift. */
export interface Spread {
  mean: number
  spread: number
  n: number
}

/** Amendment 1, B: a series with no lift (null or NaN) is left out. */
export function spreadOf(xs: (number | null | undefined)[]): Spread {
  const v = xs.filter((x): x is number => x !== null && x !== undefined && !Number.isNaN(x))
  const n = v.length
  const mean = n ? v.reduce((s, x) => s + x, 0) / n : NaN
  const spread = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : NaN
  return { mean, spread, n }
}

export interface Baseline {
  all: Spread
  markets: Record<string, Spread>
  halves: [Spread, Spread]
}

/** Amendment 1, B: a rule's baseline from its lifts on the series of one kind. */
export function baselineOf(series: Lifts[], markets: string[]): Baseline {
  const markets_: Record<string, Spread> = {}
  for (const m of markets) markets_[m] = spreadOf(series.map((s) => s.marketLift[m]))
  return {
    all: spreadOf(series.map((s) => s.lift)),
    markets: markets_,
    halves: [spreadOf(series.map((s) => s.halves[0])), spreadOf(series.map((s) => s.halves[1]))],
  }
}

/** A rest, shaped like a lift so that chooseBar, pairBar and levelLines read it. */
export interface Rest {
  lift: number
  se: number
  t: number
  marketLift: Record<string, number | null>
  marketsAbove: number
  marketsUsed: number
  halves: [number, number]
}

/** Amendment 1, C: the standard error of a rest, sqrt(S^2 + spread^2 / n), S the larger of the lift's own standard error and the spread. */
export const restSe = (se: number, b: Spread) => {
  const S = Math.max(se, b.spread)
  return Math.sqrt(S * S + (b.spread * b.spread) / b.n)
}

/**
 * Amendment 1, B and C: the lift minus the baseline, for all markets, each
 * market and each half. A t needs two series with a lift (n < 2 gives none);
 * a market or a half with no series that had a lift has no rest and is not
 * above zero.
 */
export function restOn(
  real: Pick<RuleStats, 'lift' | 'se' | 'marketLift' | 'marketsUsed' | 'halves'>,
  b: Baseline,
): Rest {
  const lift = b.all.n ? real.lift - b.all.mean : NaN
  const se = restSe(real.se, b.all)
  const marketLift: Record<string, number | null> = {}
  for (const [m, a] of Object.entries(real.marketLift)) {
    const x = b.markets[m]
    marketLift[m] = a === null || !x || !x.n ? null : a - x.mean
  }
  const half = (h: 0 | 1) => (b.halves[h].n ? real.halves[h] - b.halves[h].mean : NaN)
  return {
    lift,
    se,
    t: b.all.n >= 2 ? lift / se : NaN,
    marketLift,
    marketsAbove: Object.values(marketLift).filter((x) => x !== null && x > 0).length,
    marketsUsed: real.marketsUsed,
    halves: [half(0), half(1)],
  }
}

export interface RestReading {
  baseline: Baseline
  rest: Rest
  lines: Line[]
}

/** Amendment 1, D: lines put on the rest against each baseline; they must hold against both. */
export interface BothReading {
  shuffled: RestReading
  mirrored: RestReading
  ok: boolean
}

export function againstBoth(
  real: Pick<RuleStats, 'lift' | 'se' | 'marketLift' | 'marketsUsed' | 'halves'>,
  bases: Record<BaselineKind, Baseline>,
  lines: (r: Rest) => Line[],
): BothReading {
  const one = (k: BaselineKind): RestReading => {
    const rest = restOn(real, bases[k])
    return { baseline: bases[k], rest, lines: lines(rest) }
  }
  const shuffled = one('shuffled')
  const mirrored = one('mirrored')
  const ok = [...shuffled.lines, ...mirrored.lines].every((l) => l.ok)
  return { shuffled, mirrored, ok }
}

/** Amendment 1, D: the pair candidate's bar on a rest; its decided visits are counted on the real series. */
export const pairBarOnRest = (decided: number) => (r: Rest) =>
  pairBar({ decided, lift: r.lift, halves: r.halves, t: r.t })

/** The smaller of the two t's of the rest (NaN when either has none). */
export const smallerT = (r: BothReading) => Math.min(r.shuffled.rest.t, r.mirrored.rest.t)

/**
 * Amendment 1, D: the pair candidate is the qualifying rule whose smaller t
 * of the two is the highest, ties as the plan says (rankByT).
 */
export function rankBySmallerT<T extends { kind: string; reading: string; market: string }>(
  rows: T[],
  readingOf: (r: T) => BothReading,
): T[] {
  return rankByT(
    rows.map((row) => ({
      row,
      kind: row.kind,
      reading: row.reading,
      market: row.market,
      t: smallerT(readingOf(row)),
    })),
  ).map((x) => x.row)
}

/**
 * Amendment 1, D: the note on a Run rule is put on the rest. It applies when
 * the Turn reading at the same distance has a rest of 2 points or more
 * against both baselines, that is when the smaller of the two is.
 */
export const runNoteOnRest = (reading: RuleReading, turnRests: [number, number]) =>
  runNote(reading, Math.min(turnRests[0], turnRests[1]))

/** Amendment 1, E: the larger of 2 points and 3.0 times the larger of the two standard errors of the rest. */
export const smallestOnRest = (r: BothReading) =>
  smallestSeen(Math.max(r.shuffled.rest.se, r.mirrored.rest.se))

/** Amendment 1, E: "not seen at N points or more" on the rest, with the plain figure printed beside it. */
export const notSeenBeside = (smallest: number, plain: number) =>
  `${notSeenText(smallest)} (plain: ${Number.isFinite(plain) ? plain.toFixed(1) : 'no standard error'})`

/**
 * Amendment 1, H: the summary's split of the zones by number of turns has no
 * baseline of its own; that is said above (before) the splits.
 */
export const ZONE_SPLITS_NOTE =
  "these splits have no baseline of their own (Amendment 1, H): read them with the kind's baselines in the table above"
export const zoneSplitsLine = (zones: string) =>
  `- **Floors and ceilings of the bigger charts** (lift of the turn rate at 0.25 x ATR, in points, and visits counted; ${ZONE_SPLITS_NOTE}): ${zones}.`

/** A mean more than 2.5 x spread / sqrt(n) from zero (the mark in the placebo table). */
export const meanOutside = (s: Spread) =>
  s.n >= 2 && Number.isFinite(s.spread) && Math.abs(s.mean) > (2.5 * s.spread) / Math.sqrt(s.n)
