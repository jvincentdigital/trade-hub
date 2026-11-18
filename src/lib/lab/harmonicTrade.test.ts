import { describe, expect, it } from 'vitest'
import {
  buildChart,
  findPatterns,
  MARKET_COSTS,
  type Bars,
  type MarketCosts,
  type Pattern,
} from './harmonicFind'
import {
  barsBefore,
  ema,
  entryConfirmed,
  entryE0,
  fourHourCandles,
  harmonicContext,
  inLondonNyHours,
  lookBack,
  minuteAt,
  nyOffsetHours,
  patternTargets,
  rsi14,
  runExits,
  runHarmonic,
  runSingle,
  runSplit,
  simulateTwin,
  timeExitIdx,
  trendAt,
  type FourHour,
  type HarmonicContext,
  type Position,
} from './harmonicTrade'

const T0 = Date.UTC(2015, 0, 5) / 1000 // Monday 00:00 UTC
const Q = 900
const H = 3600

/** Plain units, exact binary fractions: spread 0.75, pen 0.5, slip 0.25, pip 1. */
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
/** Minutes 60 s apart from T0 (all inside the first chart candles). */
const minutes = (ohlc: [number, number, number, number][]): Bars =>
  bars(ohlc.map((r, i) => [T0 + i * 60, ...r]))
/** n chart candles of one minute each, flat at `v`. */
const flatCandles = (n: number, v: number): Row[] =>
  Array.from({ length: n }, (_, i) => [T0 + i * Q, v, v, v, v])

const pos = (b: Bars, over: Partial<Position> = {}): Position => ({
  dir: 1,
  fill: 0,
  entry: 100,
  spread: 0.75,
  stop: 90,
  R: 10,
  entrySlip: 0,
  timeIdx: -1,
  last: b.n - 1,
  costs: TESTC,
  ...over,
})

const NO_FOUR: FourHour = {
  n: 0,
  start: new Float64Array(0),
  end: new Float64Array(0),
  close: new Float64Array(0),
  ema50: new Float64Array(0),
}

function ctxOf(rows: Row[], costs: MarketCosts = TESTC): HarmonicContext {
  const b = bars(rows)
  const chart = buildChart(b, 15)
  return {
    bars: b,
    costs,
    chart,
    rsi: new Float64Array(chart.n).fill(NaN),
    ema20: new Float64Array(chart.n).fill(1000),
    four: NO_FOUR,
  }
}

/** A completed buy pattern: D 100, stop 90, A 150 (X1's target 119.1), completing in `minute`. */
function pat(minute: number, over: Partial<Pattern> = {}): Pattern {
  const pt = { idx: 0, time: T0, price: 0 }
  return {
    id: 0,
    market: 'EURUSD',
    chart: 15,
    k: 2,
    name: 'gartley',
    dir: 1,
    x: pt,
    a: { ...pt, price: 150 },
    b: pt,
    c: { ...pt, price: 140 },
    swing: 3,
    confirm: 0,
    confirmTime: T0,
    confirmClose: T0 + Q,
    nextConfirm: -1,
    rB: 0.6,
    rC: 0.5,
    proj: 1.5,
    d: 100,
    stop: 90,
    ofC: 1,
    wait: { outcome: 'completed', minute, candle: -1, time: T0 + minute * Q },
    ...over,
  }
}

