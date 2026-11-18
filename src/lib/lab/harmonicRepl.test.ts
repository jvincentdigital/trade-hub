import { describe, expect, it } from 'vitest'
import { HARMONIC_MARKETS, MARKET_COSTS, type HarmonicMarket } from './harmonicFind'
import {
  holdIndex,
  type LeadFigures,
  type LeadTrade,
  type TwinSum,
  type Worth,
} from './harmonicLead'
import {
  dailyCloses,
  dailyCorrelation,
  dateGroups,
  pairDescription,
  pearson,
  pooledFigures,
  pooledTwins,
  READING_NOTES,
  REPL_CANDIDATES,
  REPL_MARKETS,
  REPL_REHEARSAL,
  REPL_SETTINGS,
  replGate,
  replVerdict,
  sumTwins,
  type PooledFigures,
  type ReplGateFacts,
  type ReplSettings,
  type TwinTrade,
} from './harmonicRepl'
import { weeklyT } from './harmonicStats'
import { READINGS, stats, twinMoves, yearStart } from './harmonicStudy'
import type { HarmonicContext, Trade } from './harmonicTrade'

const DAY = 86_400
const S = REPL_SETTINGS

describe('markets and settings', () => {
  it('adds the four yen pairs with their pips and spreads; the study keeps its seven', () => {
    expect(HARMONIC_MARKETS).toEqual([
      'EURUSD',
      'GBPUSD',
      'XAUUSD',
      'USDJPY',
      'EURGBP',
      'EURJPY',
      'GBPJPY',
    ])
    expect(REPL_CANDIDATES).toEqual(['AUDJPY', 'CADJPY', 'NZDJPY', 'CHFJPY'])
    // The pairs used: the candidates, in order, less any step 2 left out; at least 3.
    expect(REPL_MARKETS).toEqual(REPL_CANDIDATES.filter((x) => REPL_MARKETS.includes(x)))
    expect(REPL_MARKETS.length).toBeGreaterThanOrEqual(3)
    expect(new Set(REPL_MARKETS).size).toBe(REPL_MARKETS.length)
    const m = MARKET_COSTS
    expect(REPL_CANDIDATES.map((x) => m[x].spreadAt(1))).toEqual([0.016, 0.025, 0.025, 0.025])
    for (const x of REPL_CANDIDATES) {
      expect(m[x].market).toBe(x)
      expect([m[x].pip, m[x].pen, m[x].slip, m[x].comm]).toEqual([0.01, 0.005, 0.002, 0])
    }
  })
  it('the real settings', () => {
    expect(S.span).toEqual([yearStart(2010), yearStart(2026)])
    expect(S.periods).toEqual([
      [yearStart(2010), yearStart(2019)],
      [yearStart(2019), yearStart(2026)],
    ])
    expect(S.years).toEqual(Array.from({ length: 16 }, (_, i) => 2010 + i))
    expect(S.refuseFrom).toBe(yearStart(2026))
    expect([S.twins, S.minTrades, S.minT, S.minYears, S.minAhead, S.positiveAhead]).toEqual([
      200, 200, 2.5, 12, 190, 100,
    ])
    expect([S.minPairs, S.rehearsal]).toEqual([3, false])
  })
  it('the rehearsal settings', () => {
    const R = REPL_REHEARSAL
    expect(R.pairs).toEqual(['GBPJPY', 'EURJPY'])
    expect(R.span).toEqual([yearStart(2010), yearStart(2019)])
    expect(R.periods).toEqual([
      [yearStart(2010), yearStart(2015)],
      [yearStart(2015), yearStart(2019)],
    ])
    expect(R.years).toEqual([2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018])
    expect([R.twins, R.minTrades, R.minT, R.minYears, R.minAhead, R.positiveAhead]).toEqual([
      20, 200, 2.5, 7, 19, 10,
    ])
    expect([R.minPairs, R.rehearsal, R.label]).toEqual([2, true, 'REHEARSAL'])
  })
})

// ---------------------------------------------------------------- pooled figures

const w = (after: number, how: Worth['how'] = 'close'): Worth => ({
  how,
  after,
  before: after + 0.1,
  double: after - 0.1,
})
/** A lead trade: worth at 24, 48, 72 hours fixed (1, 2, 3), `at120` at 120 hours. */
const lt = (market: HarmonicMarket, dir: 1 | -1, fillTime: number, at120: Worth): LeadTrade => ({
  market,
  dir,
  fillTime,
  worth: [w(9), w(9), w(1), w(2), w(3), at120],
})

