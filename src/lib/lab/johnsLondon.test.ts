import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { labMarket } from './markets'
import { ismEvents, type NewsEvent } from './news'
import { seeded } from './control'
import {
  assertDesignCandles,
  assertDesignFile,
  coinDraw,
  coinRun,
  daySignals,
  DESIGN_START,
  entryFill,
  entryMinute,
  eventKey,
  flipBeatsPlain,
  forcedCloseAt,
  forcedFill,
  isTradingDay,
  LondonAccount,
  londonMarket,
  M15,
  mirrorR,
  mirrorTest,
  p95,
  passLines,
  pickPair,
  pickQ,
  planFrom,
  prepareMarket,
  prepareV1,
  rescoreCosts,
  resample15,
  riskPerUnit,
  roundTrip,
  runLondon,
  sessionFor,
  stopFill,
  stopHit,
  summarize,
  targetHit,
  V1,
  walkExits,
  type Fill,
  type LondonData,
  type LondonSignal,
  type LondonTrade,
} from './johnsLondon'

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Monday 2025-11-17, UK winter: session 07:00, last entry 15:00, time exit 16:30 UTC. */
const DAY0 = Date.UTC(2025, 10, 17) / 1000
const S0 = sessionFor(DAY0)
const B = 1.3
const GBP = londonMarket('GBPUSD')

type Bar = [number, number, number, number]

/** 15-minute bars to 1-minute candles: each bar's path runs open, high (minute 4), low (minute 9), close. */
function minutesOf(bars: Bar[], day = DAY0): OHLCCandle[] {
  const out: OHLCCandle[] = []
  bars.forEach(([o, h, l, c], n) => {
    const path: number[] = []
    for (let k = 0; k < 15; k++)
      path.push(
        k <= 4
          ? o + ((h - o) * k) / 4
          : k <= 9
            ? h + ((l - h) * (k - 4)) / 5
            : l + ((c - l) * (k - 9)) / 5,
      )
    path.forEach((v, k) => {
      const open = k === 0 ? o : path[k - 1]
      out.push({
        time: day + n * M15 + k * 60,
        open,
        high: Math.max(open, v),
        low: Math.min(open, v),
        close: v,
      })
    })
  })
  return out
}

const quiet = (base: number, n: number): Bar[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? [base, base + 0.0005, base - 0.0005, base + 0.0002]
      : [base + 0.0002, base + 0.0005, base - 0.0005, base],
  )

/** A SELL setup: 1 = base + 0.0010, 0 = base - 0.0050; the 6th bar is the signal (high base - 0.0001). */
const sellSetup = (b: number): Bar[] => [
  [b, b + 0.001, b - 0.0002, b + 0.0008],
  [b + 0.0008, b + 0.0009, b - 0.002, b - 0.0018],
  [b - 0.0018, b - 0.0017, b - 0.004, b - 0.0039],
  [b - 0.0039, b - 0.0038, b - 0.005, b - 0.0049],
  [b - 0.0049, b - 0.001, b - 0.0049, b - 0.0015],
  [b - 0.0015, b - 0.0001, b - 0.0016, b - 0.0002],
]
const mirrorBar = (x: Bar, b: number): Bar => [
  2 * b - x[0],
  2 * b - x[2],
  2 * b - x[1],
  2 * b - x[3],
]

/** The stopped-then-flipped day: SELL at 09:00, stop at 09:03, reverse wins at 09:19, re-entry at 09:45. */
function flipDay(after?: Bar[]): Bar[] {
  const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B)]
  bars.push([B - 0.0002, B + 0.0025, B + 0.0015, B + 0.002]) // 36: runs to the stop
  bars.push([B + 0.002, B + 0.0035, B + 0.0018, B + 0.0034]) // 37: the reverse's quick target
  bars.push([B + 0.0034, B + 0.0036, B + 0.0025, B + 0.0026]) // 38: closes down above the fill
  bars.push(...(after ?? [[B + 0.0026, B + 0.0027, B - 0.007, B - 0.0068]])) // 39: both targets
  return [...bars, ...quiet(bars[bars.length - 1][3], 96 - bars.length)]
}

function dataOf(bars: Bar[], news: NewsEvent[] = [], day = DAY0): LondonData {
  return prepareMarket('GBPUSD', minutesOf(bars, day), news)
}

const runDay = (d: LondonData, flip: boolean, q = 0.5) =>
  runLondon([d], { k: 2, b: 0.5, flip, q }, DAY0, DAY0 + 86_400)

/** A hand-made SELL signal on bar `i` of the data (1 and 0 given). */
function sellSignal(
  d: LondonData,
  i: number,
  one: number,
  zero: number,
  atr = 0.001,
): LondonSignal {
  return {
    day: DAY0,
    i,
    time: d.c15[i].time,
    T: d.c15[i].time + M15,
    long: false,
    one,
    zero,
    oneIdx: i - 5,
    armedIdx: i - 4,
    level: zero + 0.786 * (one - zero),
    atr,
  }
}

const flatBars = (price: number, n = 96): Bar[] => quiet(price, n)

// ── 2.1 Clock ─────────────────────────────────────────────────────────────

describe('2.1 clock', () => {
  it('UK winter: session 07:00, last entry 15:00, time exit 16:30 UTC', () => {
    expect(S0.summer).toBe(false)
    expect(S0.start - DAY0).toBe(7 * 3600)
    expect(S0.lastEntry - DAY0).toBe(15 * 3600)
    expect(S0.timeExit - DAY0).toBe(16.5 * 3600)
  })
  it('UK summer: one hour earlier in UTC; the season is read at 12:00 UTC', () => {
    const fri = sessionFor(Date.UTC(2026, 2, 27) / 1000) // before the last Sunday of March
    const mon = sessionFor(Date.UTC(2026, 2, 30) / 1000) // after it
    expect(fri.summer).toBe(false)
    expect(mon.summer).toBe(true)
    expect(mon.start - mon.day).toBe(6 * 3600)
    expect(mon.timeExit - mon.day).toBe(15.5 * 3600)
    expect(sessionFor(Date.UTC(2026, 9, 26) / 1000).summer).toBe(false) // Monday after the October change
  })
  it('trades Monday to Friday only', () => {
    expect(isTradingDay(DAY0)).toBe(true)
    expect(isTradingDay(DAY0 - 86_400)).toBe(false) // Sunday
    expect(isTradingDay(DAY0 + 5 * 86_400)).toBe(false) // Saturday
  })
})

// ── 2.2 Markets, candles, costs ───────────────────────────────────────────

