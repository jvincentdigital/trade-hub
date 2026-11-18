import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import { lift, type Unit } from './levelsCount'
import { TT, TT_SIZE, TV, type VisitRec } from './levelsRecord'
import { runLevels } from './levelsRun'
import {
  aheadOfSets,
  breakEvenRate,
  changeCorrelation,
  chooseBar,
  levelCells,
  levelLines,
  pairBar,
  pctChanges,
  PLAN_KINDS,
  rankByT,
  RULE_READINGS,
  RULES,
  runNote,
  settledCellDiffs,
  settledVisitDiffs,
  shownRates,
  smallestSeen,
  notSeenText,
  spearman,
  tradeBlock,
  tradeFacts,
  tradeLines,
  turnMeasure,
  unitsOf,
  verdict,
  VERDICTS,
  weekSettled,
  yearStart,
  type Cell,
  type Line,
  type TradeFacts,
} from './levelsStudy'

const u = (
  week: number,
  market: string,
  cell: string,
  hits: number,
  n: number,
  twinHits: number,
  twinN: number,
): Unit => ({ week, market, cell, hits, n, twinHits, twinN })

const okAll = (lines: Line[]) => lines.every((l) => l.ok)

describe('the forty rules', () => {
  it('are the ten kinds in the order listed, each with the four readings in order', () => {
    expect(RULES.length).toBe(40)
    expect(PLAN_KINDS).toEqual(['R00', 'R50', 'PD', 'PW', 'Z4', 'ZD', 'F4C', 'FDC', 'F4J', 'FDJ'])
    expect(RULES.slice(0, 4).map((r) => r.key)).toEqual([
      'R00 Turn quick',
      'R00 Turn hold',
      'R00 Run quick',
      'R00 Run hold',
    ])
    expect(RULES[39].key).toBe('FDJ Run hold')
    RULES.forEach((r, i) => expect(r.index).toBe(i))
  })

  it('read the measure and the trades of the table', () => {
    const [tq, th, rq, rh] = RULE_READINGS
    // DISTANCES are 0.10, 0.25, 0.50, 1.00: quick reads 0.25, hold 1.00.
    expect([tq.measure, tq.k, th.measure, th.k]).toEqual(['turn', 1, 'turn', 3])
    expect([rq.measure, rq.k, rh.measure, rh.k]).toEqual(['run', 1, 'run', 3])
    expect(tq.trades.map((t) => t.name)).toEqual(['T0 quick', 'T1 quick'])
    expect(th.trades.map((t) => t.name)).toEqual(['T0 hold', 'T1 hold'])
    expect(rq.trades).toEqual([{ trade: 2, exit: 0, name: 'B0 quick' }])
    expect(rh.trades).toEqual([{ trade: 2, exit: 1, name: 'B0 hold' }])
  })
})

describe('the rates shown beside a lift', () => {
  // Market A, cell 2010|1: level 3 turns of 4, twins 1 of 2 (rate 0.5); cell 2011|1: level 1 of 2,
  // twins 3 of 4 (0.75). A's rate 4/6 = 66.67, its twins' (4 x 0.5 + 2 x 0.75) / 6 = 58.33,
  // lift 8.33. Market B: level 0 of 1, twins 1 of 4: rate 0, twins 25, lift -25.
  // The kind: rate (66.67 + 0) / 2 = 33.33, twins (58.33 + 25) / 2 = 41.67, lift -8.33.
  const units = [
    u(1, 'A', '2010|1', 2, 3, 1, 2),
    u(2, 'A', '2010|1', 1, 1, 0, 0),
    u(3, 'A', '2011|1', 1, 2, 3, 4),
    u(3, 'B', '2011|1', 0, 1, 1, 4),
    // A week with twins only, and one with nothing decided: no effect on the rates.
    u(4, 'B', '2011|-1', 0, 0, 2, 3),
    u(5, 'A', '2011|1', 0, 0, 0, 0),
  ]

  it('worked out by hand', () => {
    const s = shownRates(units)
    expect(s.markets.A.rate).toBeCloseTo(200 / 3, 10)
    expect(s.markets.A.twinRate).toBeCloseTo(350 / 6, 10)
    expect(s.markets.B.rate).toBe(0)
    expect(s.markets.B.twinRate).toBeCloseTo(25, 10)
    expect(s.rate).toBeCloseTo(100 / 3, 10)
    expect(s.twinRate).toBeCloseTo(125 / 3, 10)
  })

  it("the two rates differ by the lift, the engine's lift", () => {
    const s = shownRates(units)
    expect(s.lift).toBeCloseTo(-25 / 3, 10)
    expect(s.rate - s.twinRate).toBeCloseTo(s.lift, 12)
    expect(s.lift).toBeCloseTo(lift(units), 12)
    for (const m of ['A', 'B'])
      expect(s.markets[m].rate - s.markets[m].twinRate).toBeCloseTo(s.markets[m].lift, 12)
  })

  it('a visit with no twin rate is left out of both rates', () => {
    const s = shownRates([u(1, 'A', '2010|1', 1, 1, 0, 0), u(1, 'A', '2011|1', 0, 1, 1, 2)])
    expect(s.n).toBe(1)
    expect(s.rate).toBe(0)
    expect(s.twinRate).toBe(50)
  })
})

