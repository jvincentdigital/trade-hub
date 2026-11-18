import { describe, expect, it } from 'vitest'
import { buildChart, type Bars, type HarmonicMarket, type MarketCosts } from './harmonicFind'
import {
  holdIndex,
  leadFigures,
  leadVerdict,
  selectLead,
  spanYears,
  stopShare,
  tenBest,
  twinWorth,
  type LeadFigures,
  type LeadTrade,
  type TwinSum,
  type Worth,
} from './harmonicLead'
import type { HarmonicContext, Trade } from './harmonicTrade'
import { REAL_PERIODS, REHEARSAL_PERIODS, stats, yearStart } from './harmonicStudy'

const T0 = Date.UTC(2020, 0, 6) / 1000 // Monday 00:00 UTC
const H = 3600

/** Plain units, exact binary fractions: spread 0.75, slip 0.25, pip 1. */
const TESTC: MarketCosts = {
  market: 'GBPJPY',
  pip: 1,
  pen: 0.5,
  slip: 0.25,
  comm: 0,
  spreadAt: () => 0.75,
}

type Row = [number, number, number, number, number]

function ctxOf(rows: Row[]): HarmonicContext {
  const col = (k: number) => Float64Array.from(rows.map((r) => r[k]))
  const bars: Bars = {
    n: rows.length,
    time: col(0),
    open: col(1),
    high: col(2),
    low: col(3),
    close: col(4),
  }
  const chart = buildChart(bars, 15)
  return {
    bars,
    costs: TESTC,
    chart,
    rsi: new Float64Array(chart.n),
    ema20: new Float64Array(chart.n),
    four: {
      n: 0,
      start: new Float64Array(0),
      end: new Float64Array(0),
      close: new Float64Array(0),
      ema50: new Float64Array(0),
    },
  }
}

/** The fields of a trade its twin uses: direction, R and the entry slip (none: an order at D). */
const trade = (dir: 1 | -1, R = 10) => ({ dir, R, entrySlip: 0 }) as Trade

describe('selecting the lead trades', () => {
  const t = (entry: string, status: string, fillTime: number, look: object | null = {}) =>
    ({ entry, status, fillTime, look }) as unknown as Trade
  const span: [number, number] = [yearStart(2010), yearStart(2019)]
  const x = (market: HarmonicMarket, tr: Trade) => ({ market, t: tr })
  const all = [
    x('GBPJPY', t('E0', 'filled', yearStart(2010))), // kept: first second of the span
    x('GBPJPY', t('E0', 'filled', yearStart(2019) - 60)), // kept: last minute of 2018
    x('GBPJPY', t('E0', 'filled', yearStart(2019))), // 2019: out
    x('GBPJPY', t('E0', 'filled', yearStart(2010) - 60)), // 2009: out
    x('GBPJPY', t('C1', 'filled', yearStart(2012))), // a confirmed entry: out
    x('GBPJPY', t('C2', 'filled', yearStart(2012))),
    x('GBPJPY', t('E0', 'skipRisk', yearStart(2012))), // skipped: out
    x('EURJPY', t('E0', 'filled', yearStart(2012))), // the other market
  ]
  it('keeps filled orders at D of the market, fill minute in [from, to)', () => {
    expect(selectLead(all, 'GBPJPY', span).map((s) => all.indexOf(s))).toEqual([0, 1])
    expect(selectLead(all, 'EURJPY', span).map((s) => all.indexOf(s))).toEqual([7])
  })
  it('years of a span', () => {
    expect(spanYears(span)).toEqual([2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018])
    expect(spanYears(REHEARSAL_PERIODS.check)).toEqual([2015, 2016, 2017, 2018])
  })
})