describe('2.2 markets and costs', () => {
  it('GBP/USD uses the lab costs: about 2.07 pips a round trip at 1.34', () => {
    expect(GBP).toEqual(labMarket('GBPUSD'))
    expect(roundTrip(GBP, 1.34) / 0.0001).toBeCloseTo(2.07, 2)
  })
  it("gold has its own costs, not labMarket('XAUUSD'): 0.040% a round trip, $1.61 at $4,030", () => {
    const g = londonMarket('XAUUSD')
    expect(g.spread).toBe(0.0003)
    expect(g.slippage).toBe(0.0000125)
    expect(g.pct).toBe(true)
    expect(g.fee).toBe(0.0000375)
    expect(g.leverage).toBe(20)
    expect(roundTrip(g, 4030)).toBeCloseTo(1.612, 3)
    expect(g.spread).not.toBe(labMarket('XAUUSD').spread)
  })
  it('trades nothing but GBP/USD and gold', () => {
    expect(() => londonMarket('EURGBP' as never)).toThrow()
  })
  it('builds 15-minute candles from 1-minute candles (first open, last close, highest high, lowest low)', () => {
    const m1 = minutesOf([[1, 1.5, 0.5, 1.2]])
    const [c] = resample15(m1)
    expect(c).toEqual({ time: DAY0, open: 1, high: 1.5, low: 0.5, close: 1.2 })
    expect(
      resample15(
        minutesOf([
          [1, 2, 0, 1],
          [1, 2, 0, 1],
        ]),
      ).map((x) => x.time),
    ).toEqual([DAY0, DAY0 + M15])
  })
  it('fills on BID data: entries, stops, targets and forced closes', () => {
    const m = GBP
    expect(entryFill(m, true, 1.3)).toBeCloseTo(1.30012, 10)
    expect(entryFill(m, false, 1.3)).toBeCloseTo(1.29998, 10)
    const bar = (o: number, h: number, l: number): OHLCCandle => ({
      time: 0,
      open: o,
      high: h,
      low: l,
      close: o,
    })
    // BUY stop: bid low <= stop; fill stop - slip, or open - slip when it opens under.
    expect(stopHit(m, true, bar(1.3, 1.3, 1.29), 1.29)).toBe(true)
    expect(stopFill(m, true, bar(1.3, 1.3, 1.29), 1.295)).toBeCloseTo(1.29498, 10)
    expect(stopFill(m, true, bar(1.29, 1.3, 1.28), 1.295)).toBeCloseTo(1.28998, 10)
    // SELL stop: bid high + spread >= stop; fill stop + slip, or ask open + slip when the ask opens over.
    expect(stopHit(m, false, bar(1.3, 1.29995, 1.29), 1.30005)).toBe(true)
    expect(stopFill(m, false, bar(1.3, 1.3, 1.29), 1.3005)).toBeCloseTo(1.30052, 10)
    expect(stopFill(m, false, bar(1.301, 1.302, 1.29), 1.3005)).toBeCloseTo(1.30112, 10)
    // Targets: BUY on the bid high, SELL on the ask low; filled at the target price.
    expect(targetHit(m, true, bar(1.3, 1.31, 1.29), 1.31)).toBe(true)
    expect(targetHit(m, false, bar(1.3, 1.3, 1.29), 1.29005)).toBe(false)
    expect(targetHit(m, false, bar(1.3, 1.3, 1.29), 1.2901)).toBe(true)
    // Forced close: BUY bid open - slip, SELL bid open + spread + slip.
    expect(forcedFill(m, true, 1.3)).toBeCloseTo(1.29998, 10)
    expect(forcedFill(m, false, 1.3)).toBeCloseTo(1.30012, 10)
  })
  it('gold spread and slip are shares of the bid they are added to', () => {
    const g = londonMarket('XAUUSD')
    expect(entryFill(g, true, 4000)).toBeCloseTo(4000 + 1.2 + 0.05, 9)
    expect(entryFill(g, false, 4000)).toBeCloseTo(4000 - 0.05, 9)
  })
})

// ── 2.3 Setup ─────────────────────────────────────────────────────────────

describe('2.3 the big move and the Fib', () => {
  const atr1 = (n: number) => Array<number>(n).fill(0.001)
  const c15Of = (bars: Bar[]) => resample15(minutesOf(bars))

  it('a SELL setup: 1 at the last up candle, 0 at the end of the drop, signal when the high reaches 0.786', () => {
    const c = c15Of([...quiet(B, 30), ...sellSetup(B), ...quiet(B - 0.0002, 20)])
    const sig = daySignals(c, atr1(c.length), S0, 2)
    expect(sig).toHaveLength(1)
    const s = sig[0]
    expect(s.long).toBe(false)
    expect(s.i).toBe(35)
    expect(s.T).toBe(DAY0 + 36 * M15)
    expect(s.one).toBeCloseTo(B + 0.001, 10)
    expect(s.zero).toBeCloseTo(B - 0.005, 10)
    expect(s.oneIdx).toBe(30)
    expect(s.armedIdx).toBe(31)
    expect(s.level).toBeCloseTo(B - 0.005 + 0.786 * 0.006, 10)
  })
  it('BUY is the mirror', () => {
    const bars = [...quiet(B, 30), ...sellSetup(B), ...quiet(B - 0.0002, 20)].map((x) =>
      mirrorBar(x, B),
    )
    const c = c15Of(bars)
    const [s] = daySignals(c, atr1(c.length), S0, 2)
    expect(s.long).toBe(true)
    expect(s.one).toBeCloseTo(B - 0.001, 10)
    expect(s.zero).toBeCloseTo(B + 0.005, 10)
  })
  it('the move must be at least k ATRs: k = 3 with ATR 0.002 finds nothing', () => {
    const c = c15Of([...quiet(B, 30), ...sellSetup(B), ...quiet(B, 10)])
    expect(daySignals(c, Array<number>(c.length).fill(0.002), S0, 3)).toHaveLength(0)
  })
  it('the impulse candle must make the lowest low of the 11 before it, and candle j-12 must exist', () => {
    const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B)]
    bars[25] = [B, B + 0.0005, B - 0.006, B] // an older, lower low inside the look-back
    const c = c15Of([...bars, ...quiet(B, 10)])
    expect(daySignals(c, atr1(c.length), S0, 2)).toHaveLength(0)
    const early = sessionFor(DAY0)
    const tooSoon = c15Of([...sellSetup(B), ...quiet(B, 5)])
    expect(daySignals(tooSoon, atr1(tooSoon.length), { ...early, start: DAY0 }, 2)).toHaveLength(0)
  })
  it('A1: a candle that makes a new low moves 0 and gives no signal, even when its high reaches the level', () => {
    const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B).slice(0, 5)]
    bars.push([B - 0.0015, B - 0.0001, B - 0.0055, B - 0.005]) // high reaches the old level, low makes a new 0
    const c = c15Of([...bars, ...quiet(B - 0.005, 10)])
    expect(daySignals(c, atr1(c.length), S0, 2)).toHaveLength(0)
  })
  it('A3: a candle that makes a new low and trades past 1 moves 0, then loses the setup', () => {
    const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B).slice(0, 4)]
    bars.push([B - 0.0049, B + 0.0012, B - 0.0052, B - 0.003]) // new low and past 1
    bars.push([B - 0.003, B - 0.0001, B - 0.0031, B - 0.0002]) // would be a signal for the old setup
    const c = c15Of([...bars, ...quiet(B, 10)])
    // The old setup (armed on 31) is gone. Rule B runs right after the drop, so the same
    // candle may arm a fresh setup; any signal now comes from that one.
    const sells = daySignals(c, atr1(c.length), S0, 2).filter((s) => !s.long)
    expect(sells.every((s) => s.armedIdx === 34)).toBe(true)
  })
  it('A3: trading past 1 drops the setup', () => {
    const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B).slice(0, 4)]
    bars.push([B - 0.0049, B + 0.0011, B - 0.0049, B - 0.0045]) // past 1, no new low
    bars.push([B - 0.0045, B - 0.0001, B - 0.0046, B - 0.0002])
    const c = c15Of([...bars, ...quiet(B, 10)])
    expect(daySignals(c, atr1(c.length), S0, 2).filter((s) => !s.long)).toHaveLength(0)
  })
  it('a setup lives 24 candles: a signal on candle armed + 24 counts, on armed + 25 it does not', () => {
    const make = (wait: number) => {
      const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B).slice(0, 4)] // armed on 31, 0 set on 33
      for (let n = 0; n < wait; n++)
        bars.push(
          n % 2
            ? [B - 0.0045, B - 0.004, B - 0.0049, B - 0.0046]
            : [B - 0.0046, B - 0.004, B - 0.0049, B - 0.0045],
        )
      bars.push([B - 0.0045, B - 0.0001, B - 0.0046, B - 0.0002])
      const c = c15Of([...bars, ...quiet(B, 10)])
      return daySignals(c, atr1(c.length), S0, 2).filter((s) => !s.long)
    }
    // Signal candle index = 34 + wait; armed index 31.
    expect(make(21)).toHaveLength(1) // 55 - 31 = 24
    expect(make(22)).toHaveLength(0) // 56 - 31 = 25
  })
  it('a signal uses up its setup: a second pullback gives no second signal', () => {
    const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B)]
    bars.push([B - 0.0002, B - 0.0003, B - 0.003, B - 0.0028])
    bars.push([B - 0.0028, B - 0.0001, B - 0.0029, B - 0.0002])
    const c = c15Of([...bars, ...quiet(B - 0.0002, 10)])
    expect(daySignals(c, atr1(c.length), S0, 2).filter((s) => !s.long)).toHaveLength(1)
  })
  it('the impulse candle must be in the session; the 1 candle may be before it', () => {
    // Impulse on 06:15-06:45, pullback at 07:15: trackers start empty at 07:00, so nothing.
    const before = c15Of([...quiet(B, 24), ...sellSetup(B), ...quiet(B - 0.0002, 30)])
    expect(daySignals(before, atr1(before.length), S0, 2)).toHaveLength(0)
    // 1 on the 06:45 candle, impulse from 07:00: counts.
    const across = c15Of([...quiet(B, 27), ...sellSetup(B), ...quiet(B - 0.0002, 30)])
    const sig = daySignals(across, atr1(across.length), S0, 2)
    expect(sig).toHaveLength(1)
    expect(across[sig[0].oneIdx].time).toBeLessThan(S0.start)
  })
  it('uses only candles that close by last entry', () => {
    // Setup on bars 54..59: the signal candle starts 14:45 and closes 15:00, which counts.
    const ok = c15Of([...quiet(B, 54), ...sellSetup(B), ...quiet(B, 20)])
    expect(daySignals(ok, atr1(ok.length), S0, 2)).toHaveLength(1)
    // One bar later the signal candle closes 15:15, after last entry.
    const late = c15Of([...quiet(B, 55), ...sellSetup(B), ...quiet(B, 20)])
    expect(daySignals(late, atr1(late.length), S0, 2)).toHaveLength(0)
  })

  /** A SELL setup armed on bar 29 and a BUY setup armed on bar 41; bar 42 is a signal for both. */
  function bothSignal(): Bar[] {
    const bars: Bar[] = quiet(100, 28)
    bars.push([100, 101, 99.8, 100.8]) // 28: up, the SELL's 1 = 101
    bars.push([100.8, 100.9, 98, 98.2]) // 29: SELL impulse
    bars.push([98.2, 98.4, 97, 97.1]) // 30: 0 = 97
    for (let n = 31; n < 40; n++) bars.push(n % 2 ? [97.5, 98, 97.2, 97.6] : [97.6, 98, 97.2, 97.5])
    bars.push([97.5, 97.8, 97.1, 97.2]) // 40: down, the BUY's 1 = 97.1
    bars.push([97.2, 100.5, 96.8, 100.3]) // 41: new SELL 0 (96.8), BUY impulse (0 = 100.5)
    bars.push([100, 100.3, 97.5, 98]) // 42: reaches both levels
    return [...bars, ...quiet(98, 10)]
  }
  it('both trackers on one candle: the one armed later is taken', () => {
    const c = resample15(minutesOf(bothSignal()))
    const sig = daySignals(c, Array<number>(c.length).fill(1), S0, 2)
    const at42 = sig.filter((s) => s.i === 42)
    expect(at42).toHaveLength(1)
    expect(at42[0].long).toBe(true)
    expect(at42[0].armedIdx).toBe(41)
  })
  it('both trackers armed on the same candle and signalling together: neither', () => {
    const at31 = (y: Bar) => {
      const c = resample15(
        minutesOf([...quiet(100, 30), [100, 103, 97, 100.1], y, ...quiet(100, 10)]),
      )
      return daySignals(c, Array<number>(c.length).fill(1), S0, 2).filter((s) => s.i === 31)
    }
    expect(at31([100, 100, 99.9998, 99.9999])).toHaveLength(0)
    // Controls: each tracker alone does signal on that candle.
    expect(at31([100, 100, 99.8, 99.9]).map((s) => s.long)).toEqual([false]) // BUY loses its setup (low under its 1)
    expect(at31([100, 100.001, 99.9998, 99.9999]).map((s) => s.long)).toEqual([true]) // SELL loses its setup (past its 1)
  })
})