describe('pooled figures', () => {
  const P: ReplSettings = {
    ...S,
    pairs: ['AUDJPY', 'CADJPY', 'NZDJPY'],
    years: [2010, 2011, 2012],
    periods: [
      [yearStart(2010), yearStart(2011)],
      [yearStart(2011), yearStart(2013)],
    ],
  }
  const mon = yearStart(2010) + 3 * DAY // Monday 2010-01-04
  const trades = [
    lt('AUDJPY', 1, mon + 3600, w(4)),
    lt('CADJPY', -1, mon + 7200, w(-1, 'stop')), // same week as the first
    lt('AUDJPY', -1, mon + 7 * DAY, w(-1, 'stop')),
    lt('CADJPY', 1, yearStart(2012) + 60, w(1)),
    lt('NZDJPY', 1, yearStart(2012) + 120, w(-1, 'stop')),
  ]
  const f = pooledFigures(trades, P)
  it('trades, averages at each hold, at 120 hours after, before and at double cost', () => {
    expect(f.trades).toBe(5)
    expect(f.holds.map((h) => [h.hours, h.meanAfter])).toEqual([
      [24, 1],
      [48, 2],
      [72, 3],
      [120, 0.4],
    ])
    expect(f.at120.sum).toBe(2)
    expect(f.at120.meanBefore).toBeCloseTo(0.5, 12)
    expect(f.at120.meanDouble).toBeCloseTo(0.3, 12)
    expect(f.holds[3].meanDouble).toBeCloseTo(0.3, 12)
  })
  it('the weekly t sums every pair in one week', () => {
    // Weeks: 4 - 1 = 3; -1; 1 - 1 = 0.
    const want = weeklyT([
      { time: mon, r: 3 },
      { time: mon + 7 * DAY, r: -1 },
      { time: yearStart(2012), r: 0 },
    ])
    expect(f.at120.weeks).toBe(3)
    expect(f.at120.t).toBeCloseTo(want.t, 12)
  })
  it('years, pairs and periods above zero: a year with no trade or a zero sum is not', () => {
    expect(f.byYear.map((y) => [y.year, y.n, y.sum, y.above])).toEqual([
      [2010, 3, 2, true],
      [2011, 0, 0, false],
      [2012, 2, 0, false],
    ])
    expect(f.yearsAbove).toBe(1)
    expect(f.byPair.map((p) => [p.market, p.n, p.sum, p.above])).toEqual([
      ['AUDJPY', 2, 3, true],
      ['CADJPY', 2, 0, false],
      ['NZDJPY', 1, -1, false],
    ])
    expect(f.pairsAbove).toBe(1)
    expect(f.byPeriod.map((p) => [p.n, p.sum, p.above])).toEqual([
      [3, 2, true],
      [2, 0, false],
    ])
    expect(f.periodsAbove).toBe(1)
  })
  it('buys and sells, the stopped share, the ten best', () => {
    expect([f.buys.n, f.buys.sum, f.sells.n, f.sells.sum]).toEqual([3, 4, 2, -2])
    expect(f.stopShare).toBe(3 / 5)
    expect([f.medianAfter, f.best]).toEqual([-1, 4])
    expect(f.tenBest).toEqual({ sum: 2, total: 2, share: 1 })
  })
  it('a pair with no trade is not above zero', () => {
    const g = pooledFigures([lt('AUDJPY', 1, mon, w(1))], P)
    expect(g.byPair.map((p) => p.above)).toEqual([true, false, false])
  })
})

// ---------------------------------------------------------------- lines and readings

