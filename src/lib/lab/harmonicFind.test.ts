import { describe, expect, it } from 'vitest'
import {
  atr14,
  buildChart,
  findPatterns,
  findSwings,
  inRange,
  MARKET_COSTS,
  matchPatterns,
  runWait,
  trueRanges,
  type Bars,
  type MarketCosts,
} from './harmonicFind'

/** Monday 2015-01-05 00:00 UTC. */
const T0 = Date.UTC(2015, 0, 5) / 1000
const Q = 900

/** Test costs in plain units with exact binary fractions: spread 0.75, pen 0.5. */
const TESTC: MarketCosts = {
  market: 'EURUSD',
  pip: 1,
  pen: 0.5,
  slip: 0.25,
  comm: 0,
  spreadAt: () => 0.75,
}

type Row = [number, number, number, number, number] // time, open, high, low, close

function bars(rows: Row[]): Bars {
  const col = (k: number) => Float64Array.from(rows.map((r) => r[k]))
  return { n: rows.length, time: col(0), open: col(1), high: col(2), low: col(3), close: col(4) }
}

const f64 = (a: number[]) => Float64Array.from(a)

/**
 * Candles stepping 10 at a time between levels, one 1-minute bar per
 * 15-minute candle: up candles are low p, high p+10, close p+10; down
 * candles high p, low p-10, close p-10. Every true range is 10, so ATR = 10.
 */
function zigzag(levels: number[]): Row[] {
  const out: Row[] = []
  for (let s = 1; s < levels.length; s++) {
    const [p, q] = [levels[s - 1], levels[s]]
    const up = q > p
    for (let v = p; v !== q; v += up ? 10 : -10) {
      const t = T0 + out.length * Q
      out.push(up ? [t, v, v + 10, v, v + 10] : [t, v, v, v - 10, v - 10])
    }
  }
  return out
}

// X 1000, A 1500, B 1190, C 1440: rB 0.62, rC 250/310, a Gartley buy with
// D = 1500 - 0.786 x 500 = 1107 and stop 1500 - 1.05 x 500 = 975.
// Candles: 0-30 down to 1000, 31-80 up to 1500, 81-111 down to 1190,
// 112-136 up to 1440, 137-170 down to 1100.
const LEVELS = [1310, 1000, 1500, 1190, 1440, 1100]

describe('chart candles', () => {
  it('builds 15-minute candles on UTC clock boundaries from the minutes they hold', () => {
    const b = bars([
      [T0 + 3 * 60, 1, 2, 0.5, 1.5],
      [T0 + 14 * 60, 1.5, 3, 1, 2.5],
      [T0 + 15 * 60, 2.5, 2.6, 2.4, 2.45],
      // no minute in 00:30-00:45: that candle does not exist
      [T0 + 47 * 60, 2, 2.2, 1.9, 2.1],
    ])
    const c = buildChart(b, 15)
    expect(c.n).toBe(3)
    expect([...c.time]).toEqual([T0, T0 + Q, T0 + 45 * 60])
    expect([c.open[0], c.high[0], c.low[0], c.close[0]]).toEqual([1, 3, 0.5, 2.5])
    expect([...c.first]).toEqual([0, 2, 3])
    expect([...c.end]).toEqual([2, 3, 4])
    expect([...c.ofMinute]).toEqual([0, 0, 1, 2])
    expect(buildChart(b, 30).n).toBe(2)
    expect([...buildChart(b, 30).time]).toEqual([T0, T0 + 30 * 60])
  })
})

describe('true range and ATR', () => {
  it('uses high - low on the first candle and the previous close after', () => {
    const tr = trueRanges(f64([10, 12, 8]), f64([8, 9.5, 7]), f64([9, 11, 7.5]))
    expect([...tr]).toEqual([2, 3, 4])
  })
  it('has its first ATR at the 14th candle, the mean of 14 true ranges', () => {
    const a = atr14(f64(Array.from({ length: 16 }, (_, i) => i + 1)))
    expect(Number.isNaN(a[12])).toBe(true)
    expect(a[13]).toBe(7.5) // (1 + ... + 14) / 14
    expect(a[14]).toBe(8.5) // (2 + ... + 15) / 14
  })
})