// ── Look-ahead guards ─────────────────────────────────────────────────────

describe('look-ahead guards', () => {
  const bars = flipDay()
  const d = dataOf(bars)

  it('a decision at candle i does not change when later candles change or are cut off', () => {
    const full = daySignals(d.c15, d.atr, S0, 2)
    for (let cut = 30; cut < 70; cut++) {
      const c = d.c15.slice(0, cut + 1)
      const part = daySignals(c, atrSeries(c, 14), S0, 2)
      expect(part).toEqual(full.filter((s) => s.i <= cut))
      // Scramble every candle after the cut: still the same decisions up to it.
      const noisy = d.c15.map((x, i) =>
        i > cut ? { ...x, high: x.high + 0.01, low: x.low - 0.01 } : x,
      )
      expect(daySignals(noisy, atrSeries(noisy, 14), S0, 2).filter((s) => s.i <= cut)).toEqual(
        full.filter((s) => s.i <= cut),
      )
    }
  })
  it('the Fib span is known only from closed candles: a signal never uses a 0 set by itself or later', () => {
    for (const s of daySignals(d.c15, d.atr, S0, 2)) {
      let lo = Infinity
      for (let x = s.armedIdx; x < s.i; x++) lo = Math.min(lo, d.c15[x].low)
      if (!s.long) expect(s.zero).toBe(lo)
    }
  })
  it('the market order fills only from the next candle: the first 1-minute open at or after T', () => {
    const [s] = daySignals(d.c15, d.atr, S0, 2)
    const r = prepareV1(d, S0, s, 0.5)
    if ('why' in r) throw new Error(r.why)
    expect(r.entryTime).toBe(s.T)
    expect(r.p).toBe(d.m1[entryMinute(d.m1, s.T)].open)
    // Moving the signal candle's last minute does not move the fill.
    const m1 = d.m1.map((x) =>
      x.time === s.T - 60 ? { ...x, close: x.close + 0.0003, high: x.high + 0.0003 } : x,
    )
    const d2 = { ...d, m1 }
    const r2 = prepareV1(d2, S0, s, 0.5)
    if ('why' in r2) throw new Error(r2.why)
    expect(r2.E).toBe(r.E)
  })
  it('the entry and its levels do not depend on anything after the entry minute', () => {
    const [s] = daySignals(d.c15, d.atr, S0, 2)
    const r = prepareV1(d, S0, s, 0.5)
    const d2 = { ...d, m1: d.m1.filter((x) => x.time <= s.T + 5 * 60) }
    const r2 = prepareV1(d2, S0, s, 0.5)
    if ('why' in r || 'why' in r2) throw new Error('no trade')
    expect(r2.E).toBe(r.E)
    expect(r2.plan).toEqual(r.plan)
  })
  it('the reverse trade is checked from the next minute, never in the minute it opens', () => {
    const run = runDay(d, true)
    const rev = run.trades.find((t) => t.leg === 'reverse')!
    expect(rev.fills.every((f) => f.time > rev.entryTime)).toBe(true)
  })
  it('the re-entry extreme reads candles only through its trigger candle', () => {
    const run = runDay(d, true)
    const re = run.trades.find((t) => t.leg === 'reentry')!
    const atr38 = d.atr[38]
    expect(re.rawStop).toBeCloseTo(B + 0.0036 + 0.5 * atr38, 10) // bar 39 (after the trigger) goes nowhere near it
  })
  it('a whole run gives the same trades on data cut right after they close', () => {
    const run = runDay(d, true)
    const last = Math.max(...run.trades.map((t) => t.exitTime))
    const cut = { ...dataOf(bars) }
    cut.m1 = cut.m1.filter((x) => x.time <= last + 60)
    cut.c15 = resample15(cut.m1)
    cut.atr = atrSeries(cut.c15, 14)
    cut.byTime = new Map(cut.c15.map((c, i) => [c.time, i]))
    expect(runDay(cut, true).trades).toEqual(run.trades)
  })
})