describe('units from cells', () => {
  const v = (turn: number, brk: number, n: number) => {
    const a = new Float64Array(TV.size)
    a[TV.n] = n
    a[TV.turn + 1] = turn
    a[TV.brk + 1] = brk
    return a
  }
  const cell = (
    market: string,
    year: number,
    side: 1 | -1,
    week: number,
    x: Float64Array,
  ): Cell => ({
    market,
    pool: 'PD',
    year,
    side,
    week,
    set: -1,
    v: x,
  })
  const level = [cell('A', 2010, 1, 7, v(1, 0, 2)), cell('A', 2011, 1, 60, v(0, 0, 1))]
  const twin = [cell('A', 2010, 1, 7, v(2, 2, 5)), cell('A', 2010, 1, 8, v(0, 1, 1))]

  it('every week holding a visit of the level or of its twins is a unit, counted or not', () => {
    const us = unitsOf(level, twin, turnMeasure(1), () => true)
    expect(us.length).toBe(3)
    const w60 = us.find((x) => x.week === 60)!
    expect([w60.hits, w60.n, w60.twinHits, w60.twinN]).toEqual([0, 0, 0, 0])
    const w8 = us.find((x) => x.week === 8)!
    expect([w8.hits, w8.n, w8.twinHits, w8.twinN]).toEqual([0, 0, 0, 1])
    expect(us.find((x) => x.week === 7)!.cell).toBe('2010|1')
    expect(unitsOf(level, twin, turnMeasure(1), () => true, { dropEmpty: true }).length).toBe(2)
    expect(unitsOf(level, twin, turnMeasure(1), (_m, y) => y === 2011).length).toBe(1)
  })
})

describe('the choosing bar', () => {
  const base = {
    lift: 2,
    marketsAbove: 5,
    marketsUsed: 7,
    halves: [0.1, 3] as [number, number],
    t: 3,
  }

  it('chooses a rule that meets all four lines, at the bar itself', () => {
    const lines = chooseBar(base)
    expect(lines.map((l) => l.rule)).toEqual([
      'its lift is 2 points or more',
      'the lift is above zero in at least 5 of the 7 markets',
      'the lift is above zero in each half',
      'its t is 3.0 or more',
    ])
    expect(okAll(lines)).toBe(true)
  })

  it('each line fails on its own', () => {
    expect(chooseBar({ ...base, lift: 1.99 }).map((l) => l.ok)).toEqual([false, true, true, true])
    expect(chooseBar({ ...base, marketsAbove: 4 }).map((l) => l.ok)).toEqual([
      true,
      false,
      true,
      true,
    ])
    expect(chooseBar({ ...base, halves: [0, 3] }).map((l) => l.ok)).toEqual([
      true,
      true,
      false,
      true,
    ])
    expect(chooseBar({ ...base, halves: [3, -0.1] })[2].ok).toBe(false)
    expect(chooseBar({ ...base, t: 2.99 }).map((l) => l.ok)).toEqual([true, true, true, false])
    expect(chooseBar({ ...base, t: NaN })[3].ok).toBe(false)
  })

  it('with fewer markets: above zero in more than two thirds of those used', () => {
    // Six markets: 5 is more than 4, 4 is not.
    expect(chooseBar({ ...base, marketsUsed: 6, marketsAbove: 5 })[1].ok).toBe(true)
    expect(chooseBar({ ...base, marketsUsed: 6, marketsAbove: 4 })[1].ok).toBe(false)
    // Three markets: 3 is more than 2, 2 is not.
    expect(chooseBar({ ...base, marketsUsed: 3, marketsAbove: 2 })[1].ok).toBe(false)
    expect(chooseBar({ ...base, marketsUsed: 3, marketsAbove: 3 })[1].ok).toBe(true)
    expect(chooseBar({ ...base, marketsUsed: 6 })[1].rule).toBe(
      'the lift is above zero in more than two thirds of the 6 markets used',
    )
  })
})

