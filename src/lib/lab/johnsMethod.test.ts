import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { seeded } from './control'
import { nyCloseBars } from './load'
import {
  dailyLines,
  DESIGN_WARMUP,
  DESIGN_Y1,
  dollarSide,
  entryFill,
  EXAM_FROM,
  EXAM_TO,
  expiryDead,
  fillCandle,
  filterSearch,
  findSignals,
  forcedFill,
  FREEZE_FILE,
  holdDeadline,
  hourMult,
  impulseJM,
  JM,
  JM_MARKET,
  jmFreezeProblems,
  lvl,
  NORMAL,
  pairBeats,
  pickStructure,
  prepareJm,
  readWindow,
  rescore,
  riskPerUnitUsd,
  roundTrip,
  simulate,
  stepCandle,
  stopFill,
  stopHit,
  swapNights,
  targetHit,
  examLines,
  type FilterTrade,
  type JmData,
  type JmFreezeRecord,
  type JmMarketId,
  type JmPair,
  type JmSizing,
  type JmTrade,
  type JmSignal,
} from './johnsMethod'
import { DAY, HOUR } from './time'

const utc = (y: number, mo: number, d: number, h = 0) => Date.UTC(y, mo - 1, d, h) / 1000
const bar = (time: number, open: number, high: number, low: number, close: number): OHLCCandle => ({
  time,
  open,
  high,
  low,
  close,
})

/** Trading hours of a forex week: Sunday 22:00 UTC to Friday 21:00 UTC. */
const isOpenHour = (t: number) => {
  const wd = new Date(t * 1000).getUTCDay()
  const h = new Date(t * 1000).getUTCHours()
  if (wd === 6) return false
  if (wd === 0) return h >= 22
  if (wd === 5) return h < 21
  return true
}

/** A seeded random walk with trending stretches, 1-hour candles. */
function synth(seed: number, start: number, hours: number, p0: number, vol: number): OHLCCandle[] {
  const rnd = seeded(seed)
  const out: OHLCCandle[] = []
  let p = p0
  let drift = 0
  for (let k = 0; k < hours; k++) {
    const t = start + k * HOUR
    if (!isOpenHour(t)) continue
    if (rnd() < 0.05) drift = (rnd() - 0.5) * 1.5 * vol
    const o = p
    const c = o + drift + (rnd() - 0.5) * 2 * vol
    const hi = Math.max(o, c) + rnd() * vol * 0.6
    const lo = Math.min(o, c) - rnd() * vol * 0.6
    out.push(bar(t, o, hi, lo, c))
    p = c
  }
  return out
}

const START = utc(2025, 1, 5, 22)
const SPECS: [JmMarketId, number, number][] = [
  ['EURUSD', 1.1, 0.0012],
  ['GBPUSD', 1.3, 0.0014],
  ['USDJPY', 150, 0.18],
]
const WEEKS = 40

function makeData(mutate?: (id: JmMarketId, c: OHLCCandle[]) => OHLCCandle[]): JmData[] {
  return SPECS.map(([id, p0, vol], n) => {
    let c = synth(11 + n, START, WEEKS * 7 * 24, p0, vol)
    if (mutate) c = mutate(id, c)
    return prepareJm(id, c, nyCloseBars)
  })
}

const FROM = START + 21 * DAY
const TO = START + WEEKS * 7 * DAY

function runAll(
  data: JmData[],
  pair: JmPair,
  sizing: JmSizing,
  book: 'account' | 'signal' = 'account',
) {
  const signals = new Map(
    data.map((d) => [d.m.id, findSignals({ d, pair, expiry: 'X1', from: FROM, to: TO }).signals]),
  )
  return {
    signals,
    run: simulate({ data, signals, pair, expiry: 'X1', sizing, book, from: FROM, to: TO }),
  }
}