// ── 2.4 Entry checks ──────────────────────────────────────────────────────

describe('2.4 entry', () => {
  // Flat at 1.3030; a SELL with 1 = 1.3050 and 0 = 1.2950 signals on bar 39 (T = 10:00).
  const one = 1.305
  const zero = 1.295
  const base = (news: NewsEvent[] = []) => dataOf(flatBars(1.303), news)
  const T = DAY0 + 10 * 3600
  const ev = (t: number): NewsEvent => ({ time: t, currency: 'USD', event: 'test' })

  it('a clean signal opens: stop past 1, half at 0, the rest at -0.272, capped at 2.5R', () => {
    const d = base()
    const r = prepareV1(d, S0, sellSignal(d, 39, one, zero), 0.5)
    if ('why' in r) throw new Error(r.why)
    expect(r.p).toBe(1.303)
    expect(r.E).toBeCloseTo(1.30298, 10)
    expect(r.plan.tp1).toBe(zero)
    expect(r.plan.tp2).toBeCloseTo(zero - 0.272 * 0.01, 10)
    expect(r.plan.rr).toBeCloseTo(2.5, 10)
    expect(r.plan.capped).toBe(true)
    expect(r.plan.stop).toBeCloseTo(r.E + r.plan.dist, 12)
  })
  it('check 2: no trade inside a news block; a T exactly 30 minutes after the event may trade', () => {
    const d1 = base([ev(T + 10 * 60)])
    expect(prepareV1(d1, S0, sellSignal(d1, 39, one, zero), 0.5)).toEqual({ why: 'news block' })
    const d2 = base([ev(T - 30 * 60)])
    expect('why' in prepareV1(d2, S0, sellSignal(d2, 39, one, zero), 0.5)).toBe(false)
    const d3 = base([ev(T + 30 * 60)]) // the block starts at T: its first moment is inside
    expect(prepareV1(d3, S0, sellSignal(d3, 39, one, zero), 0.5)).toEqual({ why: 'news block' })
  })
  it('check 2: at least 90 minutes before the forced close; exactly 90 is enough', () => {
    const ok = base([ev(T + 120 * 60)]) // forced close T + 90
    expect('why' in prepareV1(ok, S0, sellSignal(ok, 39, one, zero), 0.5)).toBe(false)
    const no = base([ev(T + 119 * 60)])
    expect(prepareV1(no, S0, sellSignal(no, 39, one, zero), 0.5)).toEqual({
      why: 'under 90 minutes to the forced close',
    })
    // The time exit counts too: a signal at 15:15 has 75 minutes.
    const d = base()
    expect(prepareV1(d, S0, sellSignal(d, 60, one, zero), 0.5)).toEqual({
      why: 'under 90 minutes to the forced close',
    })
  })
  it('check 3: 14 of the 20 fifteen-minute slots before T must hold a candle with high above low', () => {
    const flatten = (k: number) => {
      const d = base()
      const dead = new Set(Array.from({ length: k }, (_, n) => T - (n + 1) * M15))
      const m1 = d.m1.map((x) =>
        dead.has(Math.floor(x.time / M15) * M15)
          ? { ...x, high: 1.303, low: 1.303, open: 1.303, close: 1.303 }
          : x,
      )
      return prepareMarket('GBPUSD', m1, [])
    }
    const six = flatten(6)
    expect('why' in prepareV1(six, S0, sellSignal(six, 39, one, zero), 0.5)).toBe(false)
    const seven = flatten(7)
    expect(prepareV1(seven, S0, sellSignal(seven, 39, one, zero), 0.5)).toEqual({
      why: 'thin data',
    })
  })
  it('check 4: a 1-minute candle from T up to and including T + 5 minutes; the first one is used', () => {
    const drop = (from: number, to: number) => {
      const d = base()
      return { ...d, m1: d.m1.filter((x) => x.time < from || x.time > to) }
    }
    const five = drop(T, T + 4 * 60)
    const r = prepareV1(five, S0, sellSignal(five, 39, one, zero), 0.5)
    if ('why' in r) throw new Error(r.why)
    expect(r.entryTime).toBe(T + 5 * 60)
    const six = drop(T, T + 5 * 60)
    expect(prepareV1(six, S0, sellSignal(six, 39, one, zero), 0.5)).toEqual({
      why: 'no 1-minute candle',
    })
  })
  it('check 5: the plan must pay at least 1.5R at the fill', () => {
    const d = dataOf(flatBars(1.3))
    // From 1.3000: reward 0.00634 against a 0.00552 stop distance = 1.15R.
    expect(prepareV1(d, S0, sellSignal(d, 39, one, zero), 0.5)).toEqual({ why: 'plan under 1.5R' })
  })
  it('check 6, no chase: the reward at the fill must be at least 0.9 times the reward at the signal close', () => {
    // Signal close 1.3035, fill from 1.3025: the 2.5R cap binds at both, the reward falls to 0.895.
    const bars = flatBars(1.3035)
    for (let n = 40; n < 96; n++)
      bars[n] = n % 2 ? [1.3025, 1.3028, 1.3022, 1.3025] : [1.3025, 1.3028, 1.3022, 1.3025]
    bars[39] = [1.3035, 1.3037, 1.3033, 1.3035]
    const d = dataOf(bars)
    const sig = sellSignal(d, 39, 1.304, 1.295)
    expect(prepareV1(d, S0, sig, 0.5)).toEqual({ why: 'no chase' })
    // Same, filled at the close price: trades.
    const d2 = dataOf(flatBars(1.3035))
    expect('why' in prepareV1(d2, S0, sellSignal(d2, 39, 1.304, 1.295), 0.5)).toBe(false)
  })
  it('check 1: no trade while one is open in the market', () => {
    const d = dataOf(flipDay([[B + 0.0026, B + 0.0027, B + 0.002, B + 0.0021]]))
    const run = runDay(d, false)
    expect(run.trades.length).toBeGreaterThan(0)
    for (const o of run.outcomes.filter((x) => x.result === 'trade open'))
      expect(run.trades.some((t) => t.entryTime <= o.T && t.exitTime >= o.T)).toBe(true)
  })
})

// ── 2.5 Stop and targets ──────────────────────────────────────────────────

describe('2.5 stop and targets', () => {
  const p = 1.3
  const E = entryFill(GBP, false, p)
  it('no trade when the raw stop is not on the losing side, or a target is not on the winning side', () => {
    expect(planFrom(GBP, false, E, p, E - 0.001, 1.29, 1.28)).toEqual({
      why: 'stop not on the losing side',
    })
    expect(planFrom(GBP, false, E, p, E + 0.003, E + 0.001, 1.28)).toEqual({
      why: 'target not on the winning side',
    })
  })
  it('cost floor: the stop is at least 10 round trips away', () => {
    const plan = planFrom(GBP, false, E, p, E + 0.0005, E - 0.003, E - 0.0035)
    if ('why' in plan) throw new Error(plan.why)
    expect(plan.floored).toBe(true)
    expect(plan.dist).toBeCloseTo(10 * roundTrip(GBP, p), 12)
  })
  it('cap: a plan over 2.5R gets a wider stop', () => {
    const plan = planFrom(GBP, false, E, p, E + 0.003, E - 0.01, E - 0.012)
    if ('why' in plan) throw new Error(plan.why)
    expect(plan.capped).toBe(true)
    expect(plan.rr).toBeCloseTo(2.5, 12)
    expect(plan.dist).toBeCloseTo(0.011 / 2.5, 12)
  })
  it('a BUY flips the signs', () => {
    const Eb = entryFill(GBP, true, p)
    const plan = planFrom(GBP, true, Eb, p, Eb - 0.003, Eb + 0.005, Eb + 0.006)
    if ('why' in plan) throw new Error(plan.why)
    expect(plan.stop).toBeCloseTo(Eb - 0.003, 12)
    expect(plan.rr).toBeCloseTo(0.0055 / 0.003, 10)
  })
})

