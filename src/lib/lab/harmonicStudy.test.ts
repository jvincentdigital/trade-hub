import { describe, expect, it } from 'vitest'
import type { Pattern } from './harmonic'
import {
  aboveZero,
  aheadOf,
  enumerateVersions,
  inEntry,
  mulberry32,
  NO_SWEET_SPOT,
  part1Rows,
  passLines,
  qualifiedRanking,
  rankRows,
  ranks,
  reading,
  READINGS,
  REAL_PERIODS,
  REHEARSAL_PERIODS,
  spearman,
  stats,
  sweetSpot,
  thirds,
  TWIN_MOVES,
  twinGroups,
  twinMoves,
  twinStamp,
  versionRows,
  VERSIONS,
  yearStart,
  type PassFacts,
  type Stats,
  type TradeRec,
} from './harmonicStudy'

const DAY = 86_400
const u = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m, d, h) / 1000

/** A filled record whose seven exits all give `r` after costs (before = r + 0.1, double = r - 0.1). */
function rec(over: Partial<TradeRec> & { r?: number } = {}): TradeRec {
  const r = over.r ?? 0
  const o = {
    how: 'target' as const,
    time: 0,
    after: r,
    before: r + 0.1,
    double: r - 0.1,
    slips: 0,
  }
  const base: TradeRec = {
    uid: 0,
    id: 'x',
    market: 'EURUSD',
    chart: 15,
    k: 2,
    pattern: 'butterfly',
    dir: 1,
    entry: 'E0',
    status: 'filled',
    trend: false,
    hours: false,
    x: { time: 0, price: 0 },
    a: { time: 0, price: 0 },
    b: { time: 0, price: 0 },
    c: { time: 0, price: 0 },
    confirmTime: 0,
    confirmClose: 0,
    completeTime: over.fillTime ?? 0,
    rB: 0,
    rC: 0,
    proj: 0,
    d: 1,
    stop: 0.99,
    ofC: 1,
    triggerTime: null,
    fillTime: u(2012, 0, 4),
    entryPrice: 1,
    entryBid: 1,
    spread: 0,
    cost: 0,
    R: 0.01,
    rPips: 100,
    entrySlip: 0,
    target1: 1.01,
    target2: 1.02,
    exits: Array.from({ length: 7 }, () => ({ ...o })),
    look: null,
  }
  const { r: _r, ...rest } = over
  void _r
  return { ...base, ...rest }
}

const S = (over: Partial<Stats>): Stats => ({
  n: 1,
  sum: 0,
  mean: 0,
  sumBefore: 0,
  meanBefore: 0,
  sumDouble: 0,
  meanDouble: 0,
  wonBefore: 0,
  weeks: 1,
  t: 0,
  tBefore: 0,
  ...over,
})

describe('the 336 versions', () => {
  it('enumerates exactly 336, unique, in the tie order of Amendment 3 point 9', () => {
    const v = enumerateVersions()
    expect(v).toHaveLength(336)
    expect(VERSIONS).toHaveLength(336)
    expect(new Set(v.map((x) => x.key)).size).toBe(336)
    v.forEach((x, i) => expect(x.index).toBe(i))
    expect(v[0].key).toBe('butterfly-15m-k2-E0-X1')
    expect(v[1].key).toBe('butterfly-15m-k2-E0-X2')
    expect(v[7].key).toBe('butterfly-15m-k2-C1-X1')
    expect(v[42].key).toBe('butterfly-15m-k3-E0-X1')
    expect(v[84].key).toBe('butterfly-30m-k2-E0-X1')
    expect(v[168].key).toBe('all-15m-k2-E0-X1')
    expect(v[335].key).toBe('all-30m-k3-C5-X7')
  })
  it('maps C3, C4 and C5 onto the trend and hours flags', () => {
    const e0 = rec({ entry: 'E0', trend: true, hours: false })
    expect(inEntry(e0, 'E0')).toBe(true)
    expect(inEntry(e0, 'C3')).toBe(true)
    expect(inEntry(e0, 'C4')).toBe(false)
    expect(inEntry(e0, 'C5')).toBe(false)
    const c1 = rec({ entry: 'C1', trend: true, hours: true })
    expect(inEntry(c1, 'C1')).toBe(true)
    expect(inEntry(c1, 'C5')).toBe(true)
    expect(inEntry(c1, 'C3')).toBe(false)
    expect(inEntry(c1, 'C4')).toBe(false)
    expect(inEntry(rec({ entry: 'C2', trend: true }), 'C5')).toBe(false)
  })
})