describe('costs and fills (2.2)', () => {
  const m = JM_MARKET.GBPUSD
  it('hour costs: rollover x4/x2, 23 and 00 UTC x1.5, after a gap x8/x5, the larger counts', () => {
    expect(hourMult(utc(2026, 3, 3, 21), false)).toMatchObject({ spread: 4, slip: 2 })
    expect(hourMult(utc(2026, 3, 3, 22), false)).toMatchObject({ spread: 4, slip: 2 })
    expect(hourMult(utc(2026, 3, 3, 23), false)).toMatchObject({ spread: 1.5, slip: 1 })
    expect(hourMult(utc(2026, 3, 3, 0), false)).toMatchObject({ spread: 1.5, slip: 1 })
    expect(hourMult(utc(2026, 3, 3, 10), false)).toMatchObject({ spread: 1, slip: 1 })
    expect(hourMult(utc(2026, 3, 1, 22), true)).toMatchObject({ spread: 8, slip: 5 })
  })
  it('one round trip and the table of fills on BID candles', () => {
    expect(roundTrip(m, 1.34)).toBeCloseTo(0.0001 + 0.00004 + 2 * 0.000025 * 1.34, 10)
    const gold = JM_MARKET.XAUUSD
    expect(roundTrip(gold, 4030)).toBeCloseTo(1.612, 2)
    expect(entryFill(m, true, 1.3)).toBeCloseTo(1.3 + 0.0001 + 0.00002, 10)
    expect(entryFill(m, false, 1.3)).toBeCloseTo(1.3 - 0.00002, 10)
    expect(forcedFill(m, false, 1.3)).toBeCloseTo(1.30012, 10)
    const b = bar(0, 1.3, 1.3009, 1.299, 1.3)
    expect(stopHit(m, false, b, 1.301, NORMAL)).toBe(true) // ask high 1.3010 reaches it
    expect(stopHit(m, false, b, 1.3012, NORMAL)).toBe(false)
    expect(stopFill(m, false, b, 1.301, NORMAL)).toBeCloseTo(1.30102, 10)
    // SELL whose ask opens over the stop: open + spread + slip
    expect(stopFill(m, false, bar(0, 1.302, 1.303, 1.301, 1.302), 1.301, NORMAL)).toBeCloseTo(
      1.30212,
      10,
    )
    expect(stopFill(m, true, bar(0, 1.298, 1.3, 1.297, 1.299), 1.299, NORMAL)).toBeCloseTo(
      1.29798,
      10,
    )
    expect(targetHit(m, false, b, 1.2991, NORMAL)).toBe(true) // bid low 1.2990 + spread = 1.2991
    expect(targetHit(m, false, b, 1.299, NORMAL)).toBe(false)
  })
  it('dollar sides and dollars for USD-base pairs', () => {
    expect(dollarSide('EURUSD', true)).toBe('USD-')
    expect(dollarSide('XAUUSD', true)).toBe('USD-')
    expect(dollarSide('USDJPY', true)).toBe('USD+')
    expect(dollarSide('USDCAD', false)).toBe('USD-')
    const j = JM_MARKET.USDJPY
    const r = 1.0 + j.slip + j.fee * (150 + 149)
    expect(riskPerUnitUsd(j, 150, 149)).toBeCloseTo(r / 149, 12)
  })
  it('swap nights: each 17:00 New York, Monday to Friday, Wednesday x3', () => {
    // Winter: 17:00 New York = 22:00 UTC.
    const mon = utc(2026, 1, 12, 10)
    expect(swapNights(mon, mon + 2 * HOUR, true)).toBe(0)
    expect(swapNights(mon, utc(2026, 1, 13, 10), true)).toBe(1)
    expect(swapNights(mon, utc(2026, 1, 15, 10), true)).toBe(1 + 1 + 3)
    expect(swapNights(utc(2026, 1, 16, 10), utc(2026, 1, 19, 10), true)).toBe(1) // Friday's only
    // An exit at the open of the rollover candle is not across it; inside it is.
    expect(swapNights(mon, utc(2026, 1, 12, 22), false)).toBe(0)
    expect(swapNights(mon, utc(2026, 1, 12, 22), true)).toBe(1)
    // Summer: 21:00 UTC.
    expect(swapNights(utc(2026, 7, 6, 10), utc(2026, 7, 6, 21), true)).toBe(1)
  })
})

