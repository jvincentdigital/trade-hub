// Levels study (docs/levels-study.md, "How the numbers are checked"): the
// arithmetic of the two placebos and of a rule read "on the rest". Placebo 1:
// twin set 0.60 (round numbers: the grid at 25.0 pips, $5.00) treated as the
// level against the sets at least 0.10 away (the grids at least 5 pips, $1,
// away), its lift at 0.25 x ATR inside plus or minus 1.5 points or 2.5
// standard errors, whichever is wider. Placebo 2: each kind's lift on the
// shuffled days, which should lie within 2.5 standard errors of zero; a rule
// whose Placebo 2 lift lies outside on the choosing years is read on the rest
// (its lift minus its Placebo 2 lift, for each market and each half, with the
// standard error the square root of the sum of the two squared ones). Pure.

import {
  PLAN_KINDS,
  ruleStats,
  runMeasure,
  smallestSeen,
  TWO_TURN,
  turnMeasure,
  type Cell,
  type Keep,
  type Measure,
  type RuleStats,
} from './levelsStudy'

// ---------------------------------------------------------------- Placebo 1

/** The pools Placebo 1 is read on: the round-number grids (R00 and R50 share them), the eight other kinds, then the two-turn zones. */
export const P1_POOLS: { label: string; pool: string }[] = [
  { label: 'R00, R50 (the grids)', pool: 'RTW' },
  ...PLAN_KINDS.filter((k) => k !== 'R00' && k !== 'R50').map((k) => ({ label: k, pool: k })),
  ...TWO_TURN.map((k) => ({ label: `${k} (two-turn zones)`, pool: k })),
]

export interface PlaceboRow {
  label: string
  pool: string
  measure: string
  stats: RuleStats
  /** The limit the lift must be inside (in points). */
  limit: number
  /** null: no lift to read (no visit). */
  inside: boolean | null
}

/** Placebo 1's limit: plus or minus 1.5 points or 2.5 standard errors, whichever is wider. */
export const p1Limit = (se: number) => (Number.isFinite(se) ? Math.max(1.5, 2.5 * se) : 1.5)

/** Placebo 1 on one pool: the engine's placebo cells (set 0 the placebo set, set 1 the far sets). */
export function placebo1(
  cells: Cell[],
  p: { label: string; pool: string },
  keep: Keep,
  halves: [Keep, Keep],
  markets: string[],
  draws?: number,
): PlaceboRow {
  const mine = cells.filter((c) => c.pool === p.pool)
  const stats = ruleStats(
    mine.filter((c) => c.set === 0),
    mine.filter((c) => c.set === 1),
    turnMeasure(1),
    keep,
    halves,
    markets,
    draws,
  )
  const limit = p1Limit(stats.se)
  return {
    ...p,
    measure: 'turn 0.25',
    stats,
    limit,
    inside: Number.isFinite(stats.lift) ? Math.abs(stats.lift) <= limit : null,
  }
}

// ---------------------------------------------------------------- Placebo 2

/** The measures Placebo 2 reports, with the rule reading each one is (turn 0.10 is no rule's). */
export const P2_MEASURES: { name: string; m: Measure; reading: string | null }[] = [
  { name: 'turn 0.10', m: turnMeasure(0), reading: null },
  { name: 'turn 0.25', m: turnMeasure(1), reading: 'Turn quick' },
  { name: 'turn 1.00', m: turnMeasure(3), reading: 'Turn hold' },
  { name: 'run 0.25', m: runMeasure(1), reading: 'Run quick' },
  { name: 'run 1.00', m: runMeasure(3), reading: 'Run hold' },
]

/** Kinds whose levels are partly made and met inside one day, so that they keep their real past in the shuffle. */
export const P2_CAUTIOUS = ['Z4', 'F4C', 'F4J', 'Z4x2']
export const P2_CAUTIOUS_TEXT =
  'a cautious test: levels made and met inside one day keep their real past in the shuffle'

/** Outside 2.5 standard errors of zero (a lift or a standard error that cannot be worked out is not outside). */
export const p2Outside = (s: Pick<RuleStats, 'lift' | 'se'>) =>
  Number.isFinite(s.lift) && Number.isFinite(s.se) && Math.abs(s.lift) > 2.5 * s.se

export const ONLY_WIDE_TEXT = 'comes only from days whose range is more than 1.5 x the ATR in force'

/**
 * The limit line: a Placebo 2 lift outside 2.5 standard errors that is no
 * longer outside when only the visits touched on the other days (range at most
 * 1.5 x the ATR in force, levels and twins alike) are counted.
 */
export const onlyWideDays = (all: RuleStats, calm: RuleStats) => p2Outside(all) && !p2Outside(calm)

// ---------------------------------------------------------------- the rest

export interface RestStats {
  lift: number
  se: number
  t: number
  marketLift: Record<string, number | null>
  marketsAbove: number
  marketsUsed: number
  halves: [number, number]
  /** The smallest lift this test could have seen: the larger of 2 points and 3.0 times the rest's standard error. */
  smallest: number
}

/** A rule read on the rest: its lift minus its Placebo 2 lift, for all markets, each market and each half. */
export function restOf(real: RuleStats, p2: RuleStats): RestStats {
  const lift = real.lift - p2.lift
  const se = Math.sqrt(real.se ** 2 + p2.se ** 2)
  const marketLift: Record<string, number | null> = {}
  for (const [m, a] of Object.entries(real.marketLift)) {
    const b = p2.marketLift[m]
    marketLift[m] = a === null || b === null || b === undefined ? null : a - b
  }
  return {
    lift,
    se,
    t: lift / se,
    marketLift,
    marketsAbove: Object.values(marketLift).filter((x) => x !== null && x > 0).length,
    marketsUsed: real.marketsUsed,
    halves: [real.halves[0] - p2.halves[0], real.halves[1] - p2.halves[1]],
    smallest: smallestSeen(se),
  }
}