describe('qualification and ranking', () => {
  const halves = REAL_PERIODS.halves
  const span = REAL_PERIODS.choose
  it('needs the trade count and a sum above zero in both halves', () => {
    // 2 trades in each half, both halves above zero: qualifies with 4 trades.
    const good = [
      rec({ fillTime: u(2011, 0, 5), r: 1 }),
      rec({ fillTime: u(2012, 0, 5), r: -0.5 }),
      rec({ fillTime: u(2016, 0, 5), r: 0.2 }),
      rec({ fillTime: u(2017, 0, 5), r: 0.1 }),
    ]
    const rows = versionRows(good, 'ALL', span, halves, 4)
    const v = rows[0] // butterfly-15m-k2-E0-X1
    expect(v.all.n).toBe(4)
    expect(v.halves[0].sum).toBeCloseTo(0.5, 12)
    expect(v.halves[1].sum).toBeCloseTo(0.3, 12)
    expect(v.qualifies).toBe(true)
    // The "all four" version holds the butterfly trades too.
    expect(rows[168].all.n).toBe(4)
    // One trade fewer than the minimum: does not qualify.
    expect(versionRows(good, 'ALL', span, halves, 5)[0].qualifies).toBe(false)
    // A half at exactly zero, or with no trade, is not above zero.
    const zero = [...good.slice(0, 2), rec({ fillTime: u(2016, 0, 5), r: 0 })]
    expect(versionRows(zero, 'ALL', span, halves, 1)[0].qualifies).toBe(false)
    expect(versionRows(good.slice(0, 2), 'ALL', span, halves, 1)[0].qualifies).toBe(false)
    // A trade before 2010 or a skip does not count; skips are counted apart.
    const extra = [
      ...good,
      rec({ fillTime: u(2009, 5, 1), r: 5 }),
      rec({ fillTime: u(2013, 5, 1), status: 'skipRisk', exits: null }),
    ]
    const r2 = versionRows(extra, 'ALL', span, halves, 4)[0]
    expect(r2.all.n).toBe(4)
    expect(r2.skips).toBe(1)
    // A gartley trade is in "all four" only.
    const g = versionRows([rec({ pattern: 'gartley', r: 1 })], 'ALL', span, halves, 1)
    expect(g[0].all.n).toBe(0)
    expect(g[168].all.n).toBe(1)
  })
  it('ranks by weekly t, ties to the earlier version then the earlier market, no t last', () => {
    const row = (index: number, t: number, market: 'ALL' | 'EURUSD' | 'GBPUSD' = 'ALL') => ({
      index,
      market,
      key: String(index),
      all: S({ t }),
      halves: [S({}), S({})] as [Stats, Stats],
      skips: 0,
      qualifies: true,
    })
    const r = rankRows([row(5, 1), row(3, 2), row(9, NaN), row(1, 1), row(4, 2)])
    expect(r.map((x) => x.index)).toEqual([3, 4, 1, 5, 9])
    const m = rankRows([row(2, 1, 'GBPUSD'), row(2, 1, 'EURUSD'), row(1, 1, 'GBPUSD')])
    expect(m.map((x) => `${x.index}${x.market}`)).toEqual(['1GBPUSD', '2EURUSD', '2GBPUSD'])
    const q = qualifiedRanking([{ ...row(0, 9), qualifies: false }, row(1, 1)])
    expect(q.map((x) => x.index)).toEqual([1])
  })
})

describe('weekly t and stats', () => {
  it('sums each week by fill minute and divides the mean by sd / sqrt(weeks)', () => {
    // Weeks from Saturday: 2015-01-05 and 01-09 share a week (sum 1), then 2, then 3.
    const s = stats([
      { time: u(2015, 0, 5), after: 0.5, before: 1, double: 0 },
      { time: u(2015, 0, 9), after: 0.5, before: 1, double: 0 },
      { time: u(2015, 0, 12), after: 2, before: 1, double: 0 },
      { time: u(2015, 0, 26), after: 3, before: -1, double: 0 },
    ])
    expect(s.n).toBe(4)
    expect(s.weeks).toBe(3)
    expect(s.mean).toBe(1.5)
    expect(s.t).toBeCloseTo(2 * Math.sqrt(3), 12)
    expect(s.wonBefore).toBe(0.75)
    expect(s.meanBefore).toBe(0.5)
  })
  it('above zero: a sum above zero; no trade is not above zero', () => {
    expect(aboveZero({ n: 0, sum: 0 })).toBe(false)
    expect(aboveZero({ n: 2, sum: 0 })).toBe(false)
    expect(aboveZero({ n: 2, sum: 1e-12 })).toBe(true)
  })
})