// ── 2.6 Exits ─────────────────────────────────────────────────────────────

describe('2.6 exits', () => {
  const t0 = DAY0 + 10 * 3600
  const mk = (rows: [number, number, number, number][]): OHLCCandle[] =>
    rows.map(([o, h, l, c], n) => ({ time: t0 + n * 60, open: o, high: h, low: l, close: c }))
  const sell = (m1: OHLCCandle[], deadline = t0 + 3600) =>
    walkExits({
      m: GBP,
      m1,
      from: 0,
      long: false,
      E: 1.3,
      stop: 1.302,
      targets: [
        { price: 1.295, share: 0.5, why: 'tp1' },
        { price: 1.293, share: 0.5, why: 'tp2' },
      ],
      deadline,
      deadlineWhy: 'time',
    })
  it('half closes at TP1, the rest at TP2, with the fee on each part', () => {
    const w = sell(
      mk([
        [1.3, 1.3, 1.2949, 1.295],
        [1.295, 1.295, 1.2925, 1.293],
      ]),
    )
    expect(w.fills.map((f) => [f.why, f.share, f.price])).toEqual([
      ['tp1', 0.5, 1.295],
      ['tp2', 0.5, 1.293],
    ])
    const fee = GBP.fee
    expect(w.pnl).toBeCloseTo(0.5 * (0.005 - fee * 2.595) + 0.5 * (0.007 - fee * 2.593), 12)
  })
  it('the stop counts first when one minute reaches the stop and a target', () => {
    const w = sell(mk([[1.3, 1.303, 1.29, 1.3]]))
    expect(w.why).toBe('stop')
    expect(w.fills).toHaveLength(1)
  })
  it('no breakeven: after TP1 the stop stays where it was', () => {
    const w = sell(
      mk([
        [1.3, 1.3, 1.2949, 1.295],
        [1.295, 1.3015, 1.295, 1.301],
        [1.301, 1.3021, 1.3, 1.302],
      ]),
    )
    expect(w.tp1Hit).toBe(true)
    expect(w.why).toBe('stop')
    expect(w.fills[1].price).toBeCloseTo(1.302 + GBP.slippage, 12)
  })
  it('forced close first, at the open of the first minute at or after the deadline', () => {
    const w = sell(
      mk([
        [1.3, 1.3005, 1.2995, 1.3],
        [1.3, 1.303, 1.29, 1.3],
      ]),
      t0 + 60,
    )
    expect(w.why).toBe('time')
    expect(w.fills[0].atOpen).toBe(true)
    expect(w.fills[0].price).toBeCloseTo(forcedFill(GBP, false, 1.3), 12)
  })
  it('forced close is the time exit or 30 minutes before the next red event, whichever is earlier', () => {
    const d = dataOf(flatBars(1.3), [{ time: DAY0 + 13 * 3600, currency: 'GBP', event: 'BoE' }])
    expect(forcedCloseAt(d, S0, DAY0 + 10 * 3600)).toEqual({ at: DAY0 + 12.5 * 3600, why: 'news' })
    expect(forcedCloseAt(d, S0, DAY0 + 14 * 3600)).toEqual({ at: S0.timeExit, why: 'time' })
  })
  it('targets fill at the target price, even when the minute opens past it', () => {
    const w = sell(
      mk([
        [1.3, 1.3, 1.299, 1.299],
        [1.29, 1.29, 1.289, 1.29],
      ]),
    )
    expect(w.fills.map((f) => f.price)).toEqual([1.295, 1.293])
  })
})

// ── 2.7 News ──────────────────────────────────────────────────────────────

describe('2.7 red news', () => {
  it('uses the market currencies only: gold ignores GBP events, GBP/USD does not', () => {
    const ev: NewsEvent[] = [{ time: DAY0 + 12 * 3600, currency: 'GBP', event: 'BoE' }]
    const gold = prepareMarket('XAUUSD', minutesOf(flatBars(4000)), ev)
    const gbp = prepareMarket('GBPUSD', minutesOf(flatBars(1.3)), ev)
    expect(gold.windows).toHaveLength(0)
    expect(gbp.windows).toEqual([{ from: DAY0 + 11.5 * 3600, to: DAY0 + 12.5 * 3600 }])
  })
  it('ISM manufacturing and services are added by rule', () => {
    const e = ismEvents(Date.UTC(2026, 1, 1) / 1000, Date.UTC(2026, 1, 28) / 1000)
    expect(e.map((x) => new Date(x.time * 1000).toISOString())).toEqual([
      '2026-02-02T15:00:00.000Z',
      '2026-02-04T15:00:00.000Z',
    ])
  })
  it('an open trade is closed at market 30 minutes before the event', () => {
    // Flat day with an event at 12:00: the 10:00 trade closes at 11:30 on "news".
    const d = dataOf(flatBars(1.303), [{ time: DAY0 + 12 * 3600, currency: 'USD', event: 'CPI' }])
    const r = prepareV1(d, S0, sellSignal(d, 39, 1.305, 1.295), 0.5)
    if ('why' in r) throw new Error(r.why)
    expect(r.walk.why).toBe('news')
    expect(r.walk.exitTime).toBe(DAY0 + 11.5 * 3600)
  })
})

// ── 2.8 Size and limits ───────────────────────────────────────────────────