describe('the move and the Fib (2.4)', () => {
  // His GBP/USD 4h drawing: an up candle (x), then the first down candle opens 1.3488, the drop ends at 1.3250.
  function gbpDrop(): OHLCCandle[] {
    const c: OHLCCandle[] = []
    let t = utc(2026, 10, 20, 1)
    for (let k = 0; k < 20; k++, t += 4 * HOUR) c.push(bar(t, 1.346, 1.3475, 1.3445, 1.3462))
    c.push(bar(t, 1.3462, 1.3492, 1.3458, 1.3488)) // x: the last up candle
    t += 4 * HOUR
    const path = [1.3488, 1.344, 1.338, 1.3335, 1.329, 1.3262]
    for (let k = 1; k < path.length; k++, t += 4 * HOUR)
      c.push(bar(t, path[k - 1], path[k - 1] + 0.0004, path[k] - 0.0003, path[k]))
    c.push(bar(t, 1.3262, 1.3268, 1.325, 1.3256)) // j: the low of the drop
    return c
  }
  it('anchor A: 1 = the open of the first down candle, 0 = the low; 0.786 = 1.3437, 0.886 = 1.3461', () => {
    const c = gbpDrop()
    const atr = atrSeries(c, 14)
    const j = c.length - 1
    const s = impulseJM(c, atr, j, false)!
    expect(s).not.toBeNull()
    expect(s.one).toBeCloseTo(1.3488, 6)
    expect(s.zero).toBeCloseTo(1.325, 6)
    expect(c[s.x].close > c[s.x].open).toBe(true)
    expect(s.y).toBe(s.x + 1)
    expect(lvl(s, 0.786)).toBeCloseTo(1.3437, 4)
    expect(lvl(s, 0.886)).toBeCloseTo(1.3461, 4)
    expect(lvl(s, -0.272)).toBeLessThan(s.zero)
  })
  it('no setup when the move from 1 is under 2 ATR, or no candle of the move follows x', () => {
    const c = gbpDrop()
    const atr = atrSeries(c, 14)
    const j = c.length - 1
    const big = atr.map((a) => a * 50)
    expect(impulseJM(c, big, j, false)).toBeNull()
    // Every candle after x is an up candle (closes above its open) while lows fall: no down candle.
    const up = c.map((b, k) =>
      k > 20 ? { ...b, close: b.open + 0.00001, high: Math.max(b.high, b.open + 0.00001) } : b,
    )
    expect(impulseJM(up, atrSeries(up, 14), j, false)).toBeNull()
  })
  it('expiry rules X1, X2, X3 with their bounds', () => {
    const s = { w: 0, travel: 0, move: 0.006, atrRef: 0.002 }
    // X1: W = 6 x move / ATR = 18 -> 4 x 18 = 72 entry candles.
    expect(expiryDead('X1', 4, { ...s, w: 71 }, 0.002)).toBe(false)
    expect(expiryDead('X1', 4, { ...s, w: 72 }, 0.002)).toBe(true)
    expect(expiryDead('X1', 4, { ...s, w: 47 }, 0.01)).toBe(false) // W floored at 12
    expect(expiryDead('X1', 4, { ...s, w: 48 }, 0.01)).toBe(true)
    expect(expiryDead('X1', 4, { ...s, w: 287, move: 1 }, 0.002)).toBe(false) // capped at 72
    expect(expiryDead('X1', 4, { ...s, w: 288, move: 1 }, 0.002)).toBe(true)
    // X2: travel 8 x move, or 72 Fib candles.
    expect(expiryDead('X2', 4, { ...s, travel: 0.0479 }, 0.002)).toBe(false)
    expect(expiryDead('X2', 4, { ...s, travel: 0.048 }, 0.002)).toBe(true)
    expect(expiryDead('X2', 6, { ...s, w: 432 }, 0.002)).toBe(true)
    // X3: 24 x ATRref / ATRnow, 12 to 48.
    expect(expiryDead('X3', 4, { ...s, w: 95 }, 0.002)).toBe(false)
    expect(expiryDead('X3', 4, { ...s, w: 96 }, 0.002)).toBe(true)
    expect(expiryDead('X3', 4, { ...s, w: 191 }, 0.0005)).toBe(false)
    expect(expiryDead('X3', 4, { ...s, w: 192 }, 0.0005)).toBe(true)
    expect(expiryDead('X3', 4, { ...s, w: 48 }, 0.01)).toBe(true)
  })
})