describe("a twin's 120-hour worth: lookBack on the twin's position", () => {
  // Twin entry at minute 1's open; the trade's R (10) is kept.
  it('a buy that is stopped keeps its stop result', () => {
    const ctx = ctxOf([
      [T0, 50, 50, 50, 50],
      [T0 + H, 100, 100, 100, 100], // entry Bid 100, Ask 100.75, stop 90.75
      [T0 + 2 * H, 95, 96, 90, 91], // Bid low 90: the stop, filled at 90.75
      [T0 + 120 * H + 3600, 120, 120, 120, 120],
      [T0 + 130 * H, 120, 120, 120, 120],
    ])
    const w = twinWorth(ctx, trade(1), 1)
    expect(w.how).toBe('stop')
    expect(w.after).toBeCloseTo((90.75 - 100.75 - 0.25) / 10, 12) // -1.025
    expect(w.before).toBeCloseTo(-1.025 + (0.75 + 0.25) / 10, 12)
    expect(w.double).toBeCloseTo(-1.025 - (0.75 + 0.25) / 10, 12)
  })
  it('a buy still open at 120 hours closes at the Bid open of the first minute at or after it', () => {
    const ctx = ctxOf([
      [T0, 50, 50, 50, 50],
      [T0 + H, 100, 100, 100, 100],
      [T0 + 60 * H, 95, 99, 91, 98], // low 91 stays above the stop 90.75
      [T0 + 121 * H - 60, 104, 104, 104, 104], // 119 h 59 min after the entry: too early
      [T0 + 121 * H + 60, 105, 105, 80, 80], // first at or after 120 h: closes at its open
      [T0 + 130 * H, 80, 80, 80, 80],
    ])
    const w = twinWorth(ctx, trade(1), 1)
    expect(w.how).toBe('close')
    expect(w.after).toBeCloseTo((105 - 100.75 - 0.25) / 10, 12) // 0.4
    expect(w.before).toBeCloseTo(0.5, 12)
  })
  it('a sell still open at 120 hours closes at the Ask', () => {
    const ctx = ctxOf([
      [T0, 50, 50, 50, 50],
      [T0 + H, 100, 100, 100, 100], // entry Bid 100, stop 110
      [T0 + 50 * H, 99, 109, 97, 98], // Ask high 109.75: below the stop
      [T0 + 121 * H, 96, 96, 96, 96], // Ask open 96.75
      [T0 + 130 * H, 96, 96, 96, 96],
    ])
    const w = twinWorth(ctx, trade(-1), 1)
    expect(w.how).toBe('close')
    expect(w.after).toBeCloseTo((100 - 96.75 - 0.25) / 10, 12) // 0.3
  })
})

describe('stopped share and the ten best', () => {
  const w = (how: Worth['how'], after: number): Worth => ({ how, after, before: 0, double: 0 })
  const lt = (how: Worth['how'], after: number): LeadTrade => ({
    market: 'GBPJPY',
    dir: 1,
    fillTime: T0,
    worth: [0, 1, 2, 3, 4, 5].map((i) => (i === holdIndex(120) ? w(how, after) : w('close', 0))),
  })
  it('the share that ended at their stop at 120 hours', () => {
    expect(stopShare([lt('stop', -1), lt('stop', -1), lt('close', 3), lt('time', 1)])).toBe(0.5)
    expect(stopShare([])).toBeNaN()
  })
  it("the ten best results' sum and its part of the whole sum", () => {
    // Twelve trades: 1 to 10 (sum 55) and two losers of -10 (total 35).
    const r = [...Array.from({ length: 10 }, (_, i) => i + 1), -10, -10]
    expect(tenBest(r)).toEqual({ sum: 55, total: 35, share: 55 / 35 })
    // Fewer than ten: all of them.
    expect(tenBest([2, -1])).toEqual({ sum: 1, total: 1, share: 1 })
    expect(tenBest([1, -1]).share).toBeNaN()
  })
})

describe("one market's figures", () => {
  const w = (after: number, how: Worth['how'] = 'close'): Worth => ({
    how,
    after,
    before: after + 0.1,
    double: after - 0.1,
  })
  const lt = (dir: 1 | -1, fillTime: number, at120: Worth): LeadTrade => ({
    market: 'GBPJPY',
    dir,
    fillTime,
    worth: [w(9), w(9), w(1), w(2), w(3), at120],
  })
  const f = leadFigures(
    'GBPJPY',
    [
      lt(1, yearStart(2019) + 60, w(-1, 'stop')),
      lt(-1, yearStart(2019) + 8 * 86_400, w(5)),
      lt(1, yearStart(2021) + 60, w(-1, 'stop')),
    ],
    [2019, 2020, 2021],
  )
  it('holds at 24 to 120 hours, the 120-hour sums by year and by direction', () => {
    expect(f.trades).toBe(3)
    expect(f.holds.map((h) => [h.hours, h.meanAfter])).toEqual([
      [24, 1],
      [48, 2],
      [72, 3],
      [120, 1],
    ])
    expect(f.at120.sum).toBe(3)
    expect(f.at120.meanBefore).toBeCloseTo(1.1, 12)
    expect(f.at120.sumDouble).toBeCloseTo(2.7, 12)
    expect(f.byYear).toEqual([
      { year: 2019, n: 2, sum: 4 },
      { year: 2020, n: 0, sum: 0 },
      { year: 2021, n: 1, sum: -1 },
    ])
    expect([f.buys.n, f.buys.sum, f.sells.n, f.sells.sum]).toEqual([2, -2, 1, 5])
    expect([f.stopShare, f.medianAfter, f.best]).toEqual([2 / 3, -1, 5])
    expect(f.tenBest).toEqual({ sum: 3, total: 3, share: 1 })
  })
})