describe('2.8 size and limits', () => {
  const fill = (time: number, share: number, price: number, why: Fill['why'] = 'stop'): Fill => ({
    time,
    atOpen: false,
    share,
    price,
    why,
  })
  const req = (o: Partial<Parameters<LondonAccount['tryOpen']>[0]> = {}) => ({
    market: 'GBPUSD' as const,
    long: true,
    E: 1.3,
    rpu: 0.02,
    leverage: 30,
    fee: 0,
    fills: [fill(2000, 1, 1.3)],
    key: eventKey(1000, 1),
    ...o,
  })
  it('units = 2% of the balance / risk per unit, and a plain stop-out is -1.00R = -2%', () => {
    const d = dataOf(flipDay())
    const run = runDay(d, false)
    const t = run.trades[0]
    expect(t.why).toBe('stop')
    expect(t.units * t.rpu).toBeCloseTo(200, 6)
    expect(t.rpu).toBeCloseTo(riskPerUnit(GBP, t.E, t.stop, t.p), 15)
    expect(t.r).toBeCloseTo(-1, 3)
    expect(run.endBalance).toBeCloseTo(9800, 0)
  })
  it('margin: a trade that does not fit is cut; under 1% risk after the cut it is skipped', () => {
    const a = new LondonAccount()
    const cut = a.tryOpen(req({ leverage: 1, rpu: 0.001 })) // wants 200,000 units, 7,692 fit, risks $7.69
    expect(cut).toEqual({ why: 'account: margin cut under 1%' })
    const b = new LondonAccount()
    const ok = b.tryOpen(req({ leverage: 1, rpu: 0.02 })) // wants 10,000 units, 7,692 fit, risks $153.8
    if ('why' in ok) throw new Error(ok.why)
    expect(ok.cut).toBe(true)
    expect(ok.units).toBeCloseTo(10000 / 1.3, 6)
  })
  it('at most 2 open trades that win on the same move of one currency (gold long = USD down)', () => {
    const a = new LondonAccount()
    expect('units' in a.tryOpen(req({ market: 'GBPUSD', long: true }))).toBe(true)
    expect(
      'units' in a.tryOpen(req({ market: 'XAUUSD', long: true, E: 4000, rpu: 16, leverage: 20 })),
    ).toBe(true)
    expect(a.tryOpen(req({ market: 'GBPUSD', long: true }))).toEqual({
      why: 'account: 2 trades already on USD-',
    })
    expect(
      'units' in a.tryOpen(req({ market: 'XAUUSD', long: false, E: 4000, rpu: 16, leverage: 20 })),
    ).toBe(true)
    // So with two markets the 5-open cap can never bind: 4 trades already use up every currency move.
    expect('units' in a.tryOpen(req({ market: 'GBPUSD', long: false }))).toBe(true)
    expect(a.openCount()).toBe(4)
    expect('why' in a.tryOpen(req({ market: 'GBPUSD', long: false }))).toBe(true)
    expect(
      'why' in a.tryOpen(req({ market: 'XAUUSD', long: true, E: 4000, rpu: 16, leverage: 20 })),
    ).toBe(true)
  })
  it('total open risk at most 10% of the balance', () => {
    const a = new LondonAccount()
    // Three open trades at $200 each, then a $5,000 loss closes: $600 open on $5,000 is 12%.
    for (const long of [true, true, false]) a.tryOpen(req({ long, fills: [fill(9000, 1, 1.3)] }))
    a.tryOpen(
      req({
        market: 'XAUUSD',
        long: false,
        E: 4000,
        rpu: 40,
        leverage: 20,
        fills: [fill(1500, 1, 5000)],
      }),
    )
    a.book(eventKey(1600, 1))
    expect(a.balance).toBeCloseTo(5000, 6)
    expect(
      a.tryOpen(
        req({
          market: 'XAUUSD',
          long: false,
          E: 4000,
          rpu: 16,
          leverage: 20,
          key: eventKey(1600, 1),
        }),
      ),
    ).toEqual({
      why: 'account: open risk over 10%',
    })
  })
  it('a half closed at TP1 counts in the balance when it closes, and the open risk halves', () => {
    const a = new LondonAccount()
    const r = a.tryOpen(
      req({ fills: [fill(1500, 0.5, 1.31, 'tp1'), fill(3000, 0.5, 1.32, 'tp2')] }),
    )
    if ('why' in r) throw new Error(r.why)
    expect(a.openRisk()).toBeCloseTo(200, 6)
    a.book(eventKey(1500, 2))
    expect(a.balance).toBeCloseTo(10000 + 0.5 * r.units * 0.01, 6)
    expect(a.openRisk()).toBeCloseTo(100, 6)
    a.book(Infinity)
    expect(a.openCount()).toBe(0)
  })
  it('max drawdown is on the closed balance, peak to low, as a share of the peak', () => {
    const a = new LondonAccount()
    a.tryOpen(req({ rpu: 0.01, fills: [fill(1500, 1, 1.325)] })) // 20,000 units: +$500
    a.tryOpen(
      req({ market: 'XAUUSD', E: 4000, rpu: 16, leverage: 20, fills: [fill(1600, 1, 4000 - 84)] }),
    ) // -$1,050
    a.book(Infinity)
    expect(a.balance).toBeCloseTo(9450, 6)
    expect(a.maxDrawdown).toBeCloseTo(1050 / 10500, 9)
  })
  it('stop and size follow the real fill, not the signal close', () => {
    const run = runDay(dataOf(flipDay()), false)
    const t = run.trades[0]
    expect(t.stop).toBeCloseTo(t.E + t.dist, 12)
    expect(t.E).toBeCloseTo(entryFill(GBP, false, t.p), 12)
  })
})

// ── 3 v1-flip ─────────────────────────────────────────────────────────────

describe('3 v1-flip', () => {
  it('plain v1 on the flip day: one trade, stopped', () => {
    const run = runDay(dataOf(flipDay()), false)
    expect(run.trades.map((t) => [t.leg, t.side, t.why])).toEqual([['v1', 'SELL', 'stop']])
  })
  it('F2 and F3: reverse at the stop fill, quick target, then the re-entry at a better price', () => {
    const d = dataOf(flipDay())
    const run = runDay(d, true, 0.5)
    expect(run.trades.map((t) => [t.leg, t.side, t.why])).toEqual([
      ['v1', 'SELL', 'stop'],
      ['reverse', 'BUY', 'target'],
      ['reentry', 'SELL', 'tp2'],
    ])
    const [orig, rev, re] = run.trades
    // F2: same minute, the original's stop fill, the loss booked before sizing.
    expect(rev.entryTime).toBe(orig.exitTime)
    expect(rev.E).toBe(orig.fills[0].price)
    expect(rev.balanceAtEntry).toBeCloseTo(10000 + orig.usd, 6)
    expect(rev.units * rev.rpu).toBeCloseTo(0.02 * rev.balanceAtEntry, 6)
    expect(rev.dist).toBe(orig.dist)
    expect(rev.stop).toBeCloseTo(rev.E - orig.dist, 12)
    expect(rev.tp1).toBeCloseTo(rev.E + 0.5 * orig.dist, 12)
    expect(rev.stop).toBeCloseTo(orig.E + GBP.slippage, 9) // about at the original's entry
    // F3: original's way, at a better price, the original's targets, next candle's open.
    expect(re.E).toBeGreaterThan(orig.E)
    expect(re.tp1).toBe(orig.tp1)
    expect(re.tp2).toBe(orig.tp2)
    expect(re.entryTime).toBe(DAY0 + 39 * M15)
    expect(re.planRR).toBeGreaterThanOrEqual(1.5)
  })
  it('F2: a reverse that hits its stop ends the flip, with no re-entry', () => {
    const run = runDay(dataOf(flipDay()), true, 1)
    expect(run.trades.map((t) => [t.leg, t.why])).toEqual([
      ['v1', 'stop'],
      ['reverse', 'stop'],
    ])
  })
  it('F2: the reverse has a 120-minute limit', () => {
    // After the stop, price sits still: the q = 1 reverse runs out of time 120 minutes after it opened.
    const run = runDay(dataOf(flipDay([[B + 0.0026, B + 0.003, B + 0.0022, B + 0.0026]])), true, 1)
    const rev = run.trades.find((t) => t.leg === 'reverse')!
    expect(rev.why).toBe('limit')
    expect(rev.exitTime).toBe(rev.entryTime + 120 * 60)
  })
  it('F1: no flip with under 30 minutes to the forced close', () => {
    const bars: Bar[] = [...quiet(B, 54), ...sellSetup(B), ...quiet(B - 0.0002, 4)]
    bars.push([B - 0.0002, B + 0.0025, B + 0.0015, B + 0.002]) // 16:00: stop at 16:03
    bars.push([B + 0.002, B + 0.0035, B + 0.0018, B + 0.0034])
    const run = runDay(dataOf([...bars, ...quiet(B + 0.0034, 96 - bars.length - 2)]), true)
    expect(run.trades.map((t) => [t.leg, t.why])).toEqual([['v1', 'stop']])
    expect(
      run.outcomes.some((o) => o.result === 'no flip: under 30 minutes to the forced close'),
    ).toBe(true)
  })
  it("F1: only after the market's first trade of the day", () => {
    // A BUY that wins, then a SELL that is stopped: the SELL was the second trade, so no flip.
    const bars: Bar[] = [...quiet(B, 30), ...sellSetup(B).map((x) => mirrorBar(x, B))]
    bars.push([B + 0.0002, B + 0.007, B + 0.0001, B + 0.0068]) // 36: both BUY targets
    const B2 = B + 0.0068
    bars.push(...quiet(B2, 52 - bars.length), ...sellSetup(B2))
    bars.push([B2 - 0.0002, B2 + 0.0025, B2 + 0.0015, B2 + 0.002]) // the SELL's stop
    bars.push([B2 + 0.002, B2 + 0.0035, B2 + 0.0018, B2 + 0.0034])
    const run = runDay(dataOf([...bars, ...quiet(B2 + 0.0034, 96 - bars.length)]), true)
    expect(run.trades.map((t) => [t.leg, t.side, t.why])).toEqual([
      ['v1', 'BUY', 'tp2'],
      ['v1', 'SELL', 'stop'],
    ])
  })
  it('F4: no loops; a re-entry that is stopped starts nothing; at most 3 trades and 2 full losses a day', () => {
    const run = runDay(dataOf(flipDay([[B + 0.0026, B + 0.008, B + 0.0025, B + 0.0078]])), true)
    expect(run.trades.map((t) => [t.leg, t.why])).toEqual([
      ['v1', 'stop'],
      ['reverse', 'target'],
      ['reentry', 'stop'],
    ])
    expect(run.trades.filter((t) => t.r < -0.9)).toHaveLength(2)
  })
  it('F4: legs come one after another, so risk is never doubled and stays under the caps', () => {
    const run = runDay(dataOf(flipDay()), true)
    expect(run.maxOpenSeen).toBe(1)
    expect(run.maxOpenRiskSeen).toBeLessThanOrEqual(0.02 + 1e-9)
    const [a, b2, c] = run.trades
    expect(b2.entryTime).toBeGreaterThanOrEqual(a.exitTime)
    expect(c.entryTime).toBeGreaterThan(b2.exitTime)
  })
})