describe('the pair candidate', () => {
  it('qualifies with 150 decided visits, a lift of 4, both halves above zero and a t of 3.5', () => {
    const s = { decided: 150, lift: 4, halves: [0.5, 9] as [number, number], t: 3.5 }
    expect(okAll(pairBar(s))).toBe(true)
    expect(okAll(pairBar({ ...s, decided: 149 }))).toBe(false)
    expect(okAll(pairBar({ ...s, lift: 3.99 }))).toBe(false)
    expect(okAll(pairBar({ ...s, halves: [-1, 9] }))).toBe(false)
    expect(okAll(pairBar({ ...s, t: 3.49 }))).toBe(false)
  })

  it('the highest t wins; a tie goes to the kind, then the reading, then the market as listed', () => {
    const r = (kind: string, reading: string, market: string, t: number) => ({
      kind,
      reading,
      market,
      t,
    })
    const rows = [
      r('F4J', 'Turn quick', 'EURUSD', 4),
      r('FDC', 'Run hold', 'XAUUSD', 4),
      r('FDC', 'Turn hold', 'XAUUSD', 4),
      r('FDC', 'Turn hold', 'EURGBP', 4),
      r('FDC', 'Turn hold', 'USDJPY', 4),
      r('R00', 'Turn quick', 'EURUSD', NaN),
      r('ZD', 'Run quick', 'GBPJPY', 4.01),
    ]
    expect(rankByT(rows).map((x) => `${x.kind} ${x.reading} ${x.market}`)).toEqual([
      'ZD Run quick GBPJPY',
      // FDC is listed before F4J (the FC bullet comes first); Turn hold before Run hold;
      // EURGBP, then USDJPY, then gold, as listed under Data.
      'FDC Turn hold EURGBP',
      'FDC Turn hold USDJPY',
      'FDC Turn hold XAUUSD',
      'FDC Run hold XAUUSD',
      'F4J Turn quick EURUSD',
      'R00 Turn quick EURUSD',
    ])
  })
})

describe('the smallest lift this test could have seen', () => {
  it('is the larger of 2 points and 3.0 x the standard error', () => {
    expect(smallestSeen(0.5)).toBe(2)
    expect(smallestSeen(2 / 3)).toBeCloseTo(2, 12)
    expect(smallestSeen(1.2)).toBeCloseTo(3.6, 12)
    expect(smallestSeen(NaN)).toBeNaN()
    expect(notSeenText(3.6)).toBe('not seen at 3.6 points or more')
  })
})

describe('the level lines', () => {
  const s = { lift: 1.5, t: 2, marketsAbove: 4, marketsUsed: 7 }
  it('L1 to L3 at their bars; the pair candidate has no L3', () => {
    expect(levelLines(s, false).map((l) => [l.line, l.ok])).toEqual([
      ['L1', true],
      ['L2', true],
      ['L3', true],
    ])
    expect(levelLines({ ...s, lift: 1.49 }, false)[0].ok).toBe(false)
    expect(levelLines({ ...s, t: 1.99 }, false)[1].ok).toBe(false)
    expect(levelLines({ ...s, marketsAbove: 3 }, false)[2].ok).toBe(false)
    expect(levelLines({ ...s, marketsAbove: 1, marketsUsed: 2 }, false)[2].ok).toBe(false)
    expect(levelLines({ ...s, marketsAbove: 0 }, true).map((l) => l.line)).toEqual(['L1', 'L2'])
  })
})