describe('indicators', () => {
  it("RSI(14) is Wilder's, starting at the 14th change", () => {
    // 7 gains of 2 and 7 losses of 1: averages 1 and 0.5, RS 2, RSI 66.67.
    // Then +3: gains (13 + 3) / 14, losses 6.5 / 14, RS 2.4615, RSI 71.11.
    const ch = [2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 3]
    const c = [100]
    for (const x of ch) c.push(c[c.length - 1] + x)
    const r = rsi14(Float64Array.from(c))
    expect(Number.isNaN(r[13])).toBe(true)
    expect(r[14]).toBeCloseTo(100 - 100 / 3, 9)
    expect(r[15]).toBeCloseTo(100 - 100 / (1 + 16 / 6.5), 9)
    // No losses: 100.
    expect(rsi14(Float64Array.from({ length: 15 }, (_, i) => i))[14]).toBe(100)
  })
  it('EMA(20) uses 2/21 seeded with the first close', () => {
    const e = ema(Float64Array.from([10, 31, 31]), 20)
    expect(e[0]).toBe(10)
    expect(e[1]).toBeCloseTo(12, 12) // 10 + 2/21 x 21
    expect(e[2]).toBeCloseTo(12 + (2 / 21) * 19, 12)
  })
  it('knows New York daylight saving, including the rules before 2007', () => {
    expect(nyOffsetHours(Date.UTC(2015, 6, 1) / 1000)).toBe(-4)
    expect(nyOffsetHours(Date.UTC(2015, 0, 15) / 1000)).toBe(-5)
    // 2015: from 8 March 07:00 UTC to 1 November 06:00 UTC.
    expect(nyOffsetHours(Date.UTC(2015, 2, 8, 6, 59) / 1000)).toBe(-5)
    expect(nyOffsetHours(Date.UTC(2015, 2, 8, 7) / 1000)).toBe(-4)
    expect(nyOffsetHours(Date.UTC(2015, 10, 1, 5, 59) / 1000)).toBe(-4)
    expect(nyOffsetHours(Date.UTC(2015, 10, 1, 6) / 1000)).toBe(-5)
    // 2006: from 2 April to 29 October.
    expect(nyOffsetHours(Date.UTC(2006, 2, 20) / 1000)).toBe(-5)
    expect(nyOffsetHours(Date.UTC(2006, 3, 2, 7) / 1000)).toBe(-4)
    expect(nyOffsetHours(Date.UTC(2006, 9, 29, 5, 59) / 1000)).toBe(-4)
    expect(nyOffsetHours(Date.UTC(2006, 9, 29, 6) / 1000)).toBe(-5)
  })
  it('builds 4-hour candles at 17, 21, 01, 05, 09 and 13 New York time with EMA(50)', () => {
    const t = (y: number, m: number, d: number, h: number, mi: number) =>
      Date.UTC(y, m, d, h, mi) / 1000
    const rows: Row[] = [
      [t(2015, 6, 1, 12, 59), 1, 1, 1, 1], // 08:59 EDT: the 05:00 candle (09:00 UTC)
      [t(2015, 6, 1, 13, 0), 2, 2, 2, 2], // 09:00 EDT: a new candle
      [t(2015, 6, 1, 16, 59), 3, 3, 3, 3],
      [t(2015, 0, 15, 13, 59), 4, 4, 4, 4], // winter: 08:59 EST, the 05:00 candle (10:00 UTC)
      [t(2015, 0, 15, 14, 0), 5, 5, 5, 5],
    ]
    rows.sort((a, b) => a[0] - b[0])
    const f = fourHourCandles(bars(rows))
    expect([...f.start]).toEqual([
      t(2015, 0, 15, 10, 0),
      t(2015, 0, 15, 14, 0),
      t(2015, 6, 1, 9, 0),
      t(2015, 6, 1, 13, 0),
    ])
    expect([...f.close]).toEqual([4, 5, 1, 3])
    expect(f.end[3]).toBe(t(2015, 6, 1, 17, 0))
    expect(f.ema50[0]).toBe(4)
    expect(f.ema50[1]).toBeCloseTo(4 + 2 / 51, 12)
  })
  it('C3: the latest 4-hour candle that ended at or before the time is above its EMA(50)', () => {
    const four: FourHour = {
      n: 2,
      start: Float64Array.from([0, 4 * H]),
      end: Float64Array.from([4 * H, 8 * H]),
      close: Float64Array.from([10, 9]),
      ema50: Float64Array.from([9.5, 9.5]),
    }
    expect(trendAt(four, 4 * H - 1, 1)).toBe(false) // nothing has ended yet
    expect(trendAt(four, 4 * H, 1)).toBe(true) // 10 > 9.5
    expect(trendAt(four, 8 * H - 1, 1)).toBe(true) // the second has not ended
    expect(trendAt(four, 8 * H, 1)).toBe(false) // 9 < 9.5
    expect(trendAt(four, 8 * H, -1)).toBe(true)
    expect(trendAt(four, 4 * H, -1)).toBe(false)
  })
  it('C4: fills stamped 03:00 to 11:59 New York time', () => {
    const u = (m: number, d: number, h: number, mi = 0) => Date.UTC(2015, m, d, h, mi) / 1000
    expect(inLondonNyHours(u(6, 1, 6, 59))).toBe(false) // 02:59 EDT
    expect(inLondonNyHours(u(6, 1, 7))).toBe(true) // 03:00 EDT
    expect(inLondonNyHours(u(6, 1, 15, 59))).toBe(true) // 11:59 EDT
    expect(inLondonNyHours(u(6, 1, 16))).toBe(false) // 12:00 EDT
    expect(inLondonNyHours(u(0, 15, 7, 59))).toBe(false) // 02:59 EST
    expect(inLondonNyHours(u(0, 15, 8))).toBe(true) // 03:00 EST
    expect(inLondonNyHours(Date.UTC(2006, 2, 20, 7) / 1000)).toBe(false) // 02:00 EST in 2006
  })
})