describe('daily lines (2.3)', () => {
  it('a swing exists only from the close of the fifth candle after it; trend from the last two', () => {
    const t0 = utc(2025, 1, 1, 22)
    const highs = [10, 11, 12, 13, 14, 20, 14, 13, 12, 11, 10, 9, 10, 11, 12, 15, 12, 11, 10, 9, 8]
    const c = highs.map((h, k) =>
      bar(t0 + k * DAY, h - 1, h, h - 2 - (k === 11 ? 3 : 0) - (k === 19 ? 1 : 0), h - 1),
    )
    const d1 = { c, sec: DAY, atr: atrSeries(c, 14), tr: [], rsi: [] }
    // Swing high at 5 (20): confirmed at the close of candle 10.
    expect(dailyLines(d1, c[9].time + DAY).highs).toEqual([])
    expect(dailyLines(d1, c[10].time + DAY).highs).toEqual([20])
    const later = dailyLines(d1, c[20].time + DAY)
    expect(later.highs).toEqual([15, 20])
    expect(later.highs.length).toBeLessThanOrEqual(3)
  })
})

describe('signals (2.5, 2.6) and look-ahead guards (2.12)', () => {
  const data = makeData()
  const d = data[1]
  const sigs = findSignals({ d, pair: 'H4H1', expiry: 'X1', from: FROM, to: TO }).signals
  it('finds signals on the synthetic market', () => {
    expect(sigs.length).toBeGreaterThan(5)
  })
  it('a signal candle reaches 0.786 without passing 1, and arms only after the Fib candle closed', () => {
    for (const s of sigs) {
      if (s.long) expect(s.low <= s.L786 + 1e-12 && s.low >= s.one).toBe(true)
      else expect(s.high >= s.L786 - 1e-12 && s.high <= s.one).toBe(true)
      expect(s.armedAt).toBe(s.jTime + 4 * HOUR)
      expect(s.sigTime).toBeGreaterThanOrEqual(s.armedAt)
      expect(s.armedAt).toBeGreaterThanOrEqual(FROM)
    }
  })
  it('the stop is past 1 by 0.5 x ATR_F (read at T), never inside the cost floor from 0.886', () => {
    for (const s of sigs) {
      const pad = Math.abs(s.S - s.one)
      const floor = Math.abs(s.S - s.L886)
      expect(pad >= 0.5 * s.atrF - 1e-12 || floor >= 10 * roundTrip(d.m, s.L886) - 1e-12).toBe(true)
      expect(Math.abs(s.S - s.one) >= 0.5 * s.atrF - 1e-12).toBe(true)
      // ATR_F: the 4h candle closed at or before T, not the one still open.
      const k = d.h4.c.findIndex((b) => b.time + 4 * HOUR > s.T) - 1
      expect(s.atrF).toBe(d.h4.atr[k])
    }
  })
  it('fills at the next 1-hour open, at most 2 hours after the deciding close', () => {
    for (const s of sigs) {
      if (s.fillIdx == null) continue
      const b = d.h1.c[s.fillIdx]
      expect(b.time).toBeGreaterThanOrEqual(s.T)
      expect(b.time - s.T).toBeLessThanOrEqual(2 * HOUR)
      expect(d.h1.c[s.fillIdx - 1].time).toBeLessThan(s.T)
      expect(s.E1).toBeCloseTo(entryFill(d.m, s.long, b.open, d.mult[s.fillIdx]), 12)
    }
    const h1 = [bar(0, 1, 1, 1, 1), bar(3 * HOUR, 1, 1, 1, 1)]
    expect(fillCandle(h1, HOUR)).toBe(1) // 2 hours later is the limit
    expect(fillCandle(h1, 1)).toBe(null)
    expect(fillCandle(h1, 0)).toBe(0)
  })
  it('0 follows the move and w restarts each time it moves', () => {
    for (const s of sigs) {
      const j = d.h4.c.findIndex((b) => b.time === s.jTime)
      let zero = s.long ? d.h4.c[j].high : d.h4.c[j].low
      let w = 0
      for (let i = d.h1.c.findIndex((b) => b.time >= s.armedAt); i <= s.i; i++) {
        const b = d.h1.c[i]
        if (s.long ? b.high > zero : b.low < zero) {
          zero = s.long ? b.high : b.low
          w = 0
        } else w++
      }
      expect(w).toBe(s.w)
      expect(zero).toBe(s.zero)
    }
  })
  it('passes every check of 2.6 or names the first one that failed', () => {
    for (const s of sigs.filter((x) => !x.check)) {
      expect(s.planRR!).toBeGreaterThanOrEqual(1.5)
      expect(Math.abs(s.E1! - s.S)).toBeGreaterThanOrEqual(10 * roundTrip(d.m, s.p!) - 1e-12)
    }
  })
})