// ── 4 Picking ─────────────────────────────────────────────────────────────

describe('4 picking a setting', () => {
  const row = (k: number, b: number, trades: number, totalR: number, maxDrawdown = 0.2) => ({
    k,
    b,
    trades,
    totalR,
    maxDrawdown,
  })
  it('only pairs with 100+ trades and drawdown at most 25% are eligible; the top total wins', () => {
    const p = pickPair([
      row(2, 0.5, 99, 50),
      row(2, 1, 120, 30, 0.26),
      row(3, 0.5, 110, 20),
      row(3, 1, 100, 10),
    ])
    expect(p).toMatchObject({ k: 3, b: 0.5, qualified: true })
  })
  it('within 2R of the top: the most trades, then k = 2, then b = 0.5', () => {
    expect(
      pickPair([row(2, 0.5, 120, 20), row(2, 1, 130, 18), row(3, 0.5, 140, 17.9)]),
    ).toMatchObject({ k: 2, b: 1 })
    expect(pickPair([row(3, 0.5, 120, 20), row(2, 1, 120, 19), row(3, 1, 120, 20)])).toMatchObject({
      k: 2,
      b: 1,
    })
    expect(pickPair([row(3, 1, 120, 20), row(3, 0.5, 120, 20)])).toMatchObject({ k: 3, b: 0.5 })
  })
  it('no pair eligible: the defaults, flagged', () => {
    expect(pickPair([row(2, 0.5, 50, 10), row(3, 1, 200, 10, 0.3)])).toMatchObject({
      k: 2,
      b: 0.5,
      qualified: false,
    })
  })
  it('q: the higher total R, but within 2R it is q = 0.5', () => {
    expect(
      pickQ([
        { q: 0.5, totalR: 10 },
        { q: 1, totalR: 12 },
      ]),
    ).toBe(0.5)
    expect(
      pickQ([
        { q: 0.5, totalR: 10 },
        { q: 1, totalR: 12.1 },
      ]),
    ).toBe(1)
    expect(
      pickQ([
        { q: 0.5, totalR: 10 },
        { q: 1, totalR: 5 },
      ]),
    ).toBe(0.5)
  })
})

// ── 5 Counting and luck checks ────────────────────────────────────────────

describe('5 counting', () => {
  const t = (r: number, exitTime: number, pct = r * 2): LondonTrade =>
    ({ r, exitTime, id: exitTime, pct, usd: r * 200, why: 'stop' }) as LondonTrade
  it('profit factor, win rate, longest losing run, without the 3 best', () => {
    const s = summarize([t(2, 1), t(-1, 2), t(-1, 3), t(-1, 4), t(1.5, 5), t(0.5, 6)])
    expect(s.trades).toBe(6)
    expect(s.winRate).toBeCloseTo(0.5, 12)
    expect(s.totalR).toBeCloseTo(1, 12)
    expect(s.profitFactor).toBeCloseTo(4 / 3, 12)
    expect(s.longestLosingRun).toBe(3)
    expect(s.withoutBest3R).toBeCloseTo(-3, 12)
    expect(s.avgWinPct).toBeCloseTo((4 + 3 + 1) / 3, 12)
  })
  it('the six pass lines and the labels', () => {
    const base = {
      trades: 130,
      endBalance: 12000,
      start: 10000,
      avgR: 0.15,
      profitFactor: 1.3,
      maxDrawdown: 0.2,
      totalR: 20,
      coinP95: 0,
      mirrorZ: 1.2,
    }
    expect(passLines(base).verdict).toBe('pass')
    expect(passLines({ ...base, trades: 79 }).verdict).toBe('no verdict')
    expect(passLines({ ...base, mirrorZ: 0.9 }).verdict).toBe('fail (made money, not proven)')
    expect(passLines({ ...base, endBalance: 9000 }).verdict).toBe('fail')
    expect(passLines({ ...base, totalR: 0, coinP95: 0 }).lines[4].ok).toBe(false)
  })
  it('flip beats plain only when all four hold', () => {
    const o = {
      reverseTrades: 30,
      flipLegsR: 1,
      flipTotalR: 13,
      plainTotalR: 10,
      flipDrawdown: 0.2,
      plainDrawdown: 0.15,
    }
    expect(flipBeatsPlain(o).beats).toBe(true)
    expect(flipBeatsPlain({ ...o, reverseTrades: 29 }).beats).toBe(false)
    expect(flipBeatsPlain({ ...o, flipTotalR: 12.9 }).beats).toBe(false)
    expect(flipBeatsPlain({ ...o, flipDrawdown: 0.21 }).beats).toBe(false)
  })
  it('95th percentile of 1,000 runs is the 950th value', () => {
    expect(p95(Array.from({ length: 1000 }, (_, i) => 1000 - i))).toBe(950)
  })
  it('mirror: the same minute the other way, same distances from its own fill', () => {
    const d = dataOf(flipDay([[B + 0.0026, B + 0.009, B + 0.0025, B + 0.0088]]))
    const run = runDay(d, false)
    const [real] = run.trades
    const byId = new Map([[d.id, d]])
    const m = mirrorR(real, d)
    expect(m).toBeGreaterThan(0) // price went up: the mirrored BUY wins what the SELL lost
    const z = mirrorTest(run.trades, byId)
    expect(z.mirrorTotal).toBeCloseTo(m, 12)
  })
  it('coin flips: seeded, a random open from session start + 15 minutes to last entry', () => {
    const rnd = seeded(1)
    for (let n = 0; n < 2000; n++) {
      const { T } = coinDraw(rnd, S0)
      expect(T).toBeGreaterThanOrEqual(S0.start + M15)
      expect(T).toBeLessThanOrEqual(S0.lastEntry)
      expect((T - S0.start) % M15).toBe(0)
    }
    const d = dataOf(flipDay())
    const run = runDay(d, true)
    const byId = new Map([[d.id, d]])
    expect(coinRun(run.trades, byId, 7)).toEqual(coinRun(run.trades, byId, 7))
  })
  it('coin flips draw again inside news blocks (20 tries at most)', () => {
    const d = dataOf(flipDay())
    const run = runDay(d, false)
    const blocked = { ...d, windows: [{ from: DAY0, to: DAY0 + 86_400 }] }
    expect(coinRun(run.trades, new Map([[d.id, blocked]]), 1)).toEqual({ total: 0, missed: 1 })
  })
  it('half and double costs: same entries and levels, exits walked again; at normal costs nothing moves', () => {
    const d = dataOf(flipDay())
    const run = runDay(d, true)
    for (const t of run.trades.filter((x) => x.leg !== 'reverse'))
      expect(rescoreCosts(t, d, 1)).toBeCloseTo(t.r, 9)
    const [orig] = run.trades
    expect(rescoreCosts(orig, d, 2)).toBeLessThan(rescoreCosts(orig, d, 0.5))
  })
})