describe('Spearman', () => {
  it('is 1, -1, and uses average ranks for ties', () => {
    expect(spearman([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12)
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12)
    expect(ranks([5, 1, 5, 3])).toEqual([3.5, 1, 3.5, 2])
    // x ranks 1, 2.5, 2.5, 4 against 1, 2, 3, 4: 4.5 / sqrt(4.5 x 5).
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(4.5 / Math.sqrt(22.5), 12)
    expect(spearman([1], [1])).toBeNaN()
  })
})

describe('pass lines and readings', () => {
  const P = REAL_PERIODS
  const facts: PassFacts = {
    n: 200,
    t: 2.5,
    yearsAbove: 5,
    ahead: 190,
    doubleSum: 0.01,
    marketsAbove: 4,
    marketsUsed: 7,
  }
  it('holds each line at its edge and fails just past it', () => {
    const l = passLines(facts, 200, P)
    expect(l.map((x) => x.line)).toEqual([1, 2, 3, 4, 5, 6])
    expect(l.every((x) => x.ok)).toBe(true)
    const off = (f: Partial<PassFacts>) =>
      passLines({ ...facts, ...f }, 200, P).filter((x) => !x.ok)
    expect(off({ n: 199 }).map((x) => x.line)).toEqual([1])
    expect(off({ t: 2.49 }).map((x) => x.line)).toEqual([2])
    expect(off({ yearsAbove: 4 }).map((x) => x.line)).toEqual([3])
    expect(off({ ahead: 189 }).map((x) => x.line)).toEqual([4])
    expect(off({ doubleSum: 0 }).map((x) => x.line)).toEqual([5])
    // More than half of the markets used: 4 of 7 yes, 3 of 7 no, 1 of 2 no.
    expect(off({ marketsAbove: 3 }).map((x) => x.line)).toEqual([6])
    expect(off({ marketsAbove: 1, marketsUsed: 2 }).map((x) => x.line)).toEqual([6])
  })
  it('the pair candidate: no line 6 and its own trade count', () => {
    const l = passLines({ ...facts, n: 100, marketsAbove: null, marketsUsed: null }, 100, P)
    expect(l.map((x) => x.line)).toEqual([1, 2, 3, 4, 5])
    expect(l.every((x) => x.ok)).toBe(true)
  })
  it('tries the readings in the order of Amendment 2 point 5', () => {
    const base = { pass: false, meanAfter: -0.1, aheadAfter: 0, tBefore: 0, aheadBefore: 0 }
    expect(reading({ ...base, pass: true }, P)).toBe('Worth a play account')
    // Positive, not proven wins over real but too small when both hold.
    const both = { ...base, meanAfter: 0.01, aheadAfter: 100, tBefore: 3, aheadBefore: 195 }
    expect(reading(both, P)).toBe('Positive, not proven')
    expect(reading({ ...both, aheadAfter: 99 }, P)).toBe('Real but too small to trade')
    expect(reading({ ...both, meanAfter: 0 }, P)).toBe('Real but too small to trade')
    expect(reading({ ...both, meanAfter: 0, aheadBefore: 189 }, P)).toBe('Not there')
    expect(reading({ ...both, meanAfter: 0, tBefore: 2.49 }, P)).toBe('Not there')
    expect(READINGS).toEqual([
      'Worth a play account',
      'Positive, not proven',
      'Real but too small to trade',
      'Not there',
    ])
  })
  it('ahead of a twin means a strictly higher average; a twin with no trade is not passed', () => {
    expect(aheadOf(0.1, [0, 0.1, 0.2, NaN, -1])).toBe(2)
  })
  it('the rehearsal scales the year and twin lines', () => {
    const R = REHEARSAL_PERIODS
    expect(R.checkYears).toEqual([2015, 2016, 2017, 2018])
    expect(R.choose).toEqual([yearStart(2010), yearStart(2015)])
    expect(R.halves[1]).toEqual([yearStart(2013), yearStart(2015)])
    expect(R.readBefore).toBe(yearStart(2015))
    expect([R.twins, R.minYears, R.minAhead, R.positiveAhead]).toEqual([20, 3, 19, 10])
    expect([R.minTradesAll, R.minTradesMarket, R.passTrades, R.passTradesPair]).toEqual([
      Math.ceil((300 * 5) / 9),
      Math.ceil((150 * 5) / 9),
      Math.ceil((200 * 4) / 7),
      Math.ceil((100 * 4) / 7),
    ])
    expect(REAL_PERIODS.checkYears).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025])
  })
})