describe('exits (2.9)', () => {
  const m = JM_MARKET.EURUSD
  const trade = (long: boolean): JmTrade =>
    ({
      market: 'EURUSD',
      long,
      stop: long ? 1.09 : 1.11,
      tp1Paid: false,
      sig: { tp1: long ? 1.11 : 1.09, tp2: long ? 1.12 : 1.08 } as JmSignal,
      parts: [
        {
          kind: 'all',
          idx: 0,
          time: 0,
          p: 1.1,
          E: 1.1,
          units: 1000,
          unitsOpen: 1000,
          rpuUsd: 0.01,
          riskUsd: 10,
          nearRedNews: 'no',
          chunks: [],
        },
      ],
    }) as unknown as JmTrade
  it('a candle that reaches the stop and a target: the stop counts', () => {
    const t = trade(true)
    const done = stepCandle(m, t, bar(HOUR, 1.1, 1.125, 1.085, 1.1), NORMAL, () => {})
    expect(done).toBe(true)
    expect(t.why).toBe('stop')
    expect(t.parts[0].chunks).toHaveLength(1)
  })
  it('TP1 closes half of the units open, TP2 the rest', () => {
    const t = trade(false)
    expect(stepCandle(m, t, bar(HOUR, 1.1, 1.101, 1.0895, 1.09), NORMAL, () => {})).toBe(false)
    expect(t.parts[0].unitsOpen).toBeCloseTo(500, 9)
    expect(stepCandle(m, t, bar(2 * HOUR, 1.09, 1.091, 1.079, 1.08), NORMAL, () => {})).toBe(true)
    expect(t.why).toBe('tp2')
    expect(t.parts[0].unitsOpen).toBe(0)
  })
})