describe('fills on 1-minute candles', () => {
  it('a buy target fills at the target; the fill minute checks only the stop', () => {
    const b = minutes([
      [101, 106, 99.5, 100], // fill minute: 106 passes the target, not counted
      [100, 104, 99, 103],
      [103, 106, 102, 105],
    ])
    const o = runSingle(b, pos(b), 105)
    expect([o.how, o.at, o.time, o.after, o.slips]).toEqual(['target', 2, T0 + 120, 0.5, 0])
    expect(o.before).toBeCloseTo(0.575, 12) // + 0.75 / 10
    expect(o.double).toBeCloseTo(0.425, 12)
  })
  it('a buy stop fills at the stop, or at the open beyond it, less 0.2 pip', () => {
    const b = minutes([
      [101, 101, 99.5, 100],
      [100, 101, 89, 95],
    ])
    const o = runSingle(b, pos(b), 105)
    expect([o.how, o.at, o.slips]).toEqual(['stop', 1, 1])
    expect(o.after).toBeCloseTo(-1.025, 12) // (90 - 100 - 0.25) / 10
    expect(o.before).toBeCloseTo(-0.925, 12) // + (0.75 + 0.25) / 10
    expect(o.double).toBeCloseTo(-1.125, 12)
    const gap = minutes([
      [101, 101, 99.5, 100],
      [88, 89, 87, 88],
    ])
    expect(runSingle(gap, pos(gap), 105).after).toBeCloseTo(-1.225, 12) // (88 - 100 - 0.25) / 10
    const fillStop = minutes([[101, 101, 89.5, 95]])
    expect(runSingle(fillStop, pos(fillStop), 105).at).toBe(0)
  })
  it('stop and target in one minute: the stop counts', () => {
    const b = minutes([
      [101, 101, 99.5, 100],
      [100, 106, 89, 100],
    ])
    expect(runSingle(b, pos(b), 105).how).toBe('stop')
  })
  it('a sell stop is hit when the Bid high plus the spread reaches it', () => {
    const sell = (b: Bars) => pos(b, { dir: -1, entry: 100, stop: 110 })
    const b = minutes([
      [99, 99, 99, 99],
      [100, 109.2, 99, 100], // 109.95 < 110
      [100, 109.25, 99, 100], // 110
    ])
    const o = runSingle(b, sell(b), 95)
    expect([o.how, o.at]).toEqual(['stop', 2])
    expect(o.after).toBeCloseTo(-1.025, 12)
    const gap = minutes([
      [99, 99, 99, 99],
      [109.5, 109.6, 109, 109.5], // Ask open 110.25 is beyond 110
    ])
    expect(runSingle(gap, sell(gap), 95).after).toBeCloseTo(-1.05, 12) // (100 - 110.25 - 0.25) / 10
    const tgt = minutes([
      [99, 99, 99, 99],
      [99, 99, 94.3, 95], // Ask low 95.05
      [96, 96, 94.25, 95], // Ask low 95: the target
    ])
    const t = runSingle(tgt, sell(tgt), 95)
    expect([t.how, t.at, t.after]).toEqual(['target', 2, 0.5])
  })
  it('closes at the open of the first minute of the 481st chart candle, before any other test', () => {
    const rows = flatCandles(482, 100)
    rows[480] = [rows[480][0], 100.5, 101, 80, 100]
    const b = bars(rows)
    const c = buildChart(b, 15)
    expect(timeExitIdx(c, 0)).toBe(480)
    const o = runSingle(b, pos(b, { timeIdx: timeExitIdx(c, 0) }), 105)
    expect([o.how, o.at, o.slips]).toEqual(['time', 480, 1])
    expect(o.after).toBeCloseTo(0.025, 12) // (100.5 - 100 - 0.25) / 10
    // A sell closes at the Ask: open + spread.
    const s = runSingle(b, pos(b, { dir: -1, stop: 200, timeIdx: 480 }), 50)
    expect(s.after).toBeCloseTo((100 - 101.25 - 0.25) / 10, 12)
    // Counting the fill candle as the first: a fill in a candle's second minute.
    const two = bars(
      Array.from({ length: 962 }, (_, i) => [T0 + (i >> 1) * Q + (i % 2) * 60, 1, 1, 1, 1] as Row),
    )
    const c2 = buildChart(two, 15)
    expect(timeExitIdx(c2, 1)).toBe(960)
    expect(timeExitIdx(buildChart(bars(flatCandles(480, 1)), 15), 0)).toBe(-1)
  })
  it('a trade still open at the last minute of the data closes there at market', () => {
    const b = minutes([
      [100.75, 101, 100, 101],
      [101, 103, 100, 102],
    ])
    const o = runSingle(b, pos(b), 105)
    expect([o.how, o.at, o.slips]).toEqual(['end', 1, 1])
    expect(o.after).toBeCloseTo(0.175, 12) // (102 - 100 - 0.25) / 10
  })
})