describe('twins', () => {
  it('a fixed generator: the same seed gives the same moves, never zero, 1 to 5 either way', () => {
    expect(twinMoves(7, 50)).toEqual(twinMoves(7, 50))
    expect(twinMoves(7, 50)).not.toEqual(twinMoves(8, 50))
    const many = twinMoves(1, 5000)
    expect(new Set(many)).toEqual(new Set(TWIN_MOVES))
    expect(many).not.toContain(0)
    const g = mulberry32(1)
    const x = g()
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThan(1)
    expect(mulberry32(1)()).toBe(x)
  })
  it('one move per market and UTC fill date, groups in market order then date', () => {
    const t = (d: number, h: number) => u(2020, 0, d, h)
    const { groups, ofTrade } = twinGroups([
      { market: 'GBPUSD', fillTime: t(6, 1) },
      { market: 'EURUSD', fillTime: t(7, 3) },
      { market: 'EURUSD', fillTime: t(6, 23) },
      { market: 'GBPUSD', fillTime: t(6, 22) },
      { market: 'EURUSD', fillTime: t(6, 0) },
    ])
    expect(groups).toHaveLength(3)
    // EURUSD 6th, EURUSD 7th, GBPUSD 6th.
    expect(ofTrade).toEqual([2, 1, 0, 2, 0])
  })
  it('moves the entry; a missing minute goes one more day the same way, up to 4 times', () => {
    const t0 = u(2020, 0, 15, 10)
    const have = new Set([t0 + 3 * DAY, t0 - 6 * DAY, t0 + 9 * DAY])
    const exists = (x: number) => have.has(x)
    expect(twinStamp(t0, 3, exists)).toBe(t0 + 3 * DAY)
    expect(twinStamp(t0, -1, exists)).toBeNull() // -1..-5 tried: -6 would be a 6th try
    expect(twinStamp(t0, -2, exists)).toBe(t0 - 6 * DAY) // -6 is the 5th try
    expect(twinStamp(t0, -3, exists)).toBe(t0 - 6 * DAY)
    expect(twinStamp(t0, 5, exists)).toBe(t0 + 9 * DAY) // 5, 6, 7, 8, 9
    expect(twinStamp(t0, 4, exists)).toBeNull() // 4..8: 9 is a 6th try
    expect(twinStamp(t0, 1, exists)).toBe(t0 + 3 * DAY)
  })
})

describe('thirds and the sweet spot', () => {
  it('splits by R / price, smallest first, at floor(n/3) and floor(2n/3)', () => {
    const items = [5, 1, 7, 3, 2, 6, 4].map((size, i) => ({ size, time: i }))
    const [a, b, c] = thirds(items)
    expect(a.map((x) => x.size)).toEqual([1, 2])
    expect(b.map((x) => x.size)).toEqual([3, 4])
    expect(c.map((x) => x.size)).toEqual([5, 6, 7])
  })
  it('names the best target, or uses the fixed wording when none made money', () => {
    expect(
      sweetSpot([
        { label: '1 R', meanAfter: 0.1 },
        { label: '2 R', meanAfter: 0.2 },
        { label: '3 R', meanAfter: 0.2 },
      ]),
    ).toEqual({ index: 1, made: true, text: 'sweet spot: 2 R' })
    const none = sweetSpot([
      { label: '1 R', meanAfter: -0.1 },
      { label: '2 R', meanAfter: 0 },
    ])
    expect(none).toEqual({ index: 1, made: false, text: NO_SWEET_SPOT })
    expect(NO_SWEET_SPOT).toBe(
      'no target made money; the best row is the least-losing one, not a sweet spot',
    )
  })
})

describe('Part 1 counts', () => {
  it("counts by pattern and by the year of the confirming candle close, with C's giving two", () => {
    const p = (name: string, close: number, outcome: string, swing: number, ofC: number) =>
      ({
        market: 'GBPUSD',
        chart: 15,
        k: 2,
        name,
        confirmClose: close,
        swing,
        ofC,
        wait: { outcome },
      }) as unknown as Pattern
    const rows = part1Rows([
      p('gartley', yearStart(2015), 'completed', 10, 2), // closes 2015-01-01 00:00: year 2015
      p('crab', yearStart(2015), 'skipped', 10, 2),
      p('bat', yearStart(2015) - 60, 'cancelled_c', 9, 1), // 2014
      p('bat', u(2015, 5, 1), 'cancelled_swing', 12, 1),
      p('butterfly', u(2015, 6, 1), 'waiting', 13, 1),
    ])
    const get = (year: number, pattern: string) =>
      rows.find((r) => r.year === year && r.pattern === pattern)!
    expect(get(2014, 'bat').cancelled_c).toBe(1)
    const all = get(2015, 'all')
    expect(all.formed).toBe(4)
    expect(all.completed).toBe(1)
    expect(all.skipped).toBe(1)
    expect(all.cancelled_swing).toBe(1)
    expect(all.waiting).toBe(1)
    expect(all.fromTwoPatternC).toBe(2)
    expect(all.twoPatternCs).toBe(1)
    expect(get(2015, 'crab').fromTwoPatternC).toBe(1)
    expect(part1Rows([p('bat', u(2019, 1, 1), 'completed', 1, 1)], (y) => y < 2019)).toEqual([])
  })
})