describe('runs: sizing caps, the ladder, the double down (2.7, 2.8, 2.10)', () => {
  const data = makeData()
  const byId = new Map(data.map((d) => [d.m.id, d]))
  const riskTo = (t: JmTrade) =>
    t.parts.reduce((a, p) => a + p.units * riskPerUnitUsd(JM_MARKET[t.market], p.E, t.stop), 0)
  for (const pair of ['H4H1', 'DH4'] as JmPair[]) {
    const C = runAll(data, pair, 'C', 'signal').run
    const U = runAll(data, pair, 'U', 'signal').run
    const A = runAll(data, pair, 'A', 'signal').run
    it(`${pair}: capped never risks over 2%, uncapped over 3%, all at once 2% in one part`, () => {
      expect(C.trades.length).toBeGreaterThan(0)
      for (const t of C.trades) expect(riskTo(t)).toBeLessThanOrEqual(200 + 1e-6)
      for (const t of U.trades) expect(riskTo(t)).toBeLessThanOrEqual(300 + 1e-6)
      for (const t of A.trades) {
        expect(t.parts).toHaveLength(1)
        expect(t.parts[0].riskUsd).toBeCloseTo(200, 6)
      }
    })
    it(`${pair}: halves risk 1% each, at most one add, the add's stop never further than S`, () => {
      for (const t of [...C.trades, ...U.trades]) {
        expect(t.parts.filter((p) => p.kind === 'add').length).toBeLessThanOrEqual(1)
        for (const p of t.parts.filter((q) => q.kind !== 'add'))
          expect(p.riskUsd).toBeCloseTo(100, 6)
        if (t.S2 != null) {
          if (t.long) expect(t.S2).toBeGreaterThanOrEqual(t.sig.S)
          else expect(t.S2).toBeLessThanOrEqual(t.sig.S)
        }
      }
    })
    it(`${pair}: ladder life 24 entry candles; the add only after two strong neighbours after the first fill`, () => {
      const ent = pair === 'H4H1' ? 'h1' : 'h4'
      for (const t of [...C.trades, ...U.trades]) {
        const d = byId.get(t.market)!
        const ch = d[ent]
        for (const p of t.parts.filter((q) => q.kind === 'half2' || q.kind === 'add')) {
          if (p.time === t.firstFill) continue
          const k = ch.c.findIndex((b) => b.time + ch.sec > p.time) - 1 // the deciding candle
          expect(k - t.sig.i).toBeLessThan(JM.ladderLife)
        }
        if (t.addTrigger != null) {
          const c = ch.c.findIndex((b) => b.time === t.addTrigger)
          expect(ch.c[c].time - ch.c[c - 1].time).toBe(ch.sec)
          expect(ch.c[c - 1].time).toBeGreaterThanOrEqual(t.firstFill)
          for (const q of [c - 1, c]) {
            const b = ch.c[q]
            expect(t.long ? b.close > b.open : b.close < b.open).toBe(true)
            expect(Math.abs(b.close - b.open)).toBeGreaterThanOrEqual(0.5 * ch.atr[q] - 1e-12)
          }
        }
      }
    })
    it(`${pair}: the longest hold is 30 Fib candles of entry candles after the first fill`, () => {
      for (const t of A.trades) {
        const d = byId.get(t.market)!
        expect(t.deadline).toBe(holdDeadline(d, pair, t.firstFill))
        if (t.why === 'time') expect(t.exitTime!).toBeGreaterThanOrEqual(t.deadline)
        if (t.exitTime != null && t.why !== 'time' && t.why !== 'window end')
          expect(t.exitTime).toBeLessThan(t.deadline)
      }
      const d = data[0]
      const f0 = d.h1.c[500].time
      expect(holdDeadline(d, 'H4H1', f0)).toBe(d.h1.c[500 + 119].time + HOUR)
    })
    it(`${pair}: walking the exits again at normal costs gives the same R`, () => {
      for (const t of [...C.trades, ...U.trades, ...A.trades]) {
        const d = byId.get(t.market)!
        const end = d.h1.c.findIndex((b) => b.time >= TO) - 1
        expect(rescore(t, d, end < 0 ? d.h1.c.length - 1 : end, 1)).toBeCloseTo(t.r, 9)
      }
    })
  }
  it('account book: one trade per market, no opposite dollar sides, at most 2 the same way', () => {
    const { run } = runAll(data, 'H4H1', 'C', 'account')
    expect(run.trades.length).toBeGreaterThan(0)
    for (const t of run.trades) {
      // Trades opened before t and still open at the open of t's fill candle.
      const live = run.trades.filter(
        (x) =>
          x.id < t.id &&
          (x.exitTime! > t.firstFill || (x.exitTime === t.firstFill && x.why !== 'time')),
      )
      expect(live.some((x) => x.market === t.market)).toBe(false)
      const side = dollarSide(t.market, t.long)
      expect(live.some((x) => dollarSide(x.market, x.long) !== side)).toBe(false)
      expect(live.filter((x) => dollarSide(x.market, x.long) === side).length).toBeLessThan(2)
    }
  })
})