describe('the seven exits', () => {
  it('X1 and X2 targets: D + 0.382 and 0.618 x (A - D); sells D - f x (D - A)', () => {
    expect(patternTargets(pat(0))[0]).toBeCloseTo(119.1, 12)
    expect(patternTargets(pat(0))[1]).toBeCloseTo(130.9, 12)
    const sell = patternTargets(pat(0, { dir: -1, a: { idx: 0, time: T0, price: 50 } }))
    expect(sell[0]).toBeCloseTo(80.9, 12)
    expect(sell[1]).toBeCloseTo(69.1, 12)
  })
  it('X1 to X7 on one buy (entry 100, R 10)', () => {
    const b = minutes([
      [100.75, 101, 100, 100.5],
      [101, 112, 101, 111], // X4 (110)
      [111, 116, 110, 115], // X5 (115)
      [115, 119.1, 114, 118], // X1 (119.1)
      [118, 125, 117, 124], // X6 (120)
      [124, 131, 123, 130], // X2 (130.9), X7 (130), X3's rest
    ])
    const x = runExits(b, pos(b), 119.1, 130.9)
    expect(x.map((o) => [o.how, o.at])).toEqual([
      ['target', 3],
      ['target', 5],
      ['target', 5],
      ['target', 1],
      ['target', 2],
      ['target', 4],
      ['target', 5],
    ])
    const r = [1.91, 3.09, 2.5, 1, 1.5, 2, 3]
    x.forEach((o, i) => expect(o.after).toBeCloseTo(r[i], 12))
    expect(x[2].half).toBe(true)
  })
  it('X3: in the minute of the first half nothing happens to the rest; then its stop is the entry', () => {
    const b = minutes([
      [100.75, 101, 100, 100.5],
      [101, 119.1, 99, 110], // half at 119.1; the low 99 does not touch the rest
      [101, 102, 99.5, 100], // the rest's stop at the entry price, a stop fill
    ])
    const o = runSplit(b, pos(b), 119.1, 130.9)
    expect([o.how, o.at, o.half, o.slips]).toEqual(['stop', 2, true, 0.5])
    expect(o.after).toBeCloseTo((19.1 + (0 - 0.25)) / 2 / 10, 12) // 0.9425
    expect(o.before).toBeCloseTo(0.9425 + (0.75 + 0.5 * 0.25) / 10, 12)
    expect(o.double).toBeCloseTo(0.9425 - (0.75 + 0.5 * 0.25) / 10, 12)
    // Stopped before the first half: the whole trade at the stop.
    const s = minutes([
      [100.75, 101, 100, 100.5],
      [100, 101, 89, 95],
    ])
    const o2 = runSplit(s, pos(s), 119.1, 130.9)
    expect([o2.how, o2.half, o2.slips]).toEqual(['stop', false, 1])
    expect(o2.after).toBeCloseTo(-1.025, 12)
  })
})