describe('swings', () => {
  const sw = (rows: [number, number, number][], k = 2) =>
    findSwings(
      f64(rows.map((r) => r[0])),
      f64(rows.map((r) => r[1])),
      f64(rows.map((r) => r[2])),
      k,
    )
  const flat = (n: number): [number, number, number][] =>
    Array.from({ length: n }, () => [1005, 995, 1000])

  it('confirms nothing before the 14th candle; the candidate still moves', () => {
    // Candle 5 drops to 500, far beyond 2 ATR, but no ATR exists yet.
    // ATR13 = (5 x 10 + 500 + 8 x 20) / 14 = 50.71; candle 13's low 590 <= 1005 - 101.43.
    const rows = [...flat(5), [1000, 500, 600], ...Array(8).fill([610, 590, 600])] as [
      number,
      number,
      number,
    ][]
    expect(sw(rows.slice(0, 13))).toEqual([])
    expect(sw(rows)).toEqual([{ kind: 1, idx: 0, price: 1005, confirm: 13, next: 500, nextIdx: 5 }])
  })

  it('a strictly higher high only moves the candidate', () => {
    // Candle 14: high 1010 > 1005 and low 900 (below 1010 - 2 x 17.14): it only becomes the candidate.
    // Candle 15: TR 30, ATR = (12 x 10 + 110 + 30) / 14 = 18.571; low 970 <= 1010 - 37.14: confirmed.
    const rows = [...flat(14), [1010, 900, 1000], [1000, 970, 975]] as [number, number, number][]
    expect(sw(rows.slice(0, 15))).toEqual([])
    // The candidate low counts only candles after the high's candle: 970, not 900.
    expect(sw(rows)).toEqual([
      { kind: 1, idx: 14, price: 1010, confirm: 15, next: 970, nextIdx: 15 },
    ])
  })

  it('a tie keeps the earlier candle', () => {
    const r = zigzag(LEVELS)
    const s = findSwings(
      f64(r.map((x) => x[2])),
      f64(r.map((x) => x[3])),
      f64(r.map((x) => x[4])),
      2,
    )
    // Candle 81's high is 1500 like candle 80's; candle 31's low 1000 like candle 30's.
    expect(s.map((x) => [x.kind, x.idx, x.price, x.confirm])).toEqual([
      [1, 0, 1310, 13],
      [-1, 30, 1000, 32],
      [1, 80, 1500, 82],
      [-1, 111, 1190, 113],
      [1, 136, 1440, 138],
    ])
    expect([s[4].next, s[4].nextIdx]).toEqual([1420, 138])
  })

  it('a candle confirms at most one swing', () => {
    // Down steps 0-14 (ATR 10), H0 confirmed at 13. Candle 15 (1160 to 1300) confirms the low
    // at 1160 (1300 >= 1160 + 2 x 19.29) and would also confirm its own high (1160 <= 1300 - 38.6),
    // but may not. Candle 17: ATR (10 x 10 + 10 + 140 + 10 + 30) / 14 = 20.71; 1250 <= 1258.57.
    const down: [number, number, number][] = Array.from({ length: 15 }, (_, i) => [
      1310 - 10 * i,
      1300 - 10 * i,
      1300 - 10 * i,
    ])
    const rows = [...down, [1300, 1160, 1290], [1290, 1280, 1280], [1280, 1250, 1250]] as [
      number,
      number,
      number,
    ][]
    const s = sw(rows)
    expect(s.map((x) => [x.kind, x.idx, x.price, x.confirm])).toEqual([
      [1, 0, 1310, 13],
      [-1, 14, 1160, 15],
      [1, 15, 1300, 17],
    ])
  })

  it('size 3 needs 3 ATR', () => {
    // H0: candle 13's low 1170 <= 1310 - 30. X at 1000 needs a high of 1030: candle 33, not 32.
    const r = zigzag(LEVELS)
    const s = findSwings(
      f64(r.map((x) => x[2])),
      f64(r.map((x) => x[3])),
      f64(r.map((x) => x[4])),
      3,
    )
    expect(s.slice(0, 2).map((x) => [x.idx, x.confirm])).toEqual([
      [0, 13],
      [30, 33],
    ])
  })
})