/** Pooled figures with only the numbers the lines read; every line holds by default. */
function fig(
  o: {
    n?: number
    t?: number
    mean?: number
    meanBefore?: number
    tBefore?: number
    sumDouble?: number
    yearsAbove?: number
    pairs?: number
    pairsAbove?: number
    periods?: [boolean, boolean]
  } = {},
): PooledFigures {
  const s = stats([])
  const k = o.pairs ?? 4
  const pairs = (['AUDJPY', 'CADJPY', 'NZDJPY', 'CHFJPY'] as HarmonicMarket[]).slice(0, k)
  const pa = o.pairsAbove ?? k
  const ya = o.yearsAbove ?? 16
  const per = o.periods ?? [true, true]
  return {
    pairs,
    trades: o.n ?? 200,
    holds: [],
    at120: {
      ...s,
      n: o.n ?? 200,
      t: o.t ?? 2.5,
      mean: o.mean ?? 0.5,
      meanBefore: o.meanBefore ?? 0.6,
      tBefore: o.tBefore ?? 2.5,
      sumDouble: o.sumDouble ?? 1,
    },
    byYear: S.years.map((year, i) => ({ year, n: 1, sum: 1, above: i < ya })),
    yearsAbove: ya,
    byPair: pairs.map((market, i) => ({ market, n: 1, sum: 1, above: i < pa })),
    pairsAbove: pa,
    byPeriod: S.periods.map((span, i) => ({ span, n: 1, sum: 1, above: per[i] })),
    periodsAbove: per.filter(Boolean).length,
    buys: s,
    sells: s,
    stopShare: NaN,
    medianAfter: NaN,
    best: NaN,
    tenBest: { sum: 0, total: 0, share: NaN },
  }
}
/** 200 twins: `below` of them at `under` per trade (after and before), the rest at `at`. */
const twins = (below: number, under = 0, at = 0.5): TwinSum[] =>
  Array.from({ length: 200 }, (_, i) =>
    i < below
      ? { n: 2, sumAfter: 2 * under, sumBefore: 2 * under }
      : { n: 1, sumAfter: at, sumBefore: at },
  )