describe('entries', () => {
  it('E0 fills in the completing minute at D; R = D - stop; trend and hours flags', () => {
    const ctx = ctxOf(flatCandles(10, 100.5))
    const t = entryE0(ctx, pat(5))
    expect(t).toMatchObject({
      entry: 'E0',
      status: 'filled',
      fill: 5,
      fillTime: T0 + 5 * Q,
      fillCandle: 5,
      entryPrice: 100,
      entryBid: 99.25,
      spread: 0.75,
      cost: 0.75,
      R: 10,
      rPips: 10,
      entrySlip: 0,
      trend: false,
      hours: false, // 01:15 UTC Monday = 20:15 EST
    })
    expect(t.exits).toHaveLength(7)
    expect(t.exits[0].how).toBe('end')
  })
  it('skips a trade whose R is under 5 times the round-trip cost', () => {
    const ctx = ctxOf(flatCandles(10, 100.5))
    expect(entryE0(ctx, pat(5, { stop: 97 })).status).toBe('skipRisk') // R 3 < 3.75
    expect(entryE0(ctx, pat(5, { stop: 96.25 })).status).toBe('filled') // R 3.75, not under
  })
  it('gold: spread 0.28 x D / 1800 for the order at D, and $0.07 an ounce', () => {
    const rows = flatCandles(10, 1801)
    rows[7] = [rows[7][0], 1800, 1800, 1798, 1799]
    const ctx = ctxOf(rows, MARKET_COSTS.XAUUSD)
    const g = (stop: number) =>
      entryE0(ctx, pat(5, { d: 1800, stop, a: { idx: 0, time: T0, price: 1900 } }))
    expect(g(1798.3).status).toBe('skipRisk') // R 1.7 < 5 x 0.35
    const t = g(1798.2)
    expect(t.status).toBe('filled')
    expect(t.spread).toBeCloseTo(0.28, 12)
    expect(t.cost).toBeCloseTo(0.35, 12)
    expect(t.R).toBeCloseTo(1.8, 9)
    expect(t.rPips).toBeCloseTo(18, 9)
    const x4 = t.exits[3]
    expect([x4.how, x4.at]).toEqual(['stop', 7])
    expect(x4.after).toBeCloseTo((1798.2 - 1800 - 0.07 - 0.02) / 1.8, 9) // -1.05
    expect(x4.before).toBeCloseTo(-1.05 + (0.28 + 0.07 + 0.02) / 1.8, 9)
    expect(x4.double).toBeCloseTo(-1.05 - (0.28 + 0.07 + 0.02) / 1.8, 9)
  })

  // Flat at 100.5 between the stop (90) and X1's target (119.1); completing in candle 5.
  const c1ctx = (setup: (ctx: HarmonicContext, rows: Row[]) => void, n = 20) => {
    const rows = flatCandles(n, 100.5)
    const ctx = ctxOf(rows)
    setup(ctx, rows)
    return { ...ctxOf(rows), rsi: ctx.rsi, ema20: ctx.ema20 }
  }

  it('C1 triggers on a close above the EMA(20) at or after an RSI(14) close at or below 30', () => {
    const ctx = c1ctx((c) => {
      c.rsi[6] = 28
      c.ema20[7] = 100
    })
    const t = entryConfirmed(ctx, pat(5), 'C1')
    expect(t).toMatchObject({ status: 'filled', trigger: 7, fill: 8, fillCandle: 8 })
    expect(t.entryPrice).toBe(101.25) // the Ask at candle 8's open
    expect(t.R).toBe(11.25)
    expect(t.entrySlip).toBe(1)
    // RSI exactly 30 and the close above the EMA in the same candle.
    const same = c1ctx((c) => {
      c.rsi[6] = 30
      c.ema20[6] = 100
    })
    expect(entryConfirmed(same, pat(5), 'C1').trigger).toBe(6)
  })
  it('C1 ignores a close above the EMA before RSI was low, and stops after 12 candles', () => {
    const before = c1ctx((c) => {
      c.ema20[5] = 100
      c.rsi[6] = 28
    })
    expect(entryConfirmed(before, pat(5), 'C1').status).toBe('noTrigger')
    const last = c1ctx((c) => {
      c.rsi[5] = 20
      c.ema20[16] = 100 // candle 12 counting candle 5 as 1
    })
    expect(entryConfirmed(last, pat(5), 'C1').trigger).toBe(16)
    const late = c1ctx((c) => {
      c.rsi[5] = 20
      c.ema20[17] = 100
    })
    expect(entryConfirmed(late, pat(5), 'C1').status).toBe('noTrigger')
    // RSI that does not exist yet (NaN) is never low.
    const nan = c1ctx((c) => {
      c.ema20[7] = 100
    })
    expect(entryConfirmed(nan, pat(5), 'C1').status).toBe('noTrigger')
  })
  it('C1 for a sell: RSI at or above 70 and a close below the EMA', () => {
    const ctx = c1ctx((c) => {
      c.ema20.fill(0)
      c.rsi[6] = 70
      c.ema20[8] = 101
    })
    const p = pat(5, { dir: -1, d: 100.5, stop: 110, a: { idx: 0, time: T0, price: 50 } })
    const t = entryConfirmed(ctx, p, 'C1')
    expect([t.status, t.trigger, t.entryPrice]).toEqual(['filled', 8, 100.5])
    expect(t.R).toBe(9.5)
  })
  it('C2 triggers on a reversal candle, with no RSI test', () => {
    const at = (close: number) =>
      c1ctx((_, rows) => {
        rows[7] = [rows[7][0], 100.5, 103, 100, close] // range 3: close >= 102 and > 100.5
      })
    expect(entryConfirmed(at(102.5), pat(5), 'C2').trigger).toBe(7)
    expect(entryConfirmed(at(102), pat(5), 'C2').trigger).toBe(7)
    expect(entryConfirmed(at(101.9), pat(5), 'C2').status).toBe('noTrigger')
    const sell = c1ctx((_, rows) => {
      rows[7] = [rows[7][0], 100.5, 101, 98, 99] // close < 100.5 and <= 98 + 1
    })
    const p = pat(5, { dir: -1, d: 100.5, stop: 110, a: { idx: 0, time: T0, price: 50 } })
    expect(entryConfirmed(sell, p, 'C2').trigger).toBe(7)
  })
  it('cancels C1 and C2 when a minute through the trigger candle reaches the stop or X1', () => {
    const ctx = c1ctx((c, rows) => {
      c.rsi[6] = 28
      c.ema20[7] = 100
      rows[6] = [rows[6][0], 100.5, 119.2, 100.5, 100.5]
    })
    expect(entryConfirmed(ctx, pat(5), 'C1').status).toBe('cancelled')
    const stop = c1ctx((c, rows) => {
      c.rsi[6] = 28
      c.ema20[7] = 100
      rows[5] = [rows[5][0], 100.5, 100.5, 90, 100.5] // the completing minute itself
    })
    expect(entryConfirmed(stop, pat(5), 'C1').status).toBe('cancelled')
    const after = c1ctx((c, rows) => {
      c.rsi[6] = 28
      c.ema20[7] = 100
      rows[9] = [rows[9][0], 100.5, 119.1, 100.5, 100.5] // after the entry: no cancel
    })
    expect(entryConfirmed(after, pat(5), 'C1').status).toBe('filled')
  })
  it('skips C1 when the entry is beyond X1 or the stop, or R is too small', () => {
    const at = (open: number) =>
      c1ctx((c, rows) => {
        c.rsi[6] = 28
        c.ema20[7] = 100
        rows[8] = [rows[8][0], open, open, open, open]
      })
    expect(entryConfirmed(at(118.4), pat(5), 'C1').status).toBe('skipEntry') // Ask 119.15
    expect(entryConfirmed(at(118.3), pat(5), 'C1').status).toBe('filled') // Ask 119.05
    expect(entryConfirmed(at(90), pat(5), 'C1').status).toBe('skipEntry') // Bid at the stop
    expect(entryConfirmed(at(92), pat(5), 'C1').status).toBe('skipRisk') // R 2.75
    const end = c1ctx((c) => {
      c.rsi[6] = 28
      c.ema20[7] = 100
    }, 8)
    expect(entryConfirmed(end, pat(5), 'C1').status).toBe('noData')
  })
  it("gold's market entry spread is 0.28 x the Bid at entry / 1800", () => {
    const rows = flatCandles(12, 2700)
    const ctx = { ...ctxOf(rows, MARKET_COSTS.XAUUSD) }
    ctx.rsi[6] = 28
    ctx.ema20.fill(3000)
    ctx.ema20[7] = 2600
    const p = pat(5, { d: 2700, stop: 2680, a: { idx: 0, time: T0, price: 2800 } })
    const t = entryConfirmed(ctx, p, 'C1')
    expect(t.spread).toBeCloseTo(0.42, 12)
    expect(t.entryPrice).toBeCloseTo(2700.42, 9)
    expect(t.cost).toBeCloseTo(0.49, 12)
  })
  it('C3 and C5 carry the trend at the confirming close; C4 the hours of the fill', () => {
    const ctx = c1ctx((c) => {
      c.rsi[6] = 28
      c.ema20[7] = 100
    })
    ctx.four = {
      n: 1,
      start: Float64Array.from([T0 - 4 * H]),
      end: Float64Array.from([T0]),
      close: Float64Array.from([2]),
      ema50: Float64Array.from([1]),
    }
    expect(entryE0(ctx, pat(5)).trend).toBe(true) // C3
    expect(entryConfirmed(ctx, pat(5), 'C1').trend).toBe(true) // C5
    expect(entryE0(ctx, pat(5, { confirmClose: T0 - 1 })).trend).toBe(false)
    expect(entryE0(ctx, pat(5, { dir: -1, stop: 110 })).trend).toBe(false)
    // C5 not triggering: the same C1 trade, with the 4-hour close below its EMA(50).
    ctx.four = { ...ctx.four, close: Float64Array.from([0.5]) }
    const c5 = entryConfirmed(ctx, pat(5), 'C1')
    expect([c5.status, c5.trend]).toEqual(['filled', false])
    // 2015-01-05 08:15 UTC = 03:15 EST: inside the hours.
    const morning = ctxOf(
      Array.from({ length: 40 }, (_, i) => [T0 + i * Q, 100.5, 100.5, 100.5, 100.5]),
    )
    expect(entryE0(morning, pat(33)).hours).toBe(true)
    expect(entryE0(morning, pat(31)).hours).toBe(false) // 07:45 UTC = 02:45 EST
  })
})