describe('the four points and the patterns table', () => {
  const one = (dir: 1 | -1, x: number, a: number, b: number, c: number) =>
    matchPatterns(dir, x, a, b, c).map((p) => [p.name, p.d, p.stop])

  it('Gartley: rB 0.62, rC 0.5; D = A - 0.786 XA, stop = A - 1.05 XA', () => {
    // proj = (69 - 21.4) / (69 - 38) = 1.535
    const [[n, d, s]] = one(1, 0, 100, 38, 69)
    expect(n).toBe('gartley')
    expect(d).toBeCloseTo(21.4, 9)
    expect(s).toBeCloseTo(-5, 9)
    const [[n2, d2, s2], ...rest] = one(-1, 100, 0, 62, 31)
    expect([n2, rest.length]).toEqual(['gartley', 0])
    expect(d2).toBeCloseTo(78.6, 9)
    expect(s2).toBeCloseTo(105, 9)
  })
  it('Bat: rB 0.45, rC 0.8; d 0.886, s 1.13', () => {
    // proj = (91 - 11.4) / 36 = 2.211 (the Crab's (91 + 61.8) / 36 = 4.24 is too far)
    expect(one(1, 0, 100, 55, 91)).toEqual([
      ['bat', expect.closeTo(11.4, 9), expect.closeTo(-13, 9)],
    ])
    expect(one(-1, 100, 0, 45, 9)).toEqual([
      ['bat', expect.closeTo(88.6, 9), expect.closeTo(113, 9)],
    ])
  })
  it('Butterfly: rB 0.78, rC 0.618; d 1.27, s 1.414', () => {
    // C = 22 + 0.618 x 78 = 70.204; proj = (70.204 + 27) / 48.204 = 2.017
    expect(one(1, 0, 100, 22, 70.204)).toEqual([
      ['butterfly', expect.closeTo(-27, 9), expect.closeTo(-41.4, 9)],
    ])
    expect(one(-1, 100, 0, 78, 29.796)).toEqual([
      ['butterfly', expect.closeTo(127, 9), expect.closeTo(141.4, 9)],
    ])
  })
  it('Crab: rB 0.55, rC 0.886; d 1.618, s 2.0', () => {
    // C = 45 + 0.886 x 55 = 93.73; proj = (93.73 + 61.8) / 48.73 = 3.19
    expect(one(1, 0, 100, 45, 93.73)).toEqual([['crab', expect.closeTo(-61.8, 9), -100]])
    expect(one(-1, 100, 0, 55, 6.27)).toEqual([['crab', expect.closeTo(161.8, 9), 200]])
  })
  it('one C can give two patterns (Gartley and Crab)', () => {
    // rB 0.6; C 85: Gartley proj 63.6 / 45 = 1.413, Crab proj 146.8 / 45 = 3.262.
    expect(one(1, 0, 100, 40, 85).map((p) => p[0])).toEqual(['gartley', 'crab'])
    expect(one(-1, 100, 0, 60, 15).map((p) => p[0])).toEqual(['gartley', 'crab'])
  })
  it('ratio tests are inclusive with a tolerance of 1e-9', () => {
    expect(inRange(0.382, [0.382, 0.886])).toBe(true)
    expect(inRange(0.382 - 0.9e-9, [0.382, 0.886])).toBe(true)
    expect(inRange(0.382 - 1.1e-9, [0.382, 0.886])).toBe(false)
    expect(inRange(0.886 + 0.9e-9, [0.382, 0.886])).toBe(true)
    expect(inRange(0.886 + 1.1e-9, [0.382, 0.886])).toBe(false)
    // rC just outside 0.382 to 0.886 kills every pattern.
    expect(one(1, 0, 100, 40, 40 + 0.887 * 60)).toEqual([])
    expect(one(1, 0, 100, 40, 40 + 0.381 * 60)).toEqual([])
    // rB 0.5 exactly is still a Bat; at 0.501 it is not (and the Crab's proj 3.79 is too far).
    expect(one(1, 0, 100, 50, 90).map((p) => p[0])).toEqual(['bat'])
    expect(one(1, 0, 100, 49.9, 90).map((p) => p[0])).toEqual([])
  })
})

