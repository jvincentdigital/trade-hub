import { describe, expect, it } from 'vitest'
import {
  againstBoth,
  baselineOf,
  baselineSeries,
  meanOutside,
  notSeenBeside,
  pairBarOnRest,
  rankBySmallerT,
  restOn,
  runNoteOnRest,
  smallerT,
  smallestOnRest,
  spreadOf,
  SHUFFLES_GENERATOR,
  ZONE_SPLITS_NOTE,
  zoneSplitsLine,
  type BothReading,
  type Lifts,
} from './levelsBaseline'
import { chooseBar, levelLines, PLAN_MARKETS, RULE_READINGS } from './levelsStudy'
import { SHUFFLE_GENERATOR } from './levelsShuffle'

const lifts = (
  lift: number,
  marketLift: Record<string, number | null>,
  halves: [number, number],
): Lifts => ({ lift, marketLift, halves })

describe('the series (Amendment 1, A)', () => {
  it('are ten of each kind, shuffled days first, seeds 1 to 10', () => {
    const s = baselineSeries()
    expect(s.filter((x) => x.kind === 'shuffled').map((x) => x.seed)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    expect(s.filter((x) => x.kind === 'mirrored').length).toBe(10)
    expect(s.length).toBe(20)
    expect(baselineSeries(3).length).toBe(6)
  })
})

describe('the baseline (Amendment 1, B)', () => {
  it('is the mean and the n - 1 spread of the series that had a lift', () => {
    // 1, 3, 5: mean 3, squares 4 + 0 + 4 = 8 over 2 = 4, spread 2; null and NaN left out.
    expect(spreadOf([1, null, 3, NaN, 5])).toEqual({ mean: 3, spread: 2, n: 3 })
    expect(spreadOf([4])).toEqual({ mean: 4, spread: NaN, n: 1 })
    expect(spreadOf([null])).toEqual({ mean: NaN, spread: NaN, n: 0 })
  })

  it('is worked out for all markets, each market and each half', () => {
    const b = baselineOf(
      [
        lifts(1, { EURUSD: 2, GBPUSD: null }, [0, NaN]),
        lifts(3, { EURUSD: 4, GBPUSD: null }, [2, NaN]),
        lifts(5, { EURUSD: null, GBPUSD: null }, [4, NaN]),
        lifts(NaN, { EURUSD: null, GBPUSD: null }, [NaN, NaN]),
      ],
      ['EURUSD', 'GBPUSD'],
    )
    expect(b.all).toEqual({ mean: 3, spread: 2, n: 3 })
    // EURUSD 2 and 4: mean 3, spread sqrt(2).
    expect(b.markets.EURUSD.mean).toBe(3)
    expect(b.markets.EURUSD.spread).toBeCloseTo(Math.SQRT2, 12)
    expect(b.markets.EURUSD.n).toBe(2)
    expect(b.markets.GBPUSD.n).toBe(0)
    expect(b.halves[0]).toEqual({ mean: 2, spread: 2, n: 3 })
    expect(b.halves[1].n).toBe(0)
  })
})

describe('the rest (Amendment 1, B and C)', () => {
  const b = baselineOf(
    [
      lifts(1, { EURUSD: 2, GBPUSD: null }, [0, NaN]),
      lifts(3, { EURUSD: 4, GBPUSD: null }, [2, NaN]),
      lifts(5, { EURUSD: null, GBPUSD: null }, [4, NaN]),
    ],
    ['EURUSD', 'GBPUSD', 'XAUUSD'],
  )
  const real = {
    lift: 10,
    se: 1.5,
    marketLift: { EURUSD: 5, GBPUSD: 8, XAUUSD: null },
    marketsUsed: 3,
    halves: [3, 9] as [number, number],
  }

  it('takes the spread as S when it is larger than the lift own standard error', () => {
    // Rest 10 - 3 = 7. S = max(1.5, 2) = 2; SE = sqrt(4 + 4 / 3) = sqrt(16 / 3) = 2.3094; t = 3.0311.
    const r = restOn(real, b)
    expect(r.lift).toBe(7)
    expect(r.se).toBeCloseTo(Math.sqrt(16 / 3), 12)
    expect(r.t).toBeCloseTo(7 / Math.sqrt(16 / 3), 12)
    expect(r.t).toBeCloseTo(3.0311, 4)
    // EURUSD 5 - 3 = 2; GBPUSD had no series with a lift; XAUUSD no lift of its own.
    expect(r.marketLift).toEqual({ EURUSD: 2, GBPUSD: null, XAUUSD: null })
    expect(r.marketsAbove).toBe(1)
    expect(r.marketsUsed).toBe(3)
    // Half 1: 3 - 2 = 1; half 2 had no series with a lift: no rest, not above zero.
    expect(r.halves[0]).toBe(1)
    expect(Number.isNaN(r.halves[1])).toBe(true)
    expect(chooseBar(r)[2].ok).toBe(false)
  })

  it('takes the lift own standard error as S when it is the larger', () => {
    // S = 3; SE = sqrt(9 + 4 / 3) = sqrt(31 / 3) = 3.2146; t = 7 / 3.2146 = 2.1776.
    const r = restOn({ ...real, se: 3 }, b)
    expect(r.se).toBeCloseTo(Math.sqrt(31 / 3), 12)
    expect(r.t).toBeCloseTo(2.1776, 4)
  })

  it('has no t with one series (n = 1), and the lines that ask for a t fail', () => {
    const one = baselineOf([lifts(4, { EURUSD: 4 }, [4, 4])], ['EURUSD'])
    const r = restOn(
      { lift: 6, se: 1, marketLift: { EURUSD: 6 }, marketsUsed: 1, halves: [5, 7] },
      one,
    )
    expect(r.lift).toBe(2)
    expect(r.marketLift).toEqual({ EURUSD: 2 })
    expect(r.halves).toEqual([1, 3])
    expect(Number.isNaN(r.se)).toBe(true)
    expect(Number.isNaN(r.t)).toBe(true)
    expect(chooseBar(r).map((l) => l.ok)).toEqual([true, true, true, false])
    expect(levelLines(r, true).map((l) => l.ok)).toEqual([true, false])
  })
})

describe('against both baselines (Amendment 1, D and E)', () => {
  const all7 = (x: number) => Object.fromEntries(PLAN_MARKETS.map((m) => [m, x]))
  const series = (xs: number[]) => xs.map((x) => lifts(x, all7(x), [x, x]))
  const bases = {
    // Shuffled 0, 1, 2: mean 1, spread 1. Mirrored 3, 4, 5: mean 4, spread 1.
    shuffled: baselineOf(series([0, 1, 2]), PLAN_MARKETS),
    mirrored: baselineOf(series([3, 4, 5]), PLAN_MARKETS),
  }
  const real = {
    lift: 6,
    se: 0.5,
    marketLift: all7(6),
    marketsUsed: 7,
    halves: [6, 6] as [number, number],
  }

  it('must hold against both: a rule that passes the choosing bar against one and fails against the other', () => {
    // S = max(0.5, 1) = 1; SE = sqrt(1 + 1 / 3) = 1.1547 against both.
    // Shuffled: rest 5, t 4.330: all four lines hold. Mirrored: rest 2, t 1.732: line 4 fails.
    const r = againstBoth(real, bases, chooseBar)
    expect(r.shuffled.rest.lift).toBe(5)
    expect(r.shuffled.rest.t).toBeCloseTo(5 / Math.sqrt(4 / 3), 12)
    expect(r.shuffled.lines.every((l) => l.ok)).toBe(true)
    expect(r.mirrored.rest.lift).toBe(2)
    expect(r.mirrored.rest.t).toBeCloseTo(1.7321, 4)
    expect(r.mirrored.lines.map((l) => l.ok)).toEqual([true, true, true, false])
    expect(r.ok).toBe(false)
    expect(smallerT(r)).toBeCloseTo(1.7321, 4)
    // The level lines: L1 2 >= 1.5, L2 1.73 < 2 against mirrored minutes.
    expect(againstBoth(real, bases, (x) => levelLines(x, false)).ok).toBe(false)
    expect(againstBoth({ ...real, lift: 8 }, bases, (x) => levelLines(x, false)).ok).toBe(true)
  })

  it('counts the pair candidate 150 decided visits on the real series', () => {
    // Lift 9: rests 8 and 5, t 6.93 and 4.33, both of 4 points or more with t 3.5 or more.
    const r = { ...real, lift: 9 }
    expect(againstBoth(r, bases, pairBarOnRest(150)).ok).toBe(true)
    expect(againstBoth(r, bases, pairBarOnRest(149)).ok).toBe(false)
  })

  it('prints the smallest lift seen from the larger of the two standard errors of the rest', () => {
    const r = (a: number, b: number) =>
      ({ shuffled: { rest: { se: a } }, mirrored: { rest: { se: b } } }) as BothReading
    expect(smallestOnRest(r(0.5, 0.9))).toBeCloseTo(2.7, 12)
    expect(smallestOnRest(r(0.3, 0.4))).toBe(2)
    expect(Number.isNaN(smallestOnRest(r(0.3, NaN)))).toBe(true)
  })

  it('ranks the pair candidates by the smaller of their two t, ties as rankByT', () => {
    const both = (a: number, b: number) =>
      ({ shuffled: { rest: { t: a } }, mirrored: { rest: { t: b } } }) as BothReading
    const rows = [
      { kind: 'PD', reading: 'Turn quick', market: 'EURUSD', r: both(5, 2) },
      { kind: 'PW', reading: 'Turn quick', market: 'EURUSD', r: both(3, 3.5) },
      { kind: 'PD', reading: 'Turn hold', market: 'GBPUSD', r: both(3, 4) },
      { kind: 'R00', reading: 'Run quick', market: 'EURUSD', r: both(NaN, 9) },
    ]
    // Smaller t: 2, 3, 3, none. The tie at 3 goes to PD (before PW); no t comes last.
    expect(rankBySmallerT(rows, (x) => x.r).map((x) => `${x.kind} ${x.reading}`)).toEqual([
      'PD Turn hold',
      'PW Turn quick',
      'PD Turn quick',
      'R00 Run quick',
    ])
  })

  it('puts the note on a Run rule on the smaller of the two Turn rests', () => {
    const runQuick = RULE_READINGS[2]
    expect(runNoteOnRest(runQuick, [2.5, 1.9])).toBeNull()
    expect(runNoteOnRest(runQuick, [2.5, 2])).toMatch(/price moves at this level/)
    expect(runNoteOnRest(runQuick, [NaN, 3])).toBeNull()
    expect(runNoteOnRest(RULE_READINGS[0], [5, 5])).toBeNull()
  })

  it('marks a mean more than 2.5 x spread / sqrt(n) from zero', () => {
    // 2.5 x 2 / sqrt(4) = 2.5.
    expect(meanOutside({ mean: 2.6, spread: 2, n: 4 })).toBe(true)
    expect(meanOutside({ mean: -2.5, spread: 2, n: 4 })).toBe(false)
    expect(meanOutside({ mean: 9, spread: NaN, n: 1 })).toBe(false)
  })
})

describe('how the report prints them (Amendment 1, A, E and H)', () => {
  it('prints the plain smallest lift beside the one on the rest (E)', () => {
    expect(notSeenBeside(6.27, 4.04)).toBe('not seen at 6.3 points or more (plain: 4.0)')
    expect(notSeenBeside(2, 2)).toBe('not seen at 2.0 points or more (plain: 2.0)')
    expect(notSeenBeside(NaN, 3)).toBe('not seen (no standard error) (plain: 3.0)')
    expect(notSeenBeside(5, NaN)).toBe('not seen at 5.0 points or more (plain: no standard error)')
  })

  it('says above the zone splits that they have no baseline of their own (H)', () => {
    const line = zoneSplitsLine('Z4: two turns +1.0 (10), three +2.0 (20), four or more +3.0 (30)')
    expect(line).toContain(ZONE_SPLITS_NOTE)
    expect(ZONE_SPLITS_NOTE).toMatch(/no baseline of their own/)
    expect(line.indexOf(ZONE_SPLITS_NOTE)).toBeLessThan(line.indexOf('Z4: two turns'))
    expect(line.endsWith('four or more +3.0 (30).')).toBe(true)
  })

  it('records the shuffled-days series as seeded with their own seed numbers, not with 1 (A)', () => {
    expect(SHUFFLE_GENERATOR).toContain('seeded with 1,')
    expect(SHUFFLES_GENERATOR).not.toMatch(/seeded with 1\b/)
    expect(SHUFFLES_GENERATOR).toContain('seeded with the seed number of the series')
    // Everything else about the generator is Placebo 2's text, word for word.
    expect(SHUFFLES_GENERATOR.replace(/seeded with .*?\),/, 'X')).toBe(
      SHUFFLE_GENERATOR.replace('seeded with 1,', 'X'),
    )
  })
})