const facts = (over: Partial<TradeFacts> = {}): TradeFacts => ({
  n: 200,
  target: 100,
  meanAfter: 0.1,
  meanBefore: 0.2,
  meanDouble: 0.01,
  meanPips: 1,
  meanPipsBefore: 2,
  weeks: 150,
  weeklyT: 2.5,
  byYear: {},
  yearsAbove: 5,
  yearsCounted: 7,
  byMarket: {},
  marketsAbove: 4,
  marketsUsed: 7,
  gap: 0.05,
  gapSe: 0.025,
  gapT: 2,
  ...over,
})

describe('the trade lines', () => {
  it('P1 to P6 at their bars', () => {
    const lines = tradeLines(facts(), false, 10)
    expect(lines.map((l) => l.rule)).toEqual([
      'at least 200 trades',
      'a weekly t of 2.5 or more',
      'at least 5 of the 7 years above zero',
      'a gap to its twins above zero, with a t of 2.0 or more',
      'an average result above zero at double cost',
      'more than half of the markets used above zero',
    ])
    expect(okAll(lines)).toBe(true)
    const fails = (o: Partial<TradeFacts>) =>
      tradeLines(facts(o), false, 10)
        .filter((l) => !l.ok)
        .map((l) => l.line)
    expect(fails({ n: 199 })).toEqual(['P1'])
    expect(fails({ weeklyT: 2.49 })).toEqual(['P2'])
    expect(fails({ yearsAbove: 4 })).toEqual(['P3'])
    expect(fails({ gapT: 1.99 })).toEqual(['P4'])
    expect(fails({ gap: 0, gapT: 2.5 })).toEqual(['P4'])
    expect(fails({ meanDouble: 0 })).toEqual(['P5'])
    expect(fails({ marketsAbove: 3 })).toEqual(['P6'])
  })

  it('P2 is 3.0 when more than ten rule and trade pairs go to the check', () => {
    expect(tradeLines(facts({ weeklyT: 2.9 }), false, 10)[1].ok).toBe(true)
    const eleven = tradeLines(facts({ weeklyT: 2.9 }), false, 11)[1]
    expect(eleven.rule).toBe('a weekly t of 3.0 or more')
    expect(eleven.ok).toBe(false)
    expect(tradeLines(facts({ weeklyT: 3 }), false, 11)[1].ok).toBe(true)
  })

  it('the pair candidate: 100 trades, and no P6', () => {
    const lines = tradeLines(facts({ n: 100, marketsAbove: 0 }), true, 3)
    expect(lines.map((l) => l.line)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
    expect(lines[0].rule).toBe('at least 100 trades')
    expect(okAll(lines)).toBe(true)
    expect(tradeLines(facts({ n: 99 }), true, 3)[0].ok).toBe(false)
  })
})

describe('the readings, in their order', () => {
  const line = (ok: boolean): Line => ({ line: 'x', rule: 'x', value: 0, ok })
  const holds = [line(true), line(true), line(true)]
  const fails = [line(true), line(false), line(true)]
  const trade = (name: string, pass: boolean, meanAfter = -0.1, weeklyT = 0, gapT = 0) => ({
    name,
    lines: [line(true), line(pass)],
    meanAfter,
    weeklyT,
    gapT,
  })

  it('"Worth a play account": the level lines hold and one trade passes every trade line', () => {
    const v = verdict(holds, [trade('T0 quick', false), trade('T1 quick', true)])
    expect(v.reading).toBe('Worth a play account')
    expect(v.passing).toEqual(['T1 quick'])
  })

  it('"Positive, not proven": no trade passes, one above zero with weekly t and gap t of 1.5', () => {
    expect(verdict(holds, [trade('T0 quick', false, 0.01, 1.5, 1.5)]).reading).toBe(
      'Positive, not proven',
    )
    expect(verdict(holds, [trade('T0 quick', false, 0.01, 1.49, 1.5)]).reading).toBe(
      'Real but too small to trade',
    )
    expect(verdict(holds, [trade('T0 quick', false, 0.01, 1.5, 1.49)]).reading).toBe(
      'Real but too small to trade',
    )
    expect(verdict(holds, [trade('T0 quick', false, 0, 3, 3)]).reading).toBe(
      'Real but too small to trade',
    )
  })

  it('"Not there" when the level lines fail, with a passing trade printed beside it', () => {
    const v = verdict(fails, [trade('B0 hold', true, 0.2, 4, 4)])
    expect(v.reading).toBe('Not there')
    expect(v.beside).toBe('B0 hold passes every trade line all the same')
    expect(verdict(fails, [trade('B0 hold', false, 0.2, 4, 4)]).beside).toBeNull()
  })

  it("the four readings are tried in the plan's order", () => {
    expect(VERDICTS).toEqual([
      'Worth a play account',
      'Positive, not proven',
      'Real but too small to trade',
      'Not there',
    ])
    // Passing and positive at once: the first reading wins.
    expect(verdict(holds, [trade('T0 hold', true, 0.3, 3, 3)]).reading).toBe('Worth a play account')
  })

  it('a Run rule whose Turn reading at the same distance lifts 2 or more: price moves at this level', () => {
    const [tq, , rq] = RULE_READINGS
    expect(runNote(rq, 2)).toMatch(/^read as "price moves at this level"/)
    expect(runNote(rq, 1.99)).toBeNull()
    expect(runNote(tq, 5)).toBeNull()
  })
})

describe('trades counted from cells', () => {
  const cell = (
    market: string,
    year: number,
    week: number,
    k: number,
    after: number[],
    set = -1,
  ): Cell => {
    const v = new Float64Array(TT_SIZE)
    const o = tradeBlock(0, 0)
    v[o + TT.n] = after.length
    v[o + TT.after] = after.reduce((s, x) => s + x, 0)
    v[o + TT.double] = after.reduce((s, x) => s + x - 0.1, 0)
    v[o + TT.target] = k
    return { market, pool: 'PD', year, side: 1, week, set, v }
  }

  it('weekly t, years and markets above zero, the gap to the twins', () => {
    // Level week sums: 1 (week 1, A 2010), 0 (week 2, A 2011), -1 + 3 = 2 (week 3, A and B 2011).
    const level = [
      cell('A', 2010, 1, 1, [1]),
      cell('A', 2011, 2, 0, [0.5, -0.5]),
      cell('A', 2011, 3, 0, [-1]),
      cell('B', 2011, 3, 1, [3]),
    ]
    const twin = [
      cell('A', 2010, 1, 0, [0, 0]),
      cell('A', 2011, 9, 0, [1]),
      cell('B', 2011, 3, 0, [1, 1]),
    ]
    const f = tradeFacts(level, twin, 0, 0, () => true, [2010, 2011, 2012], ['A', 'B', 'C'], 0)
    expect(f.n).toBe(5)
    expect(f.meanAfter).toBeCloseTo(3 / 5, 12)
    expect(f.meanDouble).toBeCloseTo(2.5 / 5, 12)
    // Weeks 1, 0, 2: mean 1, sd 1, t = 1 / (1 / sqrt 3).
    expect(f.weeks).toBe(3)
    expect(f.weeklyT).toBeCloseTo(Math.sqrt(3), 12)
    expect(f.byYear).toEqual({ 2010: 1, 2011: 2 })
    expect(f.yearsAbove).toBe(2)
    // A sums to 1 + 0 - 1 = 0 (not above zero), B to 3; C has no trade.
    expect(f.byMarket).toEqual({ A: 0, B: 3 })
    expect(f.marketsAbove).toBe(1)
    // Gap: A 2010: 1 - 1 x 0 = 1; A 2011: 0 - 1 - 3 x 1 = -4; B 2011: 3 - 1 x 1 = 2. Sum -1 over 5 trades.
    expect(f.gap).toBeCloseTo(-1 / 5, 12)
  })

  it("ahead of a twin set when the set's average is below; a set with no trade is not passed", () => {
    const sets = [
      cell('A', 2010, -1, 0, [0, 0.1], 0),
      cell('A', 2010, -1, 0, [0.5], 1),
      cell('A', 2011, -1, 0, [-1], 1),
    ]
    const a = aheadOfSets(0.2, sets, 0, 0, () => true, 3)
    expect(a.means[0]).toBeCloseTo(0.05, 12)
    expect(a.means[1]).toBeCloseTo(-0.25, 12)
    expect(a.means[2]).toBeNaN()
    expect(a.ahead).toBe(2)
  })

  it('the rate needed to break even from the average win and loss', () => {
    // W = 0.5, L = -1: p 0.5 + (1 - p)(-1) = 0, p = 2/3.
    const items = [
      { target: true, after: 0.5 },
      { target: false, after: -1 },
      { target: false, after: -1 },
    ]
    expect(breakEvenRate(items)).toBeCloseTo(2 / 3, 12)
    expect(breakEvenRate([{ target: false, after: -1 }])).toBeNaN()
    expect(
      breakEvenRate([
        { target: true, after: 0.2 },
        { target: false, after: 0.1 },
      ]),
    ).toBe(0)
  })
})

describe('Spearman', () => {
  it('1 for the same order, -1 for the reverse, average ranks for ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12)
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12)
    // x ranks 1, 2, 3, 4; y ranks 1.5, 1.5, 3, 4: r = 4.5 / sqrt(5 x 4.5).
    expect(spearman([1, 2, 3, 4], [5, 5, 6, 7])).toBeCloseTo(4.5 / Math.sqrt(22.5), 12)
  })
})