// ── 10 Loader guard ───────────────────────────────────────────────────────

describe('10 design loader guard', () => {
  it('refuses the clean holdout and the old history', () => {
    expect(() => assertDesignFile('/x/history-1m-24mo/GBPUSD/GBPUSD_1m.csv.gz', 'GBPUSD')).toThrow()
    expect(() => assertDesignFile('/x/history-old/GBPUSD/GBPUSD_1m.csv.gz', 'GBPUSD')).toThrow()
  })
  it('reads only the 1-minute files of GBP/USD and gold', () => {
    expect(() => assertDesignFile('/x/history/GBPUSD/GBPUSD_1m.csv.gz', 'GBPUSD')).not.toThrow()
    expect(() => assertDesignFile('/x/history/GBPUSD/GBPUSD_1h.csv.gz', 'GBPUSD')).toThrow()
    expect(() => assertDesignFile('/x/history/EURGBP/EURGBP_1m.csv.gz', 'EURGBP')).toThrow()
  })
  it('throws when the first candle is before 2025-11-11 00:00 UTC', () => {
    const c = (time: number) => [{ time, open: 1, high: 1, low: 1, close: 1 }]
    expect(() => assertDesignCandles(c(DESIGN_START - 60), 'f')).toThrow()
    expect(() => assertDesignCandles(c(DESIGN_START), 'f')).not.toThrow()
  })
})

// ── 2.9 Check values and year-long guards, on the design data when it is here ──

const HIST = join(homedir(), 'jvd-outputs/trading/history')
const HAVE =
  existsSync(join(HIST, 'GBPUSD/GBPUSD_1m.csv.gz')) &&
  existsSync(join(HIST, 'XAUUSD/XAUUSD_1m.csv.gz'))

describe.skipIf(!HAVE)(
  'design data (skipped when ~/jvd-outputs/trading/history is missing)',
  () => {
    const FROM = DESIGN_START
    const TO = Date.UTC(2026, 10, 11) / 1000
    const load = async () => {
      const { loadCandleFile, loadNews, historyFile } = await import('./load')
      const news = [...(await loadNews(HIST)), ...ismEvents(FROM - 30 * 86_400, TO + 86_400)]
      const out: LondonData[] = []
      for (const id of ['GBPUSD', 'XAUUSD'] as const) {
        const f = historyFile(HIST, id, '1m' as never)
        assertDesignFile(f, id)
        const c = await loadCandleFile(f)
        assertDesignCandles(c, f)
        out.push(
          prepareMarket(
            id,
            c.filter((b) => b.time < TO),
            news,
          ),
        )
      }
      return out
    }
    let data: LondonData[] = []

    it('loads', async () => {
      data = await load()
      expect(data).toHaveLength(2)
    }, 60_000)

    it('reproduces the check values in 2.9 (GBP/USD, k = 2, b = 0.5)', () => {
      const run = runLondon([data[0]], { k: 2, b: 0.5, flip: false }, FROM, TO)
      const find = (day: string, side: string) =>
        run.trades.find((t) => t.day === day && t.side === side)!
      const a = find('2025-11-14', 'BUY')
      expect([
        +a.E.toFixed(5),
        +a.stop.toFixed(5),
        +(a.dist / 1e-4).toFixed(2),
        +a.planRR.toFixed(2),
        a.why,
        +a.r.toFixed(2),
      ]).toEqual([1.31279, 1.30938, 34.08, 2.5, 'time', 0.89])
      const b = find('2025-11-26', 'SELL')
      expect([
        +b.E.toFixed(5),
        +b.stop.toFixed(5),
        +(b.dist / 1e-4).toFixed(2),
        +b.planRR.toFixed(2),
        b.why,
        +b.r.toFixed(2),
      ]).toEqual([1.31839, 1.32121, 28.18, 2.5, 'stop', -1])
      const c = find('2026-01-05', 'BUY')
      expect([
        +c.E.toFixed(5),
        +c.stop.toFixed(5),
        +(c.dist / 1e-4).toFixed(2),
        +c.planRR.toFixed(2),
        c.why,
        +c.r.toFixed(2),
      ]).toEqual([1.34323, 1.34116, 20.72, 2.32, 'tp2', 2.2])
      expect(c.signalCandle).toBe(Date.parse('2026-01-05T13:15:00Z') / 1000)
      const nt = run.outcomes.find((o) => o.T === Date.parse('2025-11-17T11:30:00Z') / 1000)
      expect(nt).toMatchObject({ side: 'SELL', result: 'plan under 1.5R' })
      expect(run.signals).toBe(341)
    })

    it('a whole year of v1-flip: at most 2 v1 + reverse and 3 in all per market and day, 2 full losses, risk under the caps', () => {
      const run = runLondon(data, { k: 2, b: 0.5, flip: true, q: 0.5 }, FROM, TO)
      const byDay = new Map<string, LondonTrade[]>()
      for (const t of run.trades)
        byDay.set(`${t.market}|${t.day}`, [...(byDay.get(`${t.market}|${t.day}`) ?? []), t])
      for (const ts of byDay.values()) {
        expect(ts.filter((t) => t.leg !== 'reentry').length).toBeLessThanOrEqual(2)
        expect(ts.length).toBeLessThanOrEqual(3)
        expect(ts.filter((t) => t.leg === 'reverse').length).toBeLessThanOrEqual(1)
        expect(ts.filter((t) => t.r <= -0.99 && !t.tp1Hit).length).toBeLessThanOrEqual(2)
        for (const t of ts) if (t.leg !== 'v1') expect(ts[0].leg).toBe('v1')
      }
      expect(run.maxOpenSeen).toBeLessThanOrEqual(V1.maxOpen)
      expect(run.maxOpenRiskSeen).toBeLessThanOrEqual(V1.maxOpenRiskPct / 100 + 1e-9)
      for (const t of run.trades)
        expect(t.riskUsd).toBeLessThanOrEqual(0.02 * t.balanceAtEntry + 1e-6)
    })

    it('no look-ahead on real data: cutting the year in half changes no trade that closed before the cut', () => {
      const cutAt = Date.UTC(2026, 4, 1) / 1000
      const full = runLondon(data, { k: 2, b: 0.5, flip: true, q: 0.5 }, FROM, TO)
      const cut = data.map((d) =>
        prepareMarket(
          d.id,
          d.m1.filter((b) => b.time < cutAt),
          [],
        ),
      )
      cut.forEach((c, n) => (c.windows = data[n].windows))
      const part = runLondon(cut, { k: 2, b: 0.5, flip: true, q: 0.5 }, FROM, cutAt)
      const before = (ts: LondonTrade[]) => ts.filter((t) => t.exitTime < cutAt - 86_400)
      expect(before(part.trades)).toEqual(before(full.trades))
    })
  },
)