describe('look-back measures', () => {
  // Buy: entry Ask 100, Bid 99.25, stop 90, R 10.
  const rows: Row[] = [
    [T0, 100.5, 101, 99.25, 100], // the fill minute does not count
    [T0 + 60, 100, 103, 98, 102], // favour 3.75, against 1.25
    [T0 + 4 * H, 102, 106, 100, 104], // favour 6.75
    [T0 + 12 * H + 60, 104, 104, 95, 96], // against 4.25
    [T0 + 30 * H, 95, 107, 89, 92], // the stop: against 9.25, its high adds nothing
  ]
  const b = bars(rows)
  const l = lookBack(b, pos(b))

  it('furthest in favour and against, in price, R and pips', () => {
    expect([l.favour, l.against]).toEqual([6.75, 9.25])
    expect([l.favourR, l.againstR]).toEqual([0.675, 0.925])
    expect([l.favourPips, l.againstPips]).toEqual([6.75, 9.25])
    expect([l.path.how, l.path.at]).toEqual(['stop', 4])
  })
  it('targets in R and in pips, tested with the stop', () => {
    expect(l.targetsR.map((o) => o.how)).toEqual(['target', 'stop', 'stop', 'stop', 'stop'])
    expect(l.targetsR[0].after).toBe(0.5)
    expect(l.targetsR[1].after).toBeCloseTo(-1.025, 12)
    expect(l.targetsPips.map((o) => o.how)).toEqual([
      'target',
      'stop',
      'stop',
      'stop',
      'stop',
      'stop',
    ])
  })
  it('worth at the first minute at or after 4, 12, 24, 48, 72 and 120 hours', () => {
    expect(l.worth.map((o) => o.how)).toEqual(['close', 'close', 'close', 'stop', 'stop', 'stop'])
    expect(l.worth[0].after).toBeCloseTo(0.175, 12) // open 102
    expect(l.worth[1].after).toBeCloseTo(0.375, 12) // open 104
    expect(l.worth[2].after).toBeCloseTo(-0.525, 12) // open 95, before the stop in that minute
    expect(l.worth[3].after).toBeCloseTo(-1.025, 12)
  })
  it('a sell measures the Bid; the full distance to the stop is stop - spread - entry Bid', () => {
    const s = minutes([
      [100, 100, 100, 100],
      [100, 101, 97, 98], // favour 3, against 1
      [100, 109.25, 99, 100], // Ask 110: the stop
    ])
    const ls = lookBack(s, pos(s, { dir: -1, entry: 100, stop: 110 }))
    expect([ls.favour, ls.against]).toEqual([3, 9.25])
  })
  it('the fill minute counts when its stop is hit', () => {
    const s = minutes([[100.5, 101, 89, 95]])
    const ls = lookBack(s, pos(s))
    expect([ls.favour, ls.against, ls.path.at]).toEqual([0, 9.25, 0])
  })
})