describe('Part 5 and the settled weeks', () => {
  it('changes are matched by candle name and by the candle before', () => {
    const a = pctChanges([1, 2, 3, 4, 5], [100, 101, 100, 102, 101])
    expect(a[0]).toEqual({ name: 2, prev: 1, pct: 1 })
    // b misses candle 3, so its change at 4 spans 2 to 4: left out.
    const b = pctChanges([1, 2, 4, 5], [10, 10.2, 10.1, 10.3])
    const c = changeCorrelation(a, b, () => true)
    // Candles 2 (a +1%, b +2%) and 5 (a -0.98%, b +1.98%): both fall, r = 1.
    expect(c.n).toBe(2)
    expect(c.r).toBeCloseTo(1, 12)
  })

  it('a counting week is settled when it ends at least 7 days before the boundary', () => {
    const b = yearStart(2019)
    // The week starting Saturday 2018-12-15 ends 2018-12-22; 2018-12-22 + 7 days < 2019-01-01.
    const w = (iso: string) => Math.floor((Date.parse(iso) / 1000 - 2 * 86_400) / (7 * 86_400))
    expect(weekSettled(w('2018-12-15T00:00:00Z'), b)).toBe(true)
    expect(weekSettled(w('2018-12-22T00:00:00Z'), b)).toBe(false)
  })
})