describe('the seven lines', () => {
  const ok = (f: PooledFigures, tw = twins(190)) => replVerdict(f, tw, S).lines.map((l) => l.ok)
  const all = [true, true, true, true, true, true, true]
  const but = (i: number) => all.map((x, j) => (j === i ? false : x))

  it('all seven hold at their edges', () => {
    const v = replVerdict(fig(), twins(190), S)
    expect(v.lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(v.lines.map((l) => l.ok)).toEqual(all)
    expect(ok(fig({ yearsAbove: 12, pairsAbove: 3, sumDouble: 0.001 }))).toEqual(all)
    expect(v.aheadAfter).toBe(190)
    expect(v.pass).toBe(true)
    expect(v.lines[2].rule).toBe('at least 12 of the 16 years above zero')
    expect(v.lines[3].rule).toBe('ahead of at least 190 of the 200 pooled twins')
    expect(v.lines[5].rule).toBe('more than half of the 4 pairs above zero (3 of 4)')
    expect(v.lines[6].rule).toBe(
      'above zero in each of the two periods, 2010 to 2018 and 2019 to 2025',
    )
  })
  it('each line fails just past its edge', () => {
    expect(ok(fig({ n: 199 }))).toEqual(but(0))
    expect(ok(fig({ t: 2.4999 }))).toEqual(but(1))
    expect(ok(fig({ t: NaN }))).toEqual(but(1))
    expect(ok(fig({ yearsAbove: 11 }))).toEqual(but(2))
    expect(ok(fig(), twins(189))).toEqual(but(3))
    expect(ok(fig({ sumDouble: 0 }))).toEqual(but(4))
    expect(ok(fig({ pairsAbove: 2 }))).toEqual(but(5))
    expect(ok(fig({ periods: [false, true] }))).toEqual(but(6))
    expect(ok(fig({ periods: [true, false] }))).toEqual(but(6))
  })
  it('line 6 on three pairs: 2 of 3 holds, 1 of 3 does not', () => {
    const v = replVerdict(fig({ pairs: 3, pairsAbove: 2 }), twins(190), S)
    expect(v.lines[5].rule).toBe('more than half of the 3 pairs above zero (2 of 3)')
    expect(v.lines[5].ok).toBe(true)
    expect(ok(fig({ pairs: 3, pairsAbove: 1 }))).toEqual(but(5))
  })
  it('fewer than three pairs: no reading', () => {
    expect(() => replVerdict(fig({ pairs: 2 }), twins(190), S)).toThrow(/at least 3/)
  })
  it('a twin with the same average or with no trade is not passed', () => {
    const tw = twins(190)
    tw[0] = { n: 4, sumAfter: 2, sumBefore: 0 } // 0.5 a trade: the same as ours
    expect(replVerdict(fig(), tw, S).aheadAfter).toBe(189)
    tw[0] = { n: 0, sumAfter: 0, sumBefore: 0 }
    expect(replVerdict(fig(), tw, S).aheadAfter).toBe(189)
  })
  it('ahead before costs is counted on the twins before costs', () => {
    const tw = twins(0, 0, 0.55) // after: all at 0.55 (above our 0.5); before: below our 0.6
    const v = replVerdict(fig(), tw, S)
    expect([v.aheadAfter, v.aheadBefore]).toEqual([0, 200])
  })
})

describe('the reading, tried in order', () => {
  const r = (f: PooledFigures, tw: TwinSum[]) => replVerdict(f, tw, S).reading
  /** Ahead of `after` twins after costs and of `before` before costs. */
  const mixed = (after: number, before: number): TwinSum[] =>
    Array.from({ length: 200 }, (_, i) => ({
      n: 1,
      sumAfter: i < after ? 0 : 0.5,
      sumBefore: i < before ? 0 : 0.6,
    }))

  it('Worth a play account: all seven hold', () => {
    expect(r(fig(), twins(190))).toBe('Worth a play account')
  })
  it('Positive, not proven: a line fails, average above zero, ahead of 100, lines 6 and 7 hold', () => {
    expect(r(fig({ t: 1 }), twins(190))).toBe('Positive, not proven')
    expect(r(fig({ t: 1 }), twins(100))).toBe('Positive, not proven')
    expect(r(fig({ n: 199 }), twins(100))).toBe('Positive, not proven')
    expect(r(fig({ sumDouble: -1 }), twins(190))).toBe('Positive, not proven')
    expect(r(fig({ yearsAbove: 11, mean: 0.001 }), twins(100))).toBe('Positive, not proven')
  })
  it('the border of the middle reading: 99 twins, zero average, line 6 or line 7', () => {
    // Before costs clears 2 and 4 in each case, so each falls to the third reading.
    expect(r(fig({ t: 1 }), mixed(99, 190))).toBe('Real but too small to trade')
    expect(r(fig({ t: 1, mean: 0 }), mixed(190, 190))).toBe('Real but too small to trade')
    expect(r(fig({ pairsAbove: 2 }), mixed(200, 190))).toBe('Real but too small to trade')
    expect(r(fig({ periods: [true, false] }), mixed(200, 190))).toBe('Real but too small to trade')
    expect(r(fig({ pairs: 3, pairsAbove: 1 }), mixed(200, 200))).toBe('Real but too small to trade')
  })
  it('an average of exactly zero is not above zero, even ahead of 190 twins', () => {
    expect(r(fig({ t: 1, mean: 0, meanBefore: 0, tBefore: 1 }), twins(190, -1))).toBe('Not there')
  })
  it("each reading carries the amendment's words for it", () => {
    for (const x of READINGS) expect(READING_NOTES[x].length).toBeGreaterThan(20)
    expect(READING_NOTES['Worth a play account']).toMatch(/two reviewers must fail to break it/)
    expect(READING_NOTES['Positive, not proven']).toMatch(/never as a proven rule/)
    expect(READING_NOTES['Not there']).toMatch(/the lead is closed/)
  })
  it('the border of the third reading: t before costs and 190 twins before costs', () => {
    expect(r(fig({ t: 1, mean: 0, tBefore: 2.4999 }), mixed(190, 190))).toBe('Not there')
    expect(r(fig({ t: 1, mean: 0 }), mixed(190, 189))).toBe('Not there')
    expect(r(fig({ t: 1, mean: -0.2 }), mixed(0, 0))).toBe('Not there')
  })
})

// ---------------------------------------------------------------- twins

describe('the pooled twins', () => {
  const D0 = Math.floor(yearStart(2015) / DAY) // a UTC day number
  /** A fake context: only the stamps that exist. */
  const ctx = (stamps: number[]) =>
    ({
      bars: { n: stamps.length, time: Float64Array.from([...stamps].sort((a, b) => a - b)) },
    }) as unknown as HarmonicContext
  /** Every day from -10 to +10 around a fill. */
  const around = (fill: number) => Array.from({ length: 21 }, (_, i) => fill + (i - 10) * DAY)
  const tr = (fillTime: number) => ({ fillTime }) as Trade
  /** Worth after = the days the twin moved; before = 10 x that. */
  const moved = (c: HarmonicContext, t: Trade, m: number): Worth => {
    const d = (c.bars.time[m] - t.fillTime) / DAY
    return { how: 'close', after: d, before: 10 * d, double: d }
  }

  it('groups by UTC fill date in ascending order, whatever the order of the trades', () => {
    const t = [(D0 + 3) * DAY + 5, D0 * DAY + 100, (D0 + 3) * DAY + 86_399, D0 * DAY]
    expect(dateGroups(t)).toEqual({ dates: [D0, D0 + 3], ofTrade: [1, 0, 1, 0] })
  })

  it("two pairs' trades on one date take the same move; the draw order is by date", () => {
    const a1 = D0 * DAY + 10 * 3600
    const b1 = D0 * DAY + 15 * 3600
    const a2 = (D0 + 3) * DAY + 9 * 3600
    // Listed later date first, so a draw order by list would differ.
    const trades: TwinTrade[] = [
      { market: 'AUDJPY', t: tr(a2), ctx: ctx([...around(a1), ...around(a2)]) },
      { market: 'CADJPY', t: tr(b1), ctx: ctx(around(b1)) },
      { market: 'AUDJPY', t: tr(a1), ctx: ctx([...around(a1), ...around(a2)]) },
    ]
    const got = pooledTwins(trades, 30, moved)
    got.forEach((s, i) => {
      const m = twinMoves(i + 1, 2)
      expect(s.n).toBe(3)
      expect(s.sumAfter).toBe(2 * m[0] + m[1])
      expect(s.sumBefore).toBe(10 * (2 * m[0] + m[1]))
    })
    // Over 30 seeds the two dates do not always get the same move.
    expect(got.some((s, i) => twinMoves(i + 1, 2)[0] !== twinMoves(i + 1, 2)[1])).toBe(true)
  })

  it("a missing minute is looked for in the trade's own pair; a left-out trade counts in neither", () => {
    const fill = D0 * DAY + 10 * 3600
    const seed = 1
    const m = twinMoves(seed, 1)[0]
    const step = Math.sign(m)
    // Pair A has every day; pair B lacks the moved day and has the next one the same way;
    // pair C has only its own fill minute, so every try fails.
    const b = around(fill).filter((s) => s !== fill + m * DAY)
    const trades: TwinTrade[] = [
      { market: 'AUDJPY', t: tr(fill), ctx: ctx(around(fill)) },
      { market: 'CADJPY', t: tr(fill), ctx: ctx(b) },
      { market: 'NZDJPY', t: tr(fill), ctx: ctx([fill]) },
    ]
    const [s] = pooledTwins(trades, 1, moved)
    expect(s.n).toBe(2)
    expect(s.sumAfter).toBe(m + (m + step))
    expect(s.sumBefore).toBe(10 * (m + (m + step)))
  })

  it("the plan's way, summed seed by seed", () => {
    const a: TwinSum[] = [
      { n: 2, sumAfter: 1, sumBefore: 2 },
      { n: 1, sumAfter: -1, sumBefore: 0 },
    ]
    const b: TwinSum[] = [
      { n: 3, sumAfter: 0.5, sumBefore: 1 },
      { n: 0, sumAfter: 0, sumBefore: 0 },
    ]
    expect(sumTwins([a, b])).toEqual([
      { n: 5, sumAfter: 1.5, sumBefore: 3 },
      { n: 1, sumAfter: -1, sumBefore: 0 },
    ])
    expect(() => sumTwins([a, b.slice(1)])).toThrow()
  })
})

describe('each pair alone (description)', () => {
  it('years above zero, ahead after and before costs, double cost', () => {
    const s = { ...stats([]), mean: 0.3, meanBefore: 0.4, sumDouble: -2 }
    const f = {
      at120: s,
      byYear: [
        { year: 2010, n: 2, sum: 1 },
        { year: 2011, n: 0, sum: 0 },
        { year: 2012, n: 1, sum: -1 },
      ],
    } as unknown as LeadFigures
    const tw: TwinSum[] = [
      { n: 1, sumAfter: 0.2, sumBefore: 0.5 }, // passed after, not before
      { n: 2, sumAfter: 0.6, sumBefore: 0.6 }, // 0.3 a trade: equal after (not passed), passed before
      { n: 0, sumAfter: 0, sumBefore: 0 }, // no trade: never passed
    ]
    const d = pairDescription(f, tw)
    expect([d.yearsAbove, d.aheadAfter, d.aheadBefore, d.sumDouble]).toEqual([1, 1, 1, -2])
  })
})

// ---------------------------------------------------------------- correlation

describe('the daily correlation', () => {
  it('the last close of each UTC date inside the span', () => {
    const d = yearStart(2010) / DAY
    const t = [d * DAY - 60, d * DAY, d * DAY + 3600, (d + 1) * DAY + 60, (d + 2) * DAY]
    const bars = { n: 5, time: Float64Array.from(t), close: Float64Array.from([1, 2, 3, 4, 5]) }
    const c = dailyCloses(bars, [yearStart(2010), (d + 2) * DAY])
    expect([...c.entries()]).toEqual([
      [d, 3],
      [d + 1, 4],
    ])
  })
  it('pearson by hand: (1, 2, 3) with (1, 3, 2) is 0.5', () => {
    expect(pearson([1, 2, 3], [1, 3, 2])).toBeCloseTo(0.5, 12)
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12)
    expect(pearson([1], [1])).toBeNaN()
    expect(pearson([1, 1], [1, 2])).toBeNaN()
  })
  it('changes in percent over dates present in both', () => {
    // a: +1%, +2%, +3% day by day; b: +1%, +3%, +2%; a date only in a is skipped.
    const a = new Map([
      [0, 100],
      [1, 101],
      [2, 103.02],
      [3, 106.1106],
      [9, 50],
    ])
    const b = new Map([
      [0, 200],
      [1, 202],
      [2, 208.06],
      [3, 212.2212],
    ])
    const c = dailyCorrelation(a, b)
    expect([c.dates, c.changes]).toEqual([4, 3])
    expect(c.r).toBeCloseTo(0.5, 9)
    // Dropping day 2 from b: both change from day 1 to day 3 in one step.
    b.delete(2)
    const g = dailyCorrelation(a, b)
    expect([g.dates, g.changes]).toEqual([3, 2])
    // a: +1%, +5.06%; b: +1%, +5.06%: the same changes.
    expect(g.r).toBeCloseTo(1, 9)
  })
})