describe('the truncation test (2.12 point 7): later candles never change earlier decisions', () => {
  it('600 cuts with everything after each cut scrambled', () => {
    const base = makeData()
    const pair: JmPair = 'H4H1'
    const sizing: JmSizing = 'C'
    const ref = runAll(base, pair, sizing)
    const rnd = seeded(600)
    const key = (t: JmTrade) =>
      JSON.stringify([
        t.market,
        t.long,
        t.sig.T,
        t.parts.map((p) => [p.kind, p.time, p.E, p.units]),
        t.stop,
        t.why,
        t.exitTime,
        t.netUsd,
        t.r,
      ])
    const sigKey = (s: JmSignal) =>
      JSON.stringify([s.market, s.long, s.T, s.one, s.zero, s.S, s.E1, s.w, s.check, s.fields])
    const span = TO - FROM
    for (let n = 0; n < 600; n++) {
      const cut = FROM + Math.floor(rnd() * span)
      const r2 = seeded(1000 + n)
      const data = makeData((_, c) =>
        c.map((b) => {
          if (b.time < cut) return b
          const o = b.open * (1 + (r2() - 0.5) * 0.01)
          const cl = o * (1 + (r2() - 0.5) * 0.01)
          return bar(
            b.time,
            o,
            Math.max(o, cl) * (1 + r2() * 0.003),
            Math.min(o, cl) * (1 - r2() * 0.003),
            cl,
          )
        }),
      )
      const got = runAll(data, pair, sizing)
      const before = (t: JmTrade) => t.exitTime != null && t.exitTime + HOUR <= cut
      const a = ref.run.trades.filter(before).map(key)
      const b = got.run.trades.filter(before).map(key)
      expect(b).toEqual(a)
      for (const id of ref.signals.keys()) {
        const early = (s: JmSignal) => s.T + 2 * HOUR < cut
        expect(got.signals.get(id)!.filter(early).map(sigKey)).toEqual(
          ref.signals.get(id)!.filter(early).map(sigKey),
        )
      }
    }
  }, 300_000)
})

describe('the loader window and the freeze (2.12 point 8, section 4)', () => {
  it('design mode refuses dates before 2024-11-11; warm-up from 2023-09-01 only', () => {
    expect(() => readWindow(utc(2024, 11, 10), utc(2025, 11, 11), false)).toThrow(
      /before 2024-11-11/,
    )
    expect(() => readWindow(utc(2019, 1, 1), utc(2025, 11, 11), false)).toThrow()
    expect(readWindow(DESIGN_Y1, utc(2025, 11, 11), false)).toEqual({
      readFrom: DESIGN_WARMUP,
      readTo: utc(2025, 11, 11),
    })
    expect(() => readWindow(DESIGN_Y1, utc(2026, 12, 1), false)).toThrow()
  })
  it('exam mode takes exactly the exam window, and only with a committed, confirmed freeze record', () => {
    expect(() => readWindow(EXAM_FROM, EXAM_TO - DAY, true)).toThrow()
    expect(readWindow(EXAM_FROM, EXAM_TO, true)).toEqual({ readFrom: EXAM_FROM, readTo: EXAM_TO })
    const files = Object.fromEntries(
      ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD', 'XAUUSD'].map((m) => [
        `/h/${m}_1h.csv.gz`,
        { size: 1, sha256: m },
      ]),
    )
    const rec: JmFreezeRecord = {
      codeCommit: 'abc',
      spec: { path: '/s', sha256: 'x' },
      confirmed: true,
      picked: { pair: 'H4H1', expiry: 'X1', sizing: 'C' },
      filters: [],
      files,
      window: { from: '2019-01-01', to: '2024-11-10' },
    }
    const ok = { dirty: [], changedSinceCode: [FREEZE_FILE], specSha256: 'x', files }
    expect(jmFreezeProblems(rec, ok)).toEqual([])
    expect(jmFreezeProblems(rec, { ...ok, dirty: [' M x.ts'] })).toHaveLength(1)
    expect(
      jmFreezeProblems(rec, { ...ok, changedSinceCode: [FREEZE_FILE, 'src/x.ts'] }),
    ).toHaveLength(1)
    expect(jmFreezeProblems(rec, { ...ok, specSha256: 'y' })).toHaveLength(1)
    expect(jmFreezeProblems({ ...rec, confirmed: false, picked: null }, ok).join()).toMatch(
      /did not confirm/,
    )
    expect(
      jmFreezeProblems(rec, {
        ...ok,
        files: { ...files, '/h/EURUSD_1h.csv.gz': { size: 2, sha256: 'z' } },
      }),
    ).toHaveLength(1)
  })
})