describe("level cells from records count like the engine's twin sums", () => {
  // A smooth made-up EUR/USD series (ten-minute stamps) so that levels, twins and visits occur.
  const rows: number[][] = []
  for (let d = 0; d < 60; d++) {
    const day = Date.UTC(2015, 0, 5 + d) / 1000
    const wd = new Date(day * 1000).getUTCDay()
    if (wd === 0 || wd === 6) continue
    for (let m = 0; m < 144; m++) {
      const k = rows.length
      const p = 1.3 + 0.006 * Math.sin(k / 97) + 0.002 * Math.sin(k / 7)
      rows.push([day + m * 600, p, p + 0.0004, p - 0.0004, p])
    }
  }
  const col = (i: number) => Float64Array.from(rows.map((r) => r[i]))
  const bars: Bars = {
    n: rows.length,
    time: col(0),
    open: col(1),
    high: col(2),
    low: col(3),
    close: col(4),
  }
  const run = runLevels(bars, 'EURUSD', { listYear: 2015 })

  it("the twin visits of the year, summed from their records, equal the engine's weekly cells", () => {
    expect(run.twinVisits.length).toBeGreaterThan(100)
    const mine = levelCells('EURUSD', run.twinVisits, (v) => v.kind).visits
    const key = (c: { pool: string; year: number; side: number; week: number }) =>
      `${c.pool}|${c.year}|${c.side}|${c.week}`
    const theirs = new Map(run.twins.visitsByWeek.map((c) => [key(c), c.v]))
    expect(mine.length).toBe(theirs.size)
    for (const c of mine) {
      const t = theirs.get(key(c))!
      expect(t).toBeDefined()
      for (let i = 0; i < TV.size; i++) {
        // The year lists carry no trades, so the T0 fill count is the one field not rebuilt.
        if (i === TV.t0Fill) continue
        expect(c.v[i]).toBeCloseTo(t[i], 9)
      }
    }
  })
})