describe('patterns on candles', () => {
  const T = (i: number) => T0 + i * Q

  it('finds the Gartley buy of the zigzag with its points, D, stop and wait', () => {
    const b = bars(zigzag(LEVELS))
    const c = buildChart(b, 15)
    const ps = findPatterns(b, c, TESTC, 2)
    expect(ps).toHaveLength(1)
    const p = ps[0]
    expect([p.name, p.dir, p.chart, p.k]).toEqual(['gartley', 1, 15, 2])
    expect([p.x, p.a, p.b, p.c]).toEqual([
      { idx: 30, time: T(30), price: 1000 },
      { idx: 80, time: T(80), price: 1500 },
      { idx: 111, time: T(111), price: 1190 },
      { idx: 136, time: T(136), price: 1440 },
    ])
    expect([p.confirm, p.confirmTime, p.confirmClose]).toEqual([138, T(138), T(139)])
    expect(p.d).toBe(1107)
    expect(p.stop).toBe(975)
    // Completes at Bid low <= 1107 - 0.75 - 0.5 = 1105.75: candle 170 (low 1100), not 169 (1110).
    expect(p.wait).toEqual({ outcome: 'completed', minute: 170, candle: -1, time: T(170) })
  })

  it('never uses a swing before its confirmation', () => {
    const rows = zigzag(LEVELS)
    // Up to candle 137, C (1440) is not confirmed: no pattern exists.
    const early = bars(rows.slice(0, 138))
    expect(findPatterns(early, buildChart(early, 15), TESTC, 2)).toEqual([])
    const at = bars(rows.slice(0, 139))
    const p = findPatterns(at, buildChart(at, 15), TESTC, 2)
    expect(p.map((x) => x.confirm)).toEqual([138])
    // Nothing after the data: the wait is still open.
    expect(p[0].wait.outcome).toBe('waiting')
  })

  it('swings on every prefix are the swings of the whole series confirmed by then', () => {
    let s = 12345
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    const n = 3000
    const h = new Float64Array(n)
    const l = new Float64Array(n)
    const cl = new Float64Array(n)
    let p = 100
    for (let i = 0; i < n; i++) {
      const o = p
      p += (rnd() - 0.5) * 2
      h[i] = Math.max(o, p) + rnd()
      l[i] = Math.min(o, p) - rnd()
      cl[i] = p
    }
    const all = findSwings(h, l, cl, 2)
    expect(all.length).toBeGreaterThan(20)
    for (const len of [50, 400, 1234, 2999]) {
      const part = findSwings(h.subarray(0, len), l.subarray(0, len), cl.subarray(0, len), 2)
      expect(part).toEqual(all.filter((x) => x.confirm < len))
    }
  })

  it('a confirming candle whose low passes D gives no pattern (skipped)', () => {
    const rows = zigzag(LEVELS).slice(0, 139)
    // Candle 138 confirms C and its low reaches D = 1107 exactly.
    rows[138] = [T(138), 1430, 1430, 1107, 1420]
    const b = bars([...rows, [T(139), 1420, 1420, 1100, 1100]])
    const p = findPatterns(b, buildChart(b, 15), TESTC, 2)
    expect(p.map((x) => [x.confirm, x.wait.outcome])).toEqual([[138, 'skipped']])
    // Half a point above D it waits, and candle 139 (low 1100) completes it.
    rows[138] = [T(138), 1430, 1430, 1107.5, 1420]
    const b2 = bars([...rows, [T(139), 1420, 1420, 1100, 1100]])
    const p2 = findPatterns(b2, buildChart(b2, 15), TESTC, 2)
    expect(p2.map((x) => [x.confirm, x.wait.outcome, x.wait.minute])).toEqual([
      [138, 'completed', 139],
    ])
  })

  it('a sell: a confirming candle whose high reaches D gives no pattern (skipped)', () => {
    // The zigzag turned upside down (v -> 2500 - v): a Gartley sell with X 1500,
    // A 1000, B 1310, C 1060, D = 1000 + 0.786 x 500 = 1393, stop 1525.
    const flip = (rs: Row[]) =>
      rs.map(([t, o, h, l, c]): Row => [t, 2500 - o, 2500 - l, 2500 - h, 2500 - c])
    const rows = zigzag(LEVELS).slice(0, 139)
    rows[138] = [T(138), 1430, 1430, 1107, 1420] // flipped: high 1393, exactly D
    const b = bars(flip([...rows, [T(139), 1420, 1420, 1100, 1100]]))
    const p = findPatterns(b, buildChart(b, 15), TESTC, 2)
    expect(p.map((x) => [x.dir, x.d, x.stop, x.confirm, x.wait.outcome])).toEqual([
      [-1, 1393, 1525, 138, 'skipped'],
    ])
    // Half a point below D it waits, and candle 139 (high 1400 >= D + pen) completes it.
    rows[138] = [T(138), 1430, 1430, 1107.5, 1420]
    const b2 = bars(flip([...rows, [T(139), 1420, 1420, 1100, 1100]]))
    const p2 = findPatterns(b2, buildChart(b2, 15), TESTC, 2)
    expect(p2.map((x) => [x.confirm, x.wait.outcome, x.wait.minute])).toEqual([
      [138, 'completed', 139],
    ])
  })
})