describe('the five lines and the reading', () => {
  const P = REAL_PERIODS
  /** Figures with the numbers the lines read. */
  const fig = (o: {
    n?: number
    t?: number
    mean?: number
    meanBefore?: number
    tBefore?: number
    sumDouble?: number
    yearsAbove?: number
  }): LeadFigures => {
    const s = stats([])
    const ya = o.yearsAbove ?? 7
    return {
      market: 'GBPJPY',
      trades: o.n ?? 100,
      holds: [],
      at120: {
        ...s,
        n: o.n ?? 100,
        t: o.t ?? 2.5,
        mean: o.mean ?? 0.5,
        meanBefore: o.meanBefore ?? 0.6,
        tBefore: o.tBefore ?? 2.5,
        sumDouble: o.sumDouble ?? 1,
      },
      byYear: P.checkYears.map((year, i) => ({ year, n: 1, sum: i < ya ? 1 : 0 })),
      buys: s,
      sells: s,
      stopShare: NaN,
      medianAfter: NaN,
      best: NaN,
      tenBest: { sum: 0, total: 0, share: NaN },
    }
  }
  /** 200 twins: `below` of them under `under` (after and before), the rest at `at`. */
  const twins = (below: number, under = 0, at = 0.5): TwinSum[] =>
    Array.from({ length: 200 }, (_, i) =>
      i < below
        ? { n: 1, sumAfter: under, sumBefore: under }
        : { n: 1, sumAfter: at, sumBefore: at },
    )
  const ok = (f: LeadFigures, tw = twins(190)) => leadVerdict(f, tw, P).lines.map((l) => l.ok)

  it('all five hold at their edges', () => {
    const v = leadVerdict(fig({}), twins(190), P)
    expect(v.lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5])
    expect(v.lines.every((l) => l.ok)).toBe(true)
    expect(v.pass).toBe(true)
    expect(v.reading).toBe('Worth a play account')
  })
  it('each line fails just past its edge', () => {
    expect(ok(fig({ n: 99 }))).toEqual([false, true, true, true, true])
    expect(ok(fig({ t: 2.4999 }))).toEqual([true, false, true, true, true])
    expect(ok(fig({ yearsAbove: 4 }))).toEqual([true, true, false, true, true])
    expect(ok(fig({}), twins(189))).toEqual([true, true, true, false, true])
    expect(ok(fig({ sumDouble: 0 }))).toEqual([true, true, true, true, false])
  })
  it('a twin with the same average is not passed; a twin with no trade is not passed', () => {
    const tw = twins(190)
    tw[0] = { n: 1, sumAfter: 0.5, sumBefore: 0.5 }
    expect(leadVerdict(fig({}), tw, P).aheadAfter).toBe(189)
    tw[0] = { n: 0, sumAfter: 0, sumBefore: 0 }
    expect(leadVerdict(fig({}), tw, P).aheadAfter).toBe(189)
  })
  it('the readings, tried in order', () => {
    const r = (f: LeadFigures, tw: TwinSum[]) => leadVerdict(f, tw, P).reading
    // Fails line 2 but above zero and ahead of 100 twins (it would also clear 2 and 4 before costs).
    expect(r(fig({ t: 1 }), twins(190))).toBe('Positive, not proven')
    expect(r(fig({ t: 1 }), twins(100))).toBe('Positive, not proven')
    // Ahead of only 99: before costs it clears lines 2 and 4 against before-cost twins.
    const mixed = twins(99).map((x, i) =>
      i < 190 ? { ...x, sumBefore: 0 } : { ...x, sumBefore: 0.6 },
    )
    expect(r(fig({ t: 1 }), mixed)).toBe('Real but too small to trade')
    // At zero after costs it is not "positive", whatever the twins.
    expect(r(fig({ t: 1, mean: 0 }), mixed)).toBe('Real but too small to trade')
    expect(r(fig({ t: 1, tBefore: 2.4999 }), mixed)).toBe('Not there')
    expect(r(fig({ t: 1, mean: 0 }), twins(0, 0, 0.7))).toBe('Not there')
  })
})