describe('twins', () => {
  it('keep the stop and target distances and the entry slip of their trade', () => {
    const rows = flatCandles(12, 100.5)
    rows[9] = [rows[9][0], 200, 200, 200, 200]
    rows[10] = [rows[10][0], 200, 220, 199, 210]
    const ctx = ctxOf(rows)
    const trade = entryE0(ctx, pat(5))
    expect(minuteAt(ctx.bars, T0 + 9 * Q)).toBe(9)
    expect(minuteAt(ctx.bars, T0 + 9 * Q + 60)).toBe(-1)
    // Entry Ask 200.75, X1 at 200.75 + 19.1, no entry slip (its trade was an order at D).
    const x1 = simulateTwin(ctx, trade, 0, 9)
    expect([x1.how, x1.at]).toEqual(['target', 10])
    expect(x1.after).toBeCloseTo(1.91, 12)
    const x4 = simulateTwin(ctx, trade, 3, 9)
    expect(x4.after).toBeCloseTo(1, 12)
    // The twin of a market entry pays the 0.2 pip.
    const paid = { ...trade, entrySlip: 1 }
    expect(simulateTwin(ctx, paid, 0, 9).after).toBeCloseTo((19.1 - 0.25) / 10, 12)
  })
  it('count their time exit from their own entry candle', () => {
    const ctx = ctxOf(flatCandles(490, 100.5))
    const trade = entryE0(ctx, pat(0))
    const tw = simulateTwin(ctx, trade, 3, 3)
    expect([tw.how, tw.at]).toEqual(['time', 483])
  })
})

