import { describe, expect, it } from 'vitest'
import { TV } from './levelsRecord'
import { onlyWideDays, p1Limit, p2Outside, placebo1, restOf } from './levelsPlacebo'
import { chooseBar, levelLines, type Cell, type RuleStats } from './levelsStudy'

const cell = (
  pool: string,
  set: number,
  turns: number,
  breaks: number,
  week = 100,
  market = 'EURUSD',
): Cell => {
  const v = new Float64Array(TV.size)
  v[TV.n] = turns + breaks
  v[TV.turn + 1] = turns
  v[TV.brk + 1] = breaks
  return { market, pool, year: 2010, side: 1, week, set, v }
}

const stats = (over: Partial<RuleStats>): RuleStats => ({
  lift: 0,
  se: 1,
  t: 0,
  draws: 2000,
  marketLift: {},
  marketsAbove: 0,
  marketsUsed: 7,
  halves: [0, 0],
  decided: 0,
  rate: NaN,
  twinRate: NaN,
  smallest: 3,
  ...over,
})

describe('Placebo 1', () => {
  it('reads set 0 (the 0.60 set) as the level against set 1 (the far sets) at 0.25 x ATR', () => {
    // Level 6 turns, 4 breaks (60); far sets 50 of 100; another pool and set 2 do not count.
    const cells = [
      cell('PD', 0, 6, 4),
      cell('PD', 1, 50, 50),
      cell('PW', 0, 10, 0),
      cell('PD', 2, 0, 100),
    ]
    const r = placebo1(
      cells,
      { label: 'PD', pool: 'PD' },
      () => true,
      [() => true, () => true],
      ['EURUSD'],
      50,
    )
    expect(r.stats.lift).toBeCloseTo(10, 9)
    expect(r.stats.decided).toBe(10)
    expect(r.limit).toBe(p1Limit(r.stats.se))
  })

  it('is inside 1.5 points or 2.5 standard errors, whichever is wider', () => {
    expect(p1Limit(0.4)).toBe(1.5)
    expect(p1Limit(1)).toBe(2.5)
    expect(p1Limit(NaN)).toBe(1.5)
  })
})

describe('Placebo 2 and the rest', () => {
  it('is outside past 2.5 standard errors of zero only', () => {
    expect(p2Outside({ lift: 2.5, se: 1 })).toBe(false)
    expect(p2Outside({ lift: -2.6, se: 1 })).toBe(true)
    expect(p2Outside({ lift: 9, se: NaN })).toBe(false)
  })

  it('names a lift that comes only from wide days', () => {
    const all = stats({ lift: 3, se: 1 })
    expect(onlyWideDays(all, stats({ lift: 1, se: 1 }))).toBe(true)
    expect(onlyWideDays(all, stats({ lift: 3, se: 1 }))).toBe(false)
    expect(onlyWideDays(stats({ lift: 2, se: 1 }), stats({ lift: 0, se: 1 }))).toBe(false)
  })

  it('reads a rule on the rest: lift minus Placebo 2 lift, each market and half, SE in quadrature', () => {
    const real = stats({
      lift: 7,
      se: 0.6,
      marketLift: { EURUSD: 8, GBPUSD: 2, XAUUSD: null },
      marketsUsed: 3,
      halves: [6, 8],
    })
    const p2 = stats({ lift: 3, se: 0.8, marketLift: { EURUSD: 3, GBPUSD: 2.5 }, halves: [5, 1] })
    const r = restOf(real, p2)
    expect(r.lift).toBe(4)
    expect(r.se).toBeCloseTo(1, 12)
    expect(r.t).toBeCloseTo(4, 12)
    expect(r.marketLift).toEqual({ EURUSD: 5, GBPUSD: -0.5, XAUUSD: null })
    expect(r.marketsAbove).toBe(1)
    expect(r.halves).toEqual([1, 7])
    expect(r.smallest).toBeCloseTo(3, 12)
    // The bar on the rest: lift 4 >= 2 holds, 1 of 3 markets is not more than two thirds,
    // both halves above zero, t 4 >= 3.
    expect(chooseBar(r).map((l) => l.ok)).toEqual([true, false, true, true])
    // L1 4 >= 1.5, L2 4 >= 2, L3 1 of 3 is not more than half.
    expect(levelLines(r, false).map((l) => l.ok)).toEqual([true, true, false])
  })
})