describe('the wait', () => {
  /** n chart candles of `per` minutes each, flat at 105 (between D = 100 and C = 110). */
  function flatRows(n: number, per = 3, skip: number[] = []): Row[] {
    const out: Row[] = []
    for (let i = 0, slot = 0; i < n; slot++) {
      if (skip.includes(slot)) continue
      for (let j = 0; j < per; j++) out.push([T0 + slot * Q + j * 60, 105, 105, 105, 105])
      i++
    }
    return out
  }
  const run = (rows: Row[], dir: 1 | -1, next = -1, costs = TESTC, c = 110, d = 100) => {
    const b = bars(rows)
    return runWait(b, buildChart(b, 15), costs, dir, c, d, 0, next)
  }
  const sellRows = (n: number) => flatRows(n).map((r) => [r[0], 95, 95, 95, 95] as Row)

  it('a buy completes exactly at D - spread - pen, not one tick before', () => {
    const r = flatRows(5)
    r[7] = [r[7][0], 105, 105, 98.76, 100] // candle 2, minute 1: 98.76 > 98.75
    r[10] = [r[10][0], 105, 105, 98.75, 100] // candle 3, minute 1
    expect(run(r, 1)).toEqual({ outcome: 'completed', minute: 10, candle: -1, time: r[10][0] })
  })
  it('a sell completes at Bid high >= D + pen', () => {
    // Sell: C = 90 below, D = 100 above; complete at 100.5.
    const r = sellRows(5)
    r[4] = [r[4][0], 95, 100.49, 95, 95]
    r[8] = [r[8][0], 95, 100.5, 95, 95]
    expect(run(r, -1, -1, TESTC, 90, 100).minute).toBe(8)
  })
  it('does not test the confirming candle', () => {
    const r = flatRows(3)
    r[1] = [r[1][0], 105, 105, 90, 100] // inside candle 0, the confirming candle
    expect(run(r, 1).outcome).toBe('waiting')
  })
  it('is cancelled by a minute beyond C; complete and cancel in one minute is a cancel', () => {
    const r = flatRows(5)
    r[4] = [r[4][0], 105, 110, 105, 105] // at C, not above: nothing
    r[6] = [r[6][0], 105, 110.01, 98, 105] // above C and through D at once
    expect(run(r, 1)).toEqual({ outcome: 'cancelled_c', minute: 6, candle: -1, time: r[6][0] })
    const s = sellRows(5)
    s[5] = [s[5][0], 95, 101, 89.99, 95]
    expect(run(s, -1, -1, TESTC, 90, 100).outcome).toBe('cancelled_c')
  })
  it('is cancelled at the close of the 192nd chart candle, counting existing candles', () => {
    // 200 candles with two missing slots (a gap): candle index 192 is the 192nd after candle 0.
    const r = flatRows(200, 3, [50, 51])
    const b = bars(r)
    const c = buildChart(b, 15)
    expect(c.time[192]).toBe(T0 + 194 * Q)
    expect(runWait(b, c, TESTC, 1, 110, 100, 0, -1)).toEqual({
      outcome: 'cancelled_time',
      minute: -1,
      candle: 192,
      time: T0 + 195 * Q,
    })
    // A completion in the last minute of candle 192 still counts; one in candle 193 does not.
    const last = c.end[192] - 1
    const r2 = r.slice()
    r2[last] = [r2[last][0], 105, 105, 98, 100]
    expect(run(r2, 1).outcome).toBe('completed')
    const r3 = r.slice()
    r3[c.first[193]] = [r3[c.first[193]][0], 105, 105, 98, 100]
    expect(run(r3, 1).outcome).toBe('cancelled_time')
  })
  it('is cancelled at the close of the candle that confirms the next swing', () => {
    const r = flatRows(200)
    expect(run(r, 1, 50)).toEqual({
      outcome: 'cancelled_swing',
      minute: -1,
      candle: 50,
      time: T0 + 51 * Q,
    })
    const r2 = r.slice()
    r2[50 * 3 + 2] = [r2[50 * 3 + 2][0], 105, 105, 98, 100] // last minute of candle 50
    expect(run(r2, 1, 50).outcome).toBe('completed')
    const r3 = r.slice()
    r3[51 * 3] = [r3[51 * 3][0], 105, 105, 98, 100] // first minute of candle 51
    expect(run(r3, 1, 50).outcome).toBe('cancelled_swing')
    // The 192nd candle confirming the next swing is a swing cancel.
    expect(run(r, 1, 192).outcome).toBe('cancelled_swing')
    expect(run(r, 1, 193).outcome).toBe('cancelled_time')
  })
  it("uses gold's price-scaled spread: 0.28 x D / 1800, and pen $0.05", () => {
    const g = MARKET_COSTS.XAUUSD
    const r = flatRows(4).map((x) => [x[0], 1810, 1810, 1810, 1810] as Row)
    r[3] = [r[3][0], 1810, 1810, 1799.671, 1800] // 1800 - 0.28 - 0.05 = 1799.67
    r[6] = [r[6][0], 1810, 1810, 1799.669, 1800]
    expect(run(r, 1, -1, g, 1820, 1800).minute).toBe(6)
  })
})