describe('Order of work point 5: what was settled before the boundary must not change', () => {
  const B = yearStart(2019)
  const visit = (touch: number, done: number | null, over: Partial<VisitRec> = {}) => ({
    market: 'EURUSD',
    kind: 'PD' as const,
    twin: 'level',
    set: -1,
    what: 'high',
    knownFrom: touch - 3600,
    level: 7,
    side: 'below' as const,
    touch,
    year: 2018,
    week: 2500,
    near: 1.2,
    far: 1.2,
    atr: 0.01,
    turns: 0,
    seq: 1,
    leftOut: false,
    dayRangeAtr: 1.1,
    end: 'turn' as const,
    endAt: touch + 60,
    race: ['turn', 'turn', 'break', 'neither'] as VisitRec['race'],
    raceAt: [touch + 60, touch + 60, touch + 600, null],
    m15: 'back' as const,
    m60: 'at' as const,
    howFar: 0.002,
    brkAt: null,
    run: ['none', 'none', 'none', 'none'] as VisitRec['run'],
    runAt: [null, null, null, null],
    done,
    trades: [],
    ...over,
  })
  const t = B - 30 * 86_400

  it('the same settled visits pass, whatever their level id and day range', () => {
    const was = [visit(t, t + 5 * 86_400)]
    const now = [visit(t, t + 5 * 86_400, { level: 99, dayRangeAtr: 2 })]
    expect(settledVisitDiffs(was, now, B)).toEqual({ compared: 1, diffs: [] })
  })

  it('a changed outcome, a missing visit or a new settled visit is caught', () => {
    const was = [visit(t, t + 5 * 86_400), visit(t + 60, t + 86_400)]
    const changed = [visit(t, t + 5 * 86_400, { m60: 'back' }), visit(t + 60, t + 86_400)]
    expect(settledVisitDiffs(was, changed, B).diffs.length).toBe(1)
    expect(settledVisitDiffs(was, [was[0]], B).diffs.length).toBe(1)
    expect(settledVisitDiffs([was[0]], was, B).diffs.length).toBe(1)
    expect(
      settledVisitDiffs(was, [visit(t, t + 5 * 86_400, { near: 1.2 + 2e-9 }), was[1]], B).diffs
        .length,
    ).toBe(1)
    expect(
      settledVisitDiffs(was, [visit(t, t + 5 * 86_400, { near: 1.2 + 5e-10 }), was[1]], B).diffs,
    ).toEqual([])
  })

  it('a visit settled by the end of the data, or after the boundary, is not compared', () => {
    const was = [visit(B - 3600, null)]
    const now = [visit(B - 3600, B + 86_400, { race: ['turn', 'turn', 'turn', 'turn'] })]
    expect(settledVisitDiffs(was, now, B)).toEqual({ compared: 0, diffs: [] })
  })

  it('twin cells of settled weeks must match, except the fields a visit end decides', () => {
    const v = (x: number, end: number) => {
      const a = new Float64Array(TV.size)
      a[TV.n] = x
      a[TV.endTurn] = end
      return a
    }
    const wk = Math.floor((t - 2 * 86_400) / (7 * 86_400))
    const late = Math.floor((B - 3 * 86_400 - 2 * 86_400) / (7 * 86_400))
    const c = (week: number, x: Float64Array): Cell => ({
      market: 'EURUSD',
      pool: 'PD',
      year: 2018,
      side: 1,
      week,
      set: -1,
      v: x,
    })
    const skip = [TV.t0Fill, TV.endTurn, TV.endBreak]
    expect(settledCellDiffs([c(wk, v(3, 0))], [c(wk, v(3, 2))], B, skip, 'x').diffs).toEqual([])
    expect(settledCellDiffs([c(wk, v(3, 0))], [c(wk, v(4, 0))], B, skip, 'x').diffs.length).toBe(1)
    expect(settledCellDiffs([c(wk, v(3, 0))], [], B, skip, 'x').diffs.length).toBe(1)
    // The last weeks before the boundary may still change: not compared.
    expect(settledCellDiffs([c(late, v(3, 0))], [c(late, v(9, 0))], B, skip, 'x')).toEqual({
      compared: 0,
      diffs: [],
    })
  })
})