describe('the run', () => {
  it('gives every pattern and its E0, C1 and C2 trades', () => {
    // The zigzag of harmonicFind.test.ts: a Gartley buy, D 1107, stop 975, completing in candle 170.
    const levels = [1310, 1000, 1500, 1190, 1440, 1100]
    const rows: Row[] = []
    for (let s = 1; s < levels.length; s++) {
      const [p, q] = [levels[s - 1], levels[s]]
      for (let v = p; v !== q; v += q > p ? 10 : -10) {
        const t = T0 + rows.length * Q
        rows.push(q > p ? [t, v, v + 10, v, v + 10] : [t, v, v, v - 10, v - 10])
      }
    }
    const b = bars(rows)
    const ctx = { ...harmonicContext(b, 'EURUSD', 15), costs: TESTC }
    const run = runHarmonic(ctx, 2)
    expect(run.patterns).toHaveLength(1)
    expect(run.trades.map((t) => [t.entry, t.status])).toEqual([
      ['E0', 'filled'],
      ['C1', 'noTrigger'],
      ['C2', 'noTrigger'],
    ])
    const e0 = run.trades[0]
    expect([e0.fill, e0.entryPrice, e0.R]).toEqual([170, 1107, 132])
    // The data end in the fill minute: closed at its close, 1100, at market.
    expect(e0.exits[0].how).toBe('end')
    expect(e0.exits[0].after).toBeCloseTo((1100 - 1107 - 0.25) / 132, 12)
    // The same patterns as the finder alone.
    expect(run.patterns).toEqual(findPatterns(b, ctx.chart, TESTC, 2))
  })
  it('barsBefore keeps only the minutes stamped before a time', () => {
    const b = bars(flatCandles(5, 1))
    const cut = barsBefore(b, T0 + 3 * Q)
    expect(cut.n).toBe(3)
    expect([...cut.time]).toEqual([T0, T0 + Q, T0 + 2 * Q])
  })
})