describe('the pick rule and the pair rule (section 3)', () => {
  const row = (trades: number, totalR: number, dd: number) => ({ trades, totalR, maxDrawdown: dd })
  it('X beats Y needs 30 trades, no less money, no deeper drop, and 3R more or 3 points less drop', () => {
    expect(pairBeats(row(40, 10, 0.1), row(40, 7, 0.1)).beats).toBe(true)
    expect(pairBeats(row(40, 9, 0.1), row(40, 7, 0.1)).beats).toBe(false)
    expect(pairBeats(row(40, 7, 0.07), row(40, 7, 0.1)).beats).toBe(true)
    expect(pairBeats(row(40, 20, 0.12), row(40, 7, 0.1)).beats).toBe(false) // a trade-off
    expect(pairBeats(row(29, 20, 0.05), row(40, 7, 0.1)).beats).toBe(false)
    expect(pairBeats(row(200, 23, 0.2), row(200, 7, 0.2), 17 / 3).beats).toBe(false)
  })
  it('eligible on year 1, top within 2R takes the most trades, then H4-H1 and X1; confirmed on year 2', () => {
    const rows = [
      { pair: 'H4H1' as const, expiry: 'X1' as const, y1: row(100, 10, 0.1), y2: row(90, -1, 0.1) },
      { pair: 'H4H1' as const, expiry: 'X2' as const, y1: row(120, 9, 0.1), y2: row(90, 2, 0.1) },
      { pair: 'H4H1' as const, expiry: 'X3' as const, y1: row(150, 12, 0.3), y2: row(90, 5, 0.1) },
      { pair: 'DH4' as const, expiry: 'X1' as const, y1: row(20, 50, 0.1), y2: row(20, 5, 0.1) },
    ]
    const p = pickStructure(rows)
    expect(p.eligible).toEqual(['H4H1-X1', 'H4H1-X2'])
    expect(p.tried[0]).toMatchObject({ pair: 'H4H1', expiry: 'X2', confirmed: true })
    expect(p.picked).toEqual({ pair: 'H4H1', expiry: 'X2' })
    const none = pickStructure(rows.map((r) => ({ ...r, y2: row(10, -5, 0.5) })))
    expect(none.picked).toBeNull()
    expect(none.tried).toHaveLength(2)
  })
})

describe('the filter search (section 5) and the exam lines (section 6)', () => {
  it('a filter with no real split does not survive the shuffle and Holm', () => {
    const rnd = seeded(5)
    const ts: FilterTrade[] = Array.from({ length: 400 }, (_, k) => ({
      market: (['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD'] as JmMarketId[])[k % 6],
      year: (k % 2 ? 1 : 2) as 1 | 2,
      r: rnd() * 3 - 1.2,
      rDouble: 0,
      F: Array.from({ length: 10 }, () => rnd() < 0.5),
    }))
    const out = filterSearch(ts, 500)
    expect(out).toHaveLength(10)
    expect(out.filter((x) => x.survives).length).toBeLessThanOrEqual(2)
    // A filter that picks the winners: it survives.
    const good = ts.map((t) => ({
      ...t,
      rDouble: t.r - 0.05,
      F: t.F.map((x, i) => (i === 3 ? t.r > 0.3 : x)),
    }))
    const g = filterSearch(good, 500)
    expect(g[3].survives).toBe(true)
    expect(g[3].p).toBe(0)
  })
  it('the eight lines: under 120 trades is no verdict', () => {
    const t = { r: 0.5, rDoubleCost: 0.4, firstFill: utc(2020, 5, 1), netUsd: 100 } as JmTrade
    const base = {
      endBalance: 20_000,
      maxDrawdown: 0.1,
      coinP95: 0,
      controlTotalR: 1,
      mirrorZ: 1.2,
    }
    expect(examLines({ ...base, trades: [t], minTrades: 120 }).verdict).toBe('no verdict')
    const many = [2019, 2020, 2021, 2022, 2023, 2024].flatMap((y) =>
      Array.from({ length: 25 }, () => ({ ...t, firstFill: utc(y, 3, 1) })),
    )
    expect(examLines({ ...base, trades: many, minTrades: 120 }).verdict).toBe('pass') // no losers: PF infinite
    expect(examLines({ ...base, trades: many, minTrades: 120, mirrorZ: 0.9 }).verdict).toBe(
      'fail (made money, not proven)',
    )
  })
})