// ---------------------------------------------------------------- gate

describe('the gate before the one run', () => {
  const base: ReplGateFacts = {
    afterError: false,
    pairs: ['AUDJPY', 'CADJPY', 'NZDJPY', 'CHFJPY'],
    minPairs: 3,
    present: ['CHFJPY', 'AUDJPY', 'NZDJPY', 'CADJPY'],
    reference: true,
    marker: false,
    marker2: false,
    done: false,
    outHasResults: false,
    firstAlive: false,
    errorNote: false,
  }
  const g = (o: Partial<ReplGateFacts>) => replGate({ ...base, ...o })
  it('writes the first marker when everything is there', () => {
    expect(g({})).toEqual({ write: 1 })
  })
  it('refuses a missing file, a file of a pair left out, no reference, results already there', () => {
    expect(g({ present: ['AUDJPY', 'CADJPY', 'NZDJPY'] })).toHaveProperty('refuse')
    expect(g({ pairs: ['AUDJPY', 'CADJPY', 'NZDJPY'] })).toHaveProperty('refuse')
    expect(
      g({ pairs: ['AUDJPY', 'CADJPY', 'NZDJPY'], present: ['AUDJPY', 'CADJPY', 'NZDJPY'] }),
    ).toEqual({ write: 1 })
    expect(g({ reference: false })).toHaveProperty('refuse')
    expect(g({ outHasResults: true })).toHaveProperty('refuse')
  })
  it('refuses fewer than three pairs', () => {
    expect(g({ pairs: ['AUDJPY', 'CADJPY'], present: ['AUDJPY', 'CADJPY'] })).toHaveProperty(
      'refuse',
    )
  })
  it('refuses a second run', () => {
    expect(g({ marker: true })).toHaveProperty('refuse')
  })
  it('after an error: the first marker must exist, the second must not', () => {
    const e = { afterError: true, errorNote: true }
    expect(g(e)).toHaveProperty('refuse')
    expect(g({ ...e, marker: true })).toEqual({ write: 2 })
    expect(g({ ...e, marker: true, marker2: true })).toHaveProperty('refuse')
    expect(g({ ...e, marker: true, outHasResults: true })).toHaveProperty('refuse')
  })
  it('after an error: no second run once a figure is written, while the first goes on, or with no note', () => {
    const e = { afterError: true, marker: true, errorNote: true }
    expect(g({ ...e, done: true })).toEqual({
      refuse: 'a run already wrote its figures: REPL-DONE.json exists',
    })
    expect(g({ ...e, firstAlive: true })).toEqual({ refuse: 'the first run is still going' })
    expect(g({ ...e, errorNote: false })).toHaveProperty('refuse')
    expect(g({ done: true })).toHaveProperty('refuse')
  })
})

it('holds are read at the engine index of 120 hours', () => {
  expect(holdIndex(120)).toBe(5)
})