describe('markets', () => {
  it('has the spreads, pips, pens and slips of the plan', () => {
    const m = MARKET_COSTS
    expect([m.EURUSD.spreadAt(1), m.GBPUSD.spreadAt(1), m.EURGBP.spreadAt(1)]).toEqual([
      0.00008, 0.0001, 0.0001,
    ])
    expect([m.USDJPY.spreadAt(1), m.EURJPY.spreadAt(1), m.GBPJPY.spreadAt(1)]).toEqual([
      0.009, 0.013, 0.02,
    ])
    expect([m.EURUSD.pip, m.USDJPY.pip, m.XAUUSD.pip]).toEqual([0.0001, 0.01, 0.1])
    expect([m.EURUSD.pen, m.USDJPY.pen, m.XAUUSD.pen]).toEqual([0.00005, 0.005, 0.05])
    expect([m.EURUSD.slip, m.GBPJPY.slip, m.XAUUSD.slip]).toEqual([0.00002, 0.002, 0.02])
    expect(m.XAUUSD.spreadAt(1800)).toBeCloseTo(0.28, 12)
    expect(m.XAUUSD.spreadAt(2700)).toBeCloseTo(0.42, 12)
    expect([m.XAUUSD.comm, m.EURUSD.comm]).toEqual([0.07, 0])
  })
})
