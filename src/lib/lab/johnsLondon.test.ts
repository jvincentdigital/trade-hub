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
  breakLines,
  chartOf,
  coinDraw,
  coinDrawNY,
  coinRun,
  daySignals,
  dollarSide,
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
  inRaceHours,
  londonLines,
  nyBreak,
  nyLevels,
  nySessionFor,
  pickFlip,
  pickNY,
  pickPair,
  planFrom,
  prepareBreak,
  prepareMarket,
  prepareRide,
  prepareV1,
  RACE,
  rescoreCosts,
  rescoreThirds,
  resample,
  resample15,
  rideSignals,
  rideSize,
  riskPerUnit,
  roundTrip,
  runLondon,
  runNY,
  sessionFor,
  stopFill,
  stopHit,
  summarize,
  targetHit,
  thirdsBeats,
  trackDay,
  turnCandle,
  V1,
  walkExits,
  walkParts,
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

/**
 * The ride day (SELL, 1 = B + 0.0010): bar 31 arms the setup (0 = B - 0.0020,
 * too small for a ride), bar 32 moves 0 to B - 0.0040 (the g = 1.5 ride),
 * bar 33 moves it to B - 0.0050 (the g = 2.5 ride). Bar 35 reaches 0.786
 * (B - 0.000284) without reaching the g = 1.5 ride's stop: the Fib signal.
 * Default after: bar 36 runs through both Fib targets.
 */
function rideDay(after?: Bar[], pullback?: Bar): Bar[] {
  const b = B
  const bars: Bar[] = [...quiet(b, 30)]
  bars.push([b, b + 0.001, b - 0.0002, b + 0.0008]) // 30: the last up candle: 1
  bars.push([b + 0.0008, b + 0.0009, b - 0.002, b - 0.0018]) // 31: arms
  bars.push([b - 0.0018, b - 0.0017, b - 0.004, b - 0.0039]) // 32: moves 0, closes down
  bars.push([b - 0.0039, b - 0.0038, b - 0.005, b - 0.0049]) // 33: moves 0, closes down
  bars.push([b - 0.0049, b - 0.001, b - 0.0049, b - 0.0015]) // 34: the pullback
  bars.push(pullback ?? [b - 0.0015, b - 0.0002, b - 0.0016, b - 0.0003]) // 35: the Fib signal
  bars.push(...(after ?? [[b - 0.0003, b - 0.0002, b - 0.008, b - 0.0078]]))
  return [...bars, ...quiet(bars[bars.length - 1][3], 96 - bars.length)]
}

function dataOf(bars: Bar[], news: NewsEvent[] = [], day = DAY0): LondonData {
  return prepareMarket('GBPUSD', minutesOf(bars, day), news)
}

const runDay = (d: LondonData, mode: 'v1' | 'flip' | 'thirds' = 'v1', ext = 0.272, g = 1.5) =>
  runLondon([d], { k: 2, b: 0.5, mode, ext, g }, DAY0, DAY0 + 86_400)

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
    setup: 0,
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
  it('a whole run gives the same trades on data cut right after they close (v1 and v1-flip)', () => {
    for (const [mode, bs] of [
      ['v1', bars],
      ['flip', rideDay()],
    ] as const) {
      const run = runDay(dataOf(bs), mode)
      expect(run.trades.length).toBeGreaterThan(0)
      const last = Math.max(...run.trades.map((t) => t.exitTime))
      const cut = { ...dataOf(bs) }
      cut.m1 = cut.m1.filter((x) => x.time <= last + 60)
      cut.c15 = resample15(cut.m1)
      cut.atr = atrSeries(cut.c15, 14)
      cut.byTime = new Map(cut.c15.map((c, i) => [c.time, i]))
      expect(runDay(cut, mode).trades).toEqual(run.trades)
    }
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
    const run = runDay(d)
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
    const run = runDay(d)
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
    expect(a.openCount()).toBe(2)
  })
  it('one dollar bet: a trade on the other dollar side is skipped while one is open (2.8)', () => {
    expect(dollarSide('GBPUSD', true)).toBe('USD-')
    expect(dollarSide('XAUUSD', true)).toBe('USD-')
    expect(dollarSide('GBPUSD', false)).toBe('USD+')
    expect(dollarSide('XAUUSD', false)).toBe('USD+')
    const bet = { why: 'account: dollar bet (a trade on the other dollar side is open)' }
    const gold = { market: 'XAUUSD' as const, E: 4000, rpu: 16, leverage: 20 }
    // GBP/USD long (USD down) open: a gold short (USD up) is blocked, a gold long is fine.
    const a = new LondonAccount()
    expect('units' in a.tryOpen(req({ market: 'GBPUSD', long: true }))).toBe(true)
    expect(a.tryOpen(req({ ...gold, long: false }))).toEqual(bet)
    expect('units' in a.tryOpen(req({ ...gold, long: true }))).toBe(true)
    // Gold short open: a GBP/USD long is blocked.
    const b2 = new LondonAccount()
    expect('units' in b2.tryOpen(req({ ...gold, long: false }))).toBe(true)
    expect(b2.tryOpen(req({ market: 'GBPUSD', long: true }))).toEqual(bet)
    // Closed in an earlier minute: no longer open, so the other side may trade.
    const c = new LondonAccount()
    c.tryOpen(req({ market: 'GBPUSD', long: true, fills: [fill(1500, 1, 1.3)] }))
    expect('units' in c.tryOpen(req({ ...gold, long: false, key: eventKey(1560, 1) }))).toBe(true)
    // Reaching its stop later inside the same minute still counts as open.
    const d2 = new LondonAccount()
    d2.tryOpen(req({ market: 'GBPUSD', long: true, fills: [fill(1560, 1, 1.3)] }))
    expect(d2.tryOpen(req({ ...gold, long: false, key: eventKey(1560, 1) }))).toEqual(bet)
    // A forced close at the open of that minute is closed first.
    const e = new LondonAccount()
    e.tryOpen(
      req({ market: 'GBPUSD', long: true, fills: [{ ...fill(1560, 1, 1.3), atOpen: true }] }),
    )
    expect('units' in e.tryOpen(req({ ...gold, long: false, key: eventKey(1560, 1) }))).toBe(true)
  })
  it('total open risk at most 10% of the balance', () => {
    const a = new LondonAccount()
    // GBP/USD long open ($200 at risk); a gold long loses $8,500 and closes: $230 open on $1,500 is over 10%.
    a.tryOpen(req({ market: 'GBPUSD', long: true, fills: [fill(9000, 1, 1.3)] }))
    a.tryOpen(
      req({
        market: 'XAUUSD',
        long: true,
        E: 4000,
        rpu: 40,
        leverage: 20,
        fills: [fill(1500, 1, 2300)],
      }),
    )
    a.book(eventKey(1600, 1))
    expect(a.balance).toBeCloseTo(1500, 6)
    expect(
      a.tryOpen(
        req({
          market: 'XAUUSD',
          long: true,
          E: 4000,
          rpu: 16,
          leverage: 20,
          key: eventKey(1600, 1),
        }),
      ),
    ).toEqual({ why: 'account: open risk over 10%' })
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
    const run = runDay(dataOf(flipDay()))
    const t = run.trades[0]
    expect(t.stop).toBeCloseTo(t.E + t.dist, 12)
    expect(t.E).toBeCloseTo(entryFill(GBP, false, t.p), 12)
  })
})

// ── 2.8 race hours (John's live rules, a backstop) ────────────────────────

describe("John's race hours: entries 02:00 to 12:30 AST, flat at 12:45 AST", () => {
  it('in UTC: entries 06:00 to 16:30, flat at 16:45 (AST = UTC - 4)', () => {
    expect(RACE).toEqual({ entryFrom: 6 * 3600, entryTo: 16.5 * 3600, flat: 16.75 * 3600 })
    expect(inRaceHours(S0, DAY0 + 6 * 3600 - 60)).toBe(false)
    expect(inRaceHours(S0, DAY0 + 6 * 3600)).toBe(true)
    expect(inRaceHours(S0, DAY0 + 16.5 * 3600)).toBe(true)
    expect(inRaceHours(S0, DAY0 + 16.5 * 3600 + 60)).toBe(false)
  })
  it('an entry outside them is refused, and a session running past 12:45 AST is closed then', () => {
    const d = dataOf(flatBars(1.303))
    const late: typeof S0 = {
      ...S0,
      start: DAY0 + 4 * 3600,
      lastEntry: DAY0 + 18 * 3600,
      timeExit: DAY0 + 20 * 3600,
    }
    // A signal closing at 05:45 UTC (01:45 AST) fills before 02:00 AST.
    expect(prepareV1(d, late, sellSignal(d, 22, 1.305, 1.295), 0.5)).toEqual({
      why: 'outside race hours',
    })
    expect(forcedCloseAt(d, late, DAY0 + 10 * 3600)).toEqual({
      at: DAY0 + 16.75 * 3600,
      why: 'race',
    })
    const r = prepareV1(d, late, sellSignal(d, 39, 1.305, 1.295), 0.5)
    if ('why' in r) throw new Error(r.why)
    expect(r.walk.why).toBe('race')
    expect(r.walk.exitTime).toBe(DAY0 + 16.75 * 3600)
  })
  it('every v1 and v1-NY moment of a year sits inside them, so they never change a backtest trade', () => {
    for (let day = DESIGN_START; day < DESIGN_START + 366 * 86_400; day += 86_400) {
      if (!isTradingDay(day)) continue
      for (const s of [sessionFor(day), nySessionFor(day)]) {
        expect(inRaceHours(s, s.start + M15)).toBe(true)
        expect(inRaceHours(s, s.lastEntry + 5 * 60)).toBe(true)
        expect(s.timeExit).toBeLessThanOrEqual(day + RACE.flat)
      }
    }
  })
})

// ── 3 v1-flip: the ride ───────────────────────────────────────────────────

describe('3 v1-flip: the ride, then the Fib entry', () => {
  const d = dataOf(rideDay())
  const tr = trackDay(d.c15, d.atr, S0, 2)

  it('M1: the tracker reports move candles: the arming candle and each candle that moved 0 and kept the setup', () => {
    const st = tr.setups.find((x) => !x.long && x.armedIdx === 31)!
    expect(st.moves.map((m) => m.j)).toEqual([31, 32, 33])
    expect(st.moves.map((m) => +m.zero.toFixed(4))).toEqual([
      +(B - 0.002).toFixed(4),
      +(B - 0.004).toFixed(4),
      +(B - 0.005).toFixed(4),
    ])
    expect(st.signalIdx).toBe(35)
    expect(tr.signals.map((s) => [s.i, s.setup])).toEqual([[35, st.id]])
  })
  it('M1: the size test is v1 at a fill exactly at 0.786, cost floor, before the 2.5R cap', () => {
    const at = (j: number) => {
      const mv = tr.setups[0].moves.find((m) => m.j === j)!
      return rideSize(d.market, false, mv.one, mv.zero, mv.atr, 0.5)
    }
    expect(at(31).size).toBeLessThan(1.5)
    expect(at(32).size).toBeGreaterThanOrEqual(1.5)
    expect(at(32).size).toBeLessThan(2.5)
    expect(at(33).size).toBeGreaterThanOrEqual(2.5) // above the cap: the cap is not applied
    // By hand at bar 32: L = 0 + 0.786 x 0.005, the stop at the cost floor.
    const L = B - 0.004 + 0.786 * 0.005
    const floor = 10 * roundTrip(d.market, L)
    const reward = 0.5 * (L - (B - 0.004)) + 0.5 * (L - (B - 0.004 - 0.272 * 0.005))
    expect(at(32).L).toBeCloseTo(L, 12)
    expect(at(32).size).toBeCloseTo(reward / floor, 9)
  })
  it('M1: g = 1.5 rides the first big move candle (bar 32), g = 2.5 the first bigger one (bar 33); one per setup', () => {
    // Setup 0 (armed on bar 31). Bar 36's drop arms a new setup, with its own ride.
    const of0 = (g: number) =>
      rideSignals(d.market, d.c15, tr.setups, 0.5, g).filter((r) => r.setup === 0)
    expect(of0(1.5).map((r) => r.i)).toEqual([32])
    expect(of0(2.5).map((r) => r.i)).toEqual([33])
    expect(rideSignals(d.market, d.c15, tr.setups, 0.5, 1.5).map((r) => [r.i, r.setup])).toEqual([
      [32, 0],
      [36, 1],
    ])
  })
  it('M1: the move candle must close with the move', () => {
    const up = dataOf(rideDay()).c15
    // Bar 32 still makes the new low, but closes up: g = 1.5 waits for bar 33.
    const bars = rideDay()
    bars[32] = [B - 0.0045, B - 0.0017, B - 0.004, B - 0.0039]
    const d2 = dataOf(bars)
    const t2 = trackDay(d2.c15, d2.atr, S0, 2)
    expect(turnCandle(d2.c15[32], false)).toBe(false)
    expect(
      rideSignals(d2.market, d2.c15, t2.setups, 0.5, 1.5)
        .filter((r) => r.setup === 0)
        .map((r) => r.i),
    ).toEqual([33])
    expect(up.length).toBe(96)
  })
  it('M2: market order at the close, filled at the next 1-minute open; stop fixed at L with the cost floor; one target at 0 - ext x (1 - 0)', () => {
    const [r] = rideSignals(d.market, d.c15, tr.setups, 0.5, 1.5)
    const x = prepareRide(d, S0, r, 0.272, null)
    if ('why' in x) throw new Error(x.why)
    expect(x.entryTime).toBe(r.T)
    expect(x.p).toBe(d.m1[entryMinute(d.m1, r.T)].open)
    expect(x.E).toBeCloseTo(entryFill(GBP, false, x.p), 12)
    expect(x.plan.stop).toBeCloseTo(Math.max(r.level, x.E + 10 * roundTrip(GBP, x.p)), 12)
    expect(x.plan.tp1).toBeCloseTo(r.zero - 0.272 * (r.one - r.zero), 12)
    expect(x.plan.rr).toBeGreaterThan(0.3)
    expect(x.plan.rr).toBeLessThan(0.75)
    const y = prepareRide(d, S0, r, 0.702, null)
    if ('why' in y) throw new Error(y.why)
    expect(y.plan.tp1).toBeCloseTo(r.zero - 0.702 * (r.one - r.zero), 12)
    expect(y.plan.stop).toBe(x.plan.stop)
    // Its 120-minute limit, when no other close comes first.
    expect(x.deadline).toEqual({ at: x.entryTime + 120 * 60, why: 'limit' })
  })
  it('M2: the cost floor widens a stop closer than 10 round trips', () => {
    const [r] = rideSignals(d.market, d.c15, tr.setups, 0.5, 1.5)
    const near = { ...r, level: r.zero + 0.001 } // pretend L sits 1 pip-ish above the fill
    const x = prepareRide(
      d,
      S0,
      { ...near, level: d.m1[entryMinute(d.m1, r.T)].open + 0.0001 },
      0.272,
      null,
    )
    if ('why' in x) throw new Error(x.why)
    expect(x.plan.dist).toBeCloseTo(10 * roundTrip(GBP, x.p), 12)
    expect(x.plan.floored).toBe(true)
  })
  it('M3 and M4: the ride closes at the open of the minute the Fib entry fills; the Fib entry is sized after it', () => {
    const run = runDay(d, 'flip', 0.272, 1.5)
    expect(run.trades.map((t) => [t.kind, t.side, t.why])).toEqual([
      ['ride', 'SELL', 'fib'],
      ['fib', 'SELL', 'tp2'],
    ])
    const [ride, fib] = run.trades
    expect(ride.exitTime).toBe(fib.entryTime)
    expect(ride.fills[0].atOpen).toBe(true)
    expect(ride.fills[0].price).toBeCloseTo(
      forcedFill(GBP, false, d.m1[entryMinute(d.m1, fib.T)].open),
      12,
    )
    expect(fib.balanceAtEntry).toBeCloseTo(10000 + ride.usd, 6)
    expect(fib.units * fib.rpu).toBeCloseTo(0.02 * fib.balanceAtEntry, 6)
    expect(ride.units * ride.rpu).toBeCloseTo(200, 6)
    // The Fib entry is v1's own trade: plain v1 opens the same one.
    const plain = runDay(d, 'v1')
    expect(plain.trades).toHaveLength(1)
    expect(plain.trades[0].E).toBe(fib.E)
    expect(plain.trades[0].stop).toBe(fib.stop)
    expect(plain.trades[0].r).toBeCloseTo(fib.r, 12)
  })
  it('M3: the stop counts first, and the Fib entry is taken after a losing ride (g = 2.5: stop at the higher 0.786)', () => {
    const run = runDay(d, 'flip', 0.272, 2.5)
    expect(run.trades.map((t) => [t.kind, t.why])).toEqual([
      ['ride', 'stop'],
      ['fib', 'tp2'],
    ])
    expect(run.trades[0].r).toBeCloseTo(-1, 2)
  })
  it('M3: the 120-minute limit, and the quick target', () => {
    // No pullback: price sits under the move, above the target.
    const flat = dataOf([
      ...rideDay([], [B - 0.0045, B - 0.004, B - 0.005, B - 0.0045]).slice(0, 36),
      ...quiet(B - 0.0045, 60),
    ])
    const a = runDay(flat, 'flip', 0.272, 1.5)
    expect(a.trades.map((t) => [t.kind, t.why])).toEqual([['ride', 'limit']])
    expect(a.trades[0].exitTime).toBe(a.trades[0].entryTime + 120 * 60)
    // A drop through the target right after the entry.
    const bars = rideDay()
    bars[33] = [B - 0.0039, B - 0.0038, B - 0.0062, B - 0.006]
    const b2 = runDay(dataOf(bars), 'flip', 0.272, 1.5)
    expect(b2.trades[0].kind).toBe('ride')
    expect(b2.trades[0].why).toBe('target')
    expect(b2.trades[0].r).toBeGreaterThan(0.3)
  })
  it("M5: a ride is only a market's first trade of the day, and counts as one of its 2", () => {
    // Setup 1 moves on candles that close against the move: no ride, a Fib entry that wins.
    const b = B
    const bars: Bar[] = [...quiet(b, 30)]
    bars.push([b, b + 0.001, b - 0.0002, b + 0.0008]) // 30
    bars.push([b - 0.0049, b - 0.004, b - 0.005, b - 0.0045]) // 31: arms, closes up
    bars.push([b - 0.0045, b - 0.0035, b - 0.0048, b - 0.004]) // 32
    bars.push([b - 0.004, b - 0.0002, b - 0.0041, b - 0.0003]) // 33: the Fib signal
    bars.push([b - 0.0003, b - 0.0002, b - 0.008, b - 0.0078]) // 34: both targets
    const B2 = b - 0.0078
    bars.push(...quiet(B2, 11)) // 35-45
    bars.push([B2, B2 + 0.001, B2 - 0.0002, B2 + 0.0008]) // 46
    bars.push([B2 + 0.0008, B2 + 0.0009, B2 - 0.002, B2 - 0.0018]) // 47
    bars.push([B2 - 0.0018, B2 - 0.0017, B2 - 0.004, B2 - 0.0039]) // 48: a big move candle
    bars.push([B2 - 0.0039, B2 - 0.0038, B2 - 0.005, B2 - 0.0049]) // 49
    const dd = dataOf([...bars, ...quiet(B2 - 0.0049, 96 - bars.length)])
    const run = runDay(dd, 'flip', 0.272, 1.5)
    expect(run.trades.map((t) => [t.kind, t.why])).toEqual([['fib', 'tp2']])
    expect(run.rideSignals).toBeGreaterThan(0)
    expect(
      run.outcomes.some(
        (o) => o.kind === 'ride' && o.result === "not the market's first trade of the day",
      ),
    ).toBe(true)
  })
  it('M5: no loops: a stopped ride and a stopped Fib entry end the day (at most 2 trades, 2 full losses)', () => {
    // After the Fib signal, price runs up through every stop, then a new SELL setup forms later.
    const after: Bar[] = [[B - 0.0003, B + 0.004, B - 0.0004, B + 0.0038]]
    const B3 = B + 0.0038
    after.push(
      ...quiet(B3, 11),
      [B3, B3 + 0.001, B3 - 0.0002, B3 + 0.0008],
      [B3 + 0.0008, B3 + 0.0009, B3 - 0.002, B3 - 0.0018],
      [B3 - 0.0018, B3 - 0.0017, B3 - 0.004, B3 - 0.0039],
      [B3 - 0.0039, B3 - 0.0038, B3 - 0.005, B3 - 0.0049],
      [B3 - 0.0049, B3 - 0.001, B3 - 0.0049, B3 - 0.0015],
      [B3 - 0.0015, B3 - 0.0002, B3 - 0.0016, B3 - 0.0003],
    )
    const run = runDay(dataOf(rideDay(after)), 'flip', 0.272, 2.5)
    expect(run.trades.map((t) => [t.kind, t.why])).toEqual([
      ['ride', 'stop'],
      ['fib', 'stop'],
    ])
    expect(run.trades.filter((t) => t.r < -0.9)).toHaveLength(2)
    expect(run.outcomes.some((o) => o.result === '2 trades today')).toBe(true)
  })
  it('M5: the ride and the Fib entry come one after the other, inside the caps', () => {
    const run = runDay(d, 'flip', 0.272, 1.5)
    expect(run.maxOpenSeen).toBe(1)
    expect(run.maxOpenRiskSeen).toBeLessThanOrEqual(0.02 + 1e-9)
    for (const t of run.trades)
      expect(t.riskUsd).toBeLessThanOrEqual(0.02 * t.balanceAtEntry + 1e-6)
  })
  it('M5: a v1 signal and a ride signal on one candle: the v1 signal goes first', () => {
    // A BUY setup with a long climb; its pullback candle (bar 44) reaches the BUY 0.786 and is also
    // a big SELL move candle that arms a SELL setup and passes the ride's size test.
    const b = B
    const bars: Bar[] = [...quiet(b, 30)]
    bars.push([b, b + 0.0002, b - 0.001, b - 0.0008]) // 30: BUY 1 = b - 0.0010
    bars.push([b - 0.0008, b + 0.002, b - 0.0009, b + 0.0018]) // 31: arms the BUY
    for (let n = 0; n < 12; n++) {
      const o = b + 0.0018 + n * 0.0004
      // 32-43: the climb; 0 follows it, but its candles close down, so there is no BUY ride.
      // Bar 42 is an up candle under the high: the 1 of the SELL setup.
      bars.push(
        n === 10
          ? [o, o + 0.0001, o - 0.0004, o + 0.00005]
          : [o, o + 0.0006, o - 0.0001, o - 0.00005],
      )
    }
    bars.push([b + 0.0062, b + 0.0063, b + 0.0005, b + 0.0007]) // 44: the pullback
    const dd = dataOf([...bars, ...quiet(b + 0.0007, 96 - bars.length)])
    const t2 = trackDay(dd.c15, dd.atr, S0, 2)
    expect(t2.signals.map((s) => [s.i, s.long])).toEqual([[44, true]])
    expect(rideSignals(dd.market, dd.c15, t2.setups, 0.5, 1.5).map((r) => [r.i, r.long])).toEqual([
      [44, false],
    ])
    const run = runDay(dd, 'flip', 0.272, 1.5)
    expect(run.trades.map((t) => [t.kind, t.side])).toEqual([['fib', 'BUY']])
    expect(run.outcomes.find((o) => o.kind === 'ride')?.result).toBe('trade open')
  })
})

describe('look-ahead guards: the ride', () => {
  const bars = rideDay()
  const d = dataOf(bars)
  it("the ride's decision at candle i does not change when later candles change or are cut off", () => {
    const tr = trackDay(d.c15, d.atr, S0, 2)
    const full = rideSignals(d.market, d.c15, tr.setups, 0.5, 1.5)
    for (let cut = 31; cut < 60; cut++) {
      const c = d.c15.slice(0, cut + 1)
      const a = atrSeries(c, 14)
      const t2 = trackDay(c, a, S0, 2)
      expect(rideSignals(d.market, c, t2.setups, 0.5, 1.5)).toEqual(full.filter((r) => r.i <= cut))
      const noisy = d.c15.map((x, i) =>
        i > cut ? { ...x, high: x.high + 0.01, low: x.low - 0.01, close: x.open + 0.003 } : x,
      )
      const na = atrSeries(noisy, 14)
      const t3 = trackDay(noisy, na, S0, 2)
      expect(rideSignals(d.market, noisy, t3.setups, 0.5, 1.5).filter((r) => r.i <= cut)).toEqual(
        full.filter((r) => r.i <= cut),
      )
    }
  })
  it('the ride fills from the 1-minute open after the signal close; the last minute of the signal candle does not move it', () => {
    const tr = trackDay(d.c15, d.atr, S0, 2)
    const [r] = rideSignals(d.market, d.c15, tr.setups, 0.5, 1.5)
    const a = prepareRide(d, S0, r, 0.272, null)
    const m1 = d.m1.map((x) =>
      x.time === r.T - 60 ? { ...x, close: x.close - 0.0003, low: x.low - 0.0003 } : x,
    )
    const b2 = prepareRide({ ...d, m1 }, S0, r, 0.272, null)
    if ('why' in a || 'why' in b2) throw new Error('no ride')
    expect(b2.E).toBe(a.E)
    expect(b2.plan).toEqual(a.plan)
  })
  it('nothing reads the Fib entry fill before it happens: the ride closes at that open, and later minutes change nothing', () => {
    const run = runDay(d, 'flip', 0.272, 1.5)
    const ride = run.trades[0]
    const changed = bars.map(
      (x, n): Bar => (n >= 36 ? [x[0], x[1] + 0.003, x[2] - 0.003, x[3]] : x),
    )
    const run2 = runDay(dataOf(changed), 'flip', 0.272, 1.5)
    expect(run2.trades[0]).toEqual(ride)
    // And the ride's close is the forced close at the Fib minute's open, not a price from inside it.
    expect(ride.fills).toHaveLength(1)
    expect(ride.fills[0].atOpen).toBe(true)
  })
})

// ── 3A v1-NY ──────────────────────────────────────────────────────────────

describe('3A v1-NY', () => {
  // DAY0 is in US winter: New York opens 13:00 UTC (bar 52), the range ends 13:30, last entry 15:00, time exit 16:30.
  const S = nySessionFor(DAY0)
  /** London high bumped to B + 0.0020 at 09:00; bar 54 pokes over it and closes inside; bar 55 closes past it. */
  const nyBars = (): Bar[] => {
    const bars = quiet(B, 96)
    bars[36] = [B, B + 0.002, B - 0.0005, B + 0.0002]
    bars[54] = [B, B + 0.0025, B - 0.0003, B + 0.001]
    bars[55] = [B + 0.001, B + 0.0028, B + 0.0009, B + 0.0026]
    for (let n = 56; n < 96; n++)
      bars[n] =
        n % 2
          ? [B + 0.0026, B + 0.0031, B + 0.0021, B + 0.0026]
          : [B + 0.0026, B + 0.0031, B + 0.0021, B + 0.0026]
    return bars
  }
  const d = dataOf(nyBars())
  const ch = chartOf(d, M15)

  it('N1: the New York clock, US winter and summer', () => {
    expect(S.summer).toBe(false)
    expect([S.start, S.rangeEnd, S.lastEntry, S.timeExit].map((t) => (t - DAY0) / 3600)).toEqual([
      13, 13.5, 15, 16.5,
    ])
    expect(S.londonStart - DAY0).toBe(7 * 3600)
    const jul = nySessionFor(Date.UTC(2026, 6, 15) / 1000)
    expect(jul.summer).toBe(true)
    expect((jul.start - jul.day) / 3600).toBe(12)
    expect((jul.timeExit - jul.day) / 3600).toBe(15.5)
    // The weeks between the US and UK changes: New York on summer time, London not.
    const mar = nySessionFor(Date.UTC(2026, 2, 16) / 1000)
    expect(mar.summer).toBe(true)
    expect(mar.londonStart - mar.day).toBe(7 * 3600)
  })
  it('N2: 5-minute candles are built from the 1-minute ones, with their own ATR', () => {
    const c5 = chartOf(d, 300)
    expect(c5.sec).toBe(300)
    expect(c5.c).toEqual(resample(d.m1, 300))
    expect(c5.c.length).toBe(96 * 3)
    expect(chartOf(d, 300)).toBe(c5) // built once
    expect(c5.atr).toEqual(atrSeries(c5.c, 14))
  })
  it('N3: the levels: London 07:00 London to 08:00 New York, the range 08:00 to 08:30 New York', () => {
    expect(nyLevels(d.m1, S)).toMatchObject({
      LH: B + 0.002,
      LL: B - 0.0005,
      RH: B + 0.0005,
      RL: B - 0.0005,
      rangeMinutes: 30,
    })
    // 20 of the 30 range minutes are needed.
    const cut = (n: number) => d.m1.filter((x) => !(x.time >= S.start && x.time < S.start + n * 60))
    expect(nyLevels(cut(10), S)).not.toBeNull()
    expect(nyLevels(cut(11), S)).toBeNull()
  })
  it('N3 look-ahead: the range is only known after its window closes; nothing at or after 08:30 New York changes it', () => {
    const lv = nyLevels(d.m1, S)
    const later = d.m1.map((x) =>
      x.time >= S.rangeEnd ? { ...x, high: x.high + 0.01, low: x.low - 0.01 } : x,
    )
    expect(nyLevels(later, S)).toEqual(lv)
    const inside = d.m1.map((x) => (x.time === S.rangeEnd - 60 ? { ...x, high: x.high + 0.01 } : x))
    expect(nyLevels(inside, S)!.RH).toBeGreaterThan(lv!.RH + 0.009)
    // The break is read only from candles that start at or after 08:30 New York.
    const early = nyBars()
    early[52] = [B, B + 0.003, B - 0.0005, B + 0.0029] // a range candle closes high: it is part of the range, not a break
    const d2 = dataOf(early)
    const lv2 = nyLevels(d2.m1, S)!
    // Bar 52 lifts the range high to B + 0.003; its own close is no break, and nothing later closes above it.
    expect(lv2.RH).toBeCloseTo(B + 0.003, 9)
    expect(nyBreak(chartOf(d2, M15), S, lv2, false)).toBeNull()
  })
  it('N4: w = off breaks the opening range; w = on must close past London too; a poke that closes back inside is a rejection', () => {
    const lv = nyLevels(d.m1, S)!
    expect(breakLines(lv, false)).toEqual({ BH: B + 0.0005, BL: B - 0.0005 })
    expect(breakLines(lv, true)).toEqual({ BH: B + 0.002, BL: B - 0.0005 })
    expect(nyBreak(ch, S, lv, false)).toMatchObject({ i: 54, long: true })
    expect(nyBreak(ch, S, lv, true)).toMatchObject({ i: 55, long: true })
    expect(londonLines(ch, S, lv)).toEqual({ high: 'rejection', low: 'untouched' })
  })
  it('N5: the break trade: stop past the far side of the range by b ATRs, cost floor, one target at 1.5 x the stop', () => {
    const lv = nyLevels(d.m1, S)!
    const brk = nyBreak(ch, S, lv, false)!
    const r = prepareBreak(d, S, ch, brk, lv, 0.5)
    if ('why' in r) throw new Error(r.why)
    expect(r.entryTime).toBe(brk.T)
    expect(r.plan.rawStop).toBeCloseTo(lv.RL - 0.5 * ch.atr[54], 12)
    expect(r.plan.dist).toBeCloseTo(Math.max(r.E - r.plan.rawStop, 10 * roundTrip(GBP, r.p)), 12)
    expect(r.plan.tp1).toBeCloseTo(r.E + 1.5 * r.plan.dist, 12)
    expect(r.plan.rr).toBe(1.5)
    expect(r.deadline).toEqual({ at: S.timeExit, why: 'time' })
  })
  it('N5: the fill may be at most 0.1 x the stop distance worse than the break close', () => {
    const lv = nyLevels(d.m1, S)!
    const brk = nyBreak(ch, S, lv, false)!
    const m1 = d.m1.map((x) =>
      x.time === brk.T
        ? { ...x, open: x.open + 0.0004, high: Math.max(x.high, x.open + 0.0004) }
        : x,
    )
    expect(prepareBreak({ ...d, m1 }, S, ch, brk, lv, 0.5)).toEqual({ why: 'no chase' })
  })
  it('N7: a break candle that closes inside the 08:30 data block uses up the day: no break trade', () => {
    const dn = dataOf(nyBars(), [{ time: DAY0 + 13.5 * 3600, currency: 'USD', event: 'CPI' }])
    const run = runNY([dn], { k: 2, b: 0.5, c: 15, w: false }, DAY0, DAY0 + 86_400)
    expect(run.trades).toHaveLength(0)
    expect(run.outcomes.find((o) => o.kind === 'break')?.result).toBe('news block')
    // w = on: its break candle closes at 14:00, when the block is over: it trades.
    const on = runNY([dn], { k: 2, b: 0.5, c: 15, w: true }, DAY0, DAY0 + 86_400)
    expect(on.trades.map((t) => [t.kind, t.entryTime - DAY0])).toEqual([['break', 14 * 3600]])
  })
  it("N6: the Fib entry comes only on the break's side, after the break candle, once the break trade is closed", () => {
    // Range bar 53 is the BUY setup's 1; bar 54 breaks up and arms it; bar 56 runs to the break target; bar 58 is the Fib signal.
    const bars = quiet(B, 96)
    bars[53] = [B, B + 0.0002, B - 0.001, B - 0.0008]
    bars[54] = [B - 0.0008, B + 0.002, B - 0.0009, B + 0.0018]
    bars[55] = [B + 0.0018, B + 0.004, B + 0.0017, B + 0.0039]
    bars[56] = [B + 0.0039, B + 0.0075, B + 0.0038, B + 0.0049]
    bars[57] = [B + 0.0049, B + 0.0049, B + 0.001, B + 0.0015]
    bars[58] = [B + 0.0015, B + 0.0016, B + 0.0001, B + 0.0002]
    for (let n = 59; n < 96; n++) bars[n] = [B + 0.0002, B + 0.0004, B, B + 0.0002]
    const dd = dataOf(bars)
    const run = runNY([dd], { k: 2, b: 0.5, c: 15, w: false }, DAY0, DAY0 + 86_400)
    expect(run.trades.map((t) => [t.kind, t.side, t.why])).toEqual([
      ['break', 'BUY', 'target'],
      ['fib', 'BUY', expect.any(String)],
    ])
    expect(run.trades[1].T).toBe(DAY0 + 14.75 * 3600) // bar 58 closes at 14:45
    expect(run.trades[1].strategy).toBe('ny')
    // A SELL break the same day would make this BUY signal the wrong side.
    expect(run.trades.every((t) => t.entryTime >= S.rangeEnd && t.exitTime <= S.timeExit)).toBe(
      true,
    )
  })
  it('N8: one trade per market at a time, at most 2 a day, and the coin draws stay in the New York window', () => {
    const rnd = seeded(3)
    for (let n = 0; n < 500; n++) {
      for (const sec of [300, 900]) {
        const { T } = coinDrawNY(rnd, S, sec)
        expect(T).toBeGreaterThanOrEqual(S.rangeEnd + sec)
        expect(T).toBeLessThanOrEqual(S.lastEntry)
        expect((T - S.rangeEnd) % sec).toBe(0)
      }
    }
  })
})

// ── 3B thirds ─────────────────────────────────────────────────────────────

describe('3B thirds', () => {
  // The ride day's SELL signal on bar 35 (an up candle: not confident). Rung 2 on bar 36, rung 3 on bar 37, the turn on bar 38.
  const after: Bar[] = [
    [B - 0.0003, B + 0.0003, B - 0.0004, B + 0.0001],
    [B + 0.0001, B + 0.0006, B, B + 0.0005],
    [B + 0.0005, B + 0.0007, B - 0.0005, B - 0.0004],
    [B - 0.0004, B - 0.0003, B - 0.008, B - 0.0078],
  ]
  const d = dataOf(rideDay(after))
  const L = [0.786, 0.836, 0.886].map((f) => B - 0.005 + f * 0.006)

  it('T1: a turn candle closes our way', () => {
    const x = { time: 0, open: 1, high: 1.1, low: 0.9, close: 0.95 }
    expect(turnCandle(x, false)).toBe(true)
    expect(turnCandle(x, true)).toBe(false)
  })
  it('T2: a signal candle that already closed our way goes in at once, exactly as v1', () => {
    const conf = dataOf(rideDay(undefined, [B - 0.001, B - 0.0002, B - 0.0016, B - 0.0014]))
    const run = runDay(conf, 'thirds')
    const plain = runDay(conf, 'v1')
    expect(run.trades.map((t) => [t.kind, t.confident])).toEqual([['fib', true]])
    expect(run.trades[0].E).toBe(plain.trades[0].E)
    expect(run.trades[0].r).toBeCloseTo(plain.trades[0].r, 12)
    expect(run.thirds).toMatchObject({ taken: 1, confident: 1, ladders: 0 })
  })
  it('T3 and T4: rungs at 0.786, 0.836 and 0.886; one stop from the last rung; a third at the close of the first candle that reaches each', () => {
    const run = runDay(d, 'thirds')
    const [t] = run.trades
    expect(t.kind).toBe('thirds')
    const parts = t.parts!
    expect(parts.map((p) => [p.rung, (p.candle - DAY0) / M15])).toEqual([
      [1, 35],
      [2, 36],
      [3, 37],
      [4, 38],
    ])
    for (const p of parts) expect(p.entryTime).toBe(p.candle + M15)
    // The ladder stop: v1's rule 2.5 for a fill exactly at the last rung.
    const sig = daySignals(d.c15, d.atr, S0, 2)[0]
    const last = planFrom(
      GBP,
      false,
      L[2],
      L[2],
      sig.one + 0.5 * sig.atr,
      sig.zero,
      sig.zero - 0.272 * 0.006,
    )
    if ('why' in last) throw new Error(last.why)
    expect(parts[0].stopAtEntry).toBeCloseTo(last.stop, 12)
    expect(parts[0].riskUsd).toBeCloseTo(200 / 3, 6)
    expect(sig.level).toBeCloseTo(L[0], 12)
  })
  it('T5: the add at the first turn candle: stop behind the pullback, never further than the ladder stop, to the full 2%', () => {
    const run = runDay(d, 'thirds')
    const [t] = run.trades
    const add = t.parts![3]
    expect(t.stopMove).not.toBeNull()
    expect(t.stopMove!.to).toBeLessThan(t.stopMove!.from) // a SELL: the new stop is closer
    expect(t.stop).toBe(t.stopMove!.to)
    // P = the highest high of bars 35 to 38; raw stop P + b x ATR[38], then the floor and the cap.
    const P = B + 0.0007
    const raw = P + 0.5 * d.atr[38]
    const reward = 0.5 * (add.E - (B - 0.005)) + 0.5 * (add.E - (B - 0.005 - 0.272 * 0.006))
    let dd = Math.max(raw - add.E, 10 * roundTrip(GBP, add.p))
    if (reward / dd > 2.5) dd = reward / 2.5
    expect(t.stopMove!.to).toBeCloseTo(Math.min(t.stopMove!.from, add.E + dd), 12)
    expect(reward / (t.stopMove!.to - add.E)).toBeGreaterThanOrEqual(1.5)
    expect(add.tradeRiskAfter).toBeCloseTo(0.02 * add.balanceAtEntry, 6)
    expect(run.thirds).toMatchObject({
      ladders: 1,
      ladderTrades: 1,
      thirdsOpened: [1, 1, 1],
      addsTried: 1,
      addsOpened: 1,
    })
  })
  it("thirds' total risk is never above 2%: every third, and the add, inside the cap", () => {
    const run = runDay(d, 'thirds')
    const [t] = run.trades
    for (const p of t.parts!)
      expect(p.tradeRiskAfter).toBeLessThanOrEqual(0.02 * p.balanceAtEntry + 1e-6)
    expect(t.parts!.slice(0, 3).map((p) => +p.tradeRiskAfter.toFixed(6))).toEqual(
      [200 / 3, 400 / 3, 200].map((x) => +x.toFixed(6)),
    )
    expect(run.maxOpenRiskSeen).toBeLessThanOrEqual(0.02 + 1e-9)
  })
  it('T7: exits on the whole trade (TP1 halves every part, TP2 the rest); R = net $ / 2% of the balance at the first entry', () => {
    const run = runDay(d, 'thirds')
    const [t] = run.trades
    expect(t.why).toBe('tp2')
    for (const p of t.parts!)
      expect(p.fills.map((f) => [f.why, f.share])).toEqual([
        ['tp1', 0.5],
        ['tp2', 0.5],
      ])
    expect(t.riskUsd).toBeCloseTo(200, 6)
    expect(t.r).toBeCloseTo(t.usd / 200, 12)
    expect(run.endBalance).toBeCloseTo(10000 + t.usd, 6)
    expect(rescoreThirds(t, d, 1)).toBeCloseTo(t.r, 9)
    expect(rescoreCosts(t, d, 2)).toBeLessThan(rescoreCosts(t, d, 0.5))
  })
  it('T5: an add that plans under 1.5R does not open, and the stop stays', () => {
    // The turn candle closes almost at 0: the add would plan far under 1.5R.
    const near0: Bar[] = [
      after[0],
      after[1],
      [B + 0.0005, B + 0.0007, B - 0.0048, B - 0.0047],
      ...quiet(B - 0.0047, 4),
    ]
    const run = runDay(dataOf(rideDay(near0)), 'thirds')
    const [t] = run.trades
    expect(t.parts!.map((p) => p.rung)).toEqual([1, 2, 3])
    expect(t.stopMove).toBeNull()
    expect(run.outcomes.some((o) => o.result === 'add: plan under 1.5R')).toBe(true)
  })
  it('T6: a candle that trades past 1 ends the ladder; the open thirds run on to their exits', () => {
    const past: Bar[] = [[B - 0.0003, B + 0.0015, B - 0.0004, B + 0.0012], ...quiet(B + 0.0012, 4)]
    const run = runDay(dataOf(rideDay(past)), 'thirds')
    const [t] = run.trades
    expect(t.parts!.map((p) => p.rung)).toEqual([1])
    expect(run.thirds!.ends).toEqual({ 'past 1': 1 })
    expect(run.thirds!.pastOneBeforeTurn).toBe(1)
  })
  it('T6: while a ladder is alive a new v1 signal in that market is skipped; a ladder counts once a part opened', () => {
    const run = runDay(d, 'thirds')
    expect(run.trades).toHaveLength(1)
    expect(run.outcomes.filter((o) => o.result === 'ladder')).toHaveLength(1)
  })
  it("look-ahead: the turn is decided on the candle's own close, and later candles do not change the parts", () => {
    // Bar 38 closes up instead (its last minute moved): no add at bar 38.
    const bars = rideDay(after)
    bars[38] = [B + 0.0005, B + 0.0007, B - 0.0005, B + 0.0006]
    const run = runDay(dataOf(bars), 'thirds')
    expect(run.trades[0].parts!.some((p) => p.rung === 4 && p.candle === DAY0 + 38 * M15)).toBe(
      false,
    )
    // Different candles after the add: the same four parts at the same fills.
    const base = runDay(d, 'thirds').trades[0]
    const changed = rideDay([...after.slice(0, 3), ...quiet(B - 0.0004, 10)])
    const t2 = runDay(dataOf(changed), 'thirds').trades[0]
    expect(t2.parts!.map((p) => [p.rung, p.entryTime, p.E, p.units])).toEqual(
      base.parts!.map((p) => [p.rung, p.entryTime, p.E, p.units]),
    )
    expect(t2.why).not.toBe(base.why)
  })
  it('walkParts: a part that joins after TP1 keeps all its units until TP2', () => {
    const t0 = DAY0 + 10 * 3600
    const m1: OHLCCandle[] = [
      [1.3, 1.3, 1.2949, 1.295],
      [1.296, 1.296, 1.2955, 1.296],
      [1.296, 1.296, 1.2925, 1.293],
    ].map(([o, h, l, c], n) => ({ time: t0 + n * 60, open: o, high: h, low: l, close: c }))
    const w = walkParts({
      m: GBP,
      m1,
      long: false,
      parts: [
        { from: 0, E: 1.3 },
        { from: 1, E: 1.296 },
      ],
      stops: [{ from: -Infinity, price: 1.302 }],
      tp1: 1.295,
      tp2: 1.293,
      deadline: t0 + 3600,
      deadlineWhy: 'time',
    })
    expect(w.fills[0].map((f) => [f.why, f.share])).toEqual([
      ['tp1', 0.5],
      ['tp2', 0.5],
    ])
    expect(w.fills[1].map((f) => [f.why, f.share])).toEqual([['tp2', 1]])
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
  it('v1-flip: the top total R; within 2R the fewest rides; then ext = 0.272', () => {
    const r = (ext: number, g: number, totalR: number, rides: number) => ({ ext, g, totalR, rides })
    // Top 12R; within 2R: 12R (290 rides) and 10R (300 rides); 8.5R is out. The fewer rides win.
    expect(
      pickFlip([
        r(0.272, 1.5, 10, 300),
        r(0.272, 2.5, 8.5, 150),
        r(0.702, 1.5, 12, 290),
        r(0.702, 2.5, 5, 140),
      ]),
    ).toEqual({ ext: 0.702, g: 1.5 })
    expect(
      pickFlip([r(0.272, 1.5, 10, 300), r(0.272, 2.5, 9, 150), r(0.702, 1.5, 11, 290)]),
    ).toEqual({ ext: 0.272, g: 2.5 })
    expect(pickFlip([r(0.272, 1.5, 10, 300), r(0.702, 2.5, 13, 140)])).toEqual({
      ext: 0.702,
      g: 2.5,
    })
    expect(pickFlip([r(0.702, 2.5, 10, 150), r(0.272, 2.5, 9, 150)])).toEqual({
      ext: 0.272,
      g: 2.5,
    })
  })
  it('v1-NY: as v1 (100 trades, 25% drawdown, top total, within 2R the most trades); then c = 15, then w = on', () => {
    const r = (c: number, w: boolean, trades: number, totalR: number, maxDrawdown = 0.2) => ({
      c,
      w,
      trades,
      totalR,
      maxDrawdown,
    })
    expect(pickNY([r(15, true, 150, 10), r(5, false, 200, 9)])).toMatchObject({
      c: 5,
      w: false,
      qualified: true,
    })
    expect(pickNY([r(5, true, 150, 10), r(15, false, 150, 10), r(15, true, 150, 9)])).toMatchObject(
      { c: 15, w: true },
    )
    expect(pickNY([r(5, false, 150, 10), r(5, true, 150, 10)])).toMatchObject({ c: 5, w: true })
    expect(pickNY([r(15, true, 99, 10), r(5, false, 300, 10, 0.3)])).toMatchObject({
      c: 15,
      w: true,
      qualified: false,
    })
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
      rides: 30,
      ridesR: 1,
      flipTotalR: 13,
      plainTotalR: 10,
      flipDrawdown: 0.2,
      plainDrawdown: 0.15,
    }
    expect(flipBeatsPlain(o).beats).toBe(true)
    expect(flipBeatsPlain({ ...o, rides: 29 }).beats).toBe(false)
    expect(flipBeatsPlain({ ...o, ridesR: 0 }).beats).toBe(false)
    expect(flipBeatsPlain({ ...o, flipTotalR: 12.9 }).beats).toBe(false)
    expect(flipBeatsPlain({ ...o, flipDrawdown: 0.21 }).beats).toBe(false)
  })
  it('thirds beats all at once: 30 ladders, no less R, no deeper drop, and clearly better on one', () => {
    const o = {
      ladders: 30,
      thirdsTotalR: 13,
      plainTotalR: 10,
      thirdsDrawdown: 0.15,
      plainDrawdown: 0.15,
    }
    expect(thirdsBeats(o).beats).toBe(true)
    expect(thirdsBeats({ ...o, ladders: 29 }).beats).toBe(false)
    expect(thirdsBeats({ ...o, thirdsTotalR: 12.9 }).beats).toBe(false) // not clearly better
    expect(thirdsBeats({ ...o, thirdsTotalR: 10, thirdsDrawdown: 0.12 }).beats).toBe(true) // 3 points less drawdown
    expect(thirdsBeats({ ...o, thirdsTotalR: 20, thirdsDrawdown: 0.16 }).beats).toBe(false) // a trade-off does not count
    expect(thirdsBeats({ ...o, thirdsTotalR: 9.9, thirdsDrawdown: 0.05 }).beats).toBe(false)
  })
  it('95th percentile of 1,000 runs is the 950th value', () => {
    expect(p95(Array.from({ length: 1000 }, (_, i) => 1000 - i))).toBe(950)
  })
  it('mirror: the same minute the other way, same distances from its own fill', () => {
    const d = dataOf(flipDay([[B + 0.0026, B + 0.009, B + 0.0025, B + 0.0088]]))
    const run = runDay(d)
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
    const d = dataOf(rideDay())
    const run = runDay(d, 'flip')
    const byId = new Map([[d.id, d]])
    expect(run.trades.map((t) => t.kind)).toEqual(['ride', 'fib'])
    expect(coinRun(run.trades, byId, 7)).toEqual(coinRun(run.trades, byId, 7))
  })
  it('a mirrored ride keeps its own clock closes (the Fib close at the same moment)', () => {
    const d = dataOf(rideDay())
    const [ride] = runDay(d, 'flip').trades
    expect(ride.deadlineWhy).toBe('fib')
    expect(Number.isFinite(mirrorR(ride, d))).toBe(true)
  })
  it('coin flips draw again inside news blocks (20 tries at most)', () => {
    const d = dataOf(flipDay())
    const run = runDay(d)
    const blocked = { ...d, windows: [{ from: DAY0, to: DAY0 + 86_400 }] }
    expect(coinRun(run.trades, new Map([[d.id, blocked]]), 1)).toEqual({ total: 0, missed: 1 })
  })
  it('half and double costs: same entries and levels, exits walked again; at normal costs nothing moves', () => {
    const d = dataOf(rideDay())
    const run = runDay(d, 'flip')
    expect(run.trades).toHaveLength(2)
    for (const t of run.trades) expect(rescoreCosts(t, d, 1)).toBeCloseTo(t.r, 9)
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
      const run = runLondon([data[0]], { k: 2, b: 0.5 }, FROM, TO)
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

    it('a whole year of v1-flip: at most 2 trades and 1 ride per market and day, the ride first, 2 full losses, risk under the caps', () => {
      for (const g of [1.5, 2.5]) {
        const run = runLondon(data, { k: 2, b: 0.5, mode: 'flip', ext: 0.272, g }, FROM, TO)
        const byDay = new Map<string, LondonTrade[]>()
        for (const t of run.trades)
          byDay.set(`${t.market}|${t.day}`, [...(byDay.get(`${t.market}|${t.day}`) ?? []), t])
        for (const ts of byDay.values()) {
          expect(ts.length).toBeLessThanOrEqual(2)
          expect(ts.filter((t) => t.kind === 'ride').length).toBeLessThanOrEqual(1)
          for (const t of ts) if (t.kind === 'ride') expect(ts[0]).toBe(t)
          expect(ts.filter((t) => t.r <= -0.99 && !t.tp1Hit).length).toBeLessThanOrEqual(2)
          // One trade per market at a time.
          if (ts.length === 2) expect(ts[1].entryTime).toBeGreaterThanOrEqual(ts[0].exitTime)
        }
        expect(
          run.trades
            .filter((t) => t.kind === 'ride')
            .every((t) => t.exitTime - t.entryTime <= 120 * 60),
        ).toBe(true)
        expect(run.maxOpenSeen).toBeLessThanOrEqual(V1.maxOpen)
        expect(run.maxOpenRiskSeen).toBeLessThanOrEqual(V1.maxOpenRiskPct / 100 + 1e-9)
        for (const t of run.trades)
          expect(t.riskUsd).toBeLessThanOrEqual(0.02 * t.balanceAtEntry + 1e-6)
      }
    })

    it('the one dollar bet holds all year: never a GBP/USD and a gold trade open on opposite dollar sides', () => {
      for (const run of [
        runLondon(data, { k: 2, b: 0.5 }, FROM, TO),
        runLondon(data, { k: 2, b: 0.5, mode: 'flip', ext: 0.272, g: 1.5 }, FROM, TO),
        runNY(data, { k: 2, b: 0.5, c: 15, w: false }, FROM, TO),
      ]) {
        const g = run.trades.filter((t) => t.market === 'GBPUSD')
        const x = run.trades.filter((t) => t.market === 'XAUUSD')
        for (const a of g)
          for (const b2 of x) {
            if (dollarSide(a.market, a.long) === dollarSide(b2.market, b2.long)) continue
            const [first, second] = a.entryTime <= b2.entryTime ? [a, b2] : [b2, a]
            expect(second.entryTime >= first.exitTime).toBe(true)
          }
      }
    })

    it('the ride and v1-NY check values (M6 ride A, N9 break A), entry side', () => {
      const gbp = data[0]
      const day = Date.parse('2025-11-11T00:00:00Z') / 1000
      const s = sessionFor(day)
      const tr = trackDay(gbp.c15, gbp.atr, s, 2)
      const r = rideSignals(gbp.market, gbp.c15, tr.setups, 0.5, 1.5)[0]
      expect(new Date(r.time * 1000).toISOString().slice(11, 16)).toBe('07:00')
      expect([
        +r.one.toFixed(5),
        +r.zero.toFixed(5),
        +r.level.toFixed(5),
        +r.size.toFixed(2),
      ]).toEqual([1.31711, 1.31206, 1.31603, 2.26])
      const a = prepareRide(gbp, s, r, 0.272, null)
      if ('why' in a) throw new Error(a.why)
      expect([
        +a.p.toFixed(5),
        +a.E.toFixed(5),
        +(a.plan.dist / 1e-4).toFixed(1),
        +a.plan.tp1.toFixed(5),
        +a.plan.rr.toFixed(2),
      ]).toEqual([1.31288, 1.31286, 31.7, 1.31069, 0.69])
      const ns = nySessionFor(Date.parse('2025-11-12T00:00:00Z') / 1000)
      const ch = chartOf(gbp, M15)
      const lv = nyLevels(gbp.m1, ns)!
      expect([lv.LH, lv.LL, lv.RH, lv.RL].map((v) => +v.toFixed(5))).toEqual([
        1.31551, 1.31072, 1.31225, 1.31046,
      ])
      const brk = nyBreak(ch, ns, lv, false)!
      const x = prepareBreak(gbp, ns, ch, brk, lv, 0.5)
      if ('why' in x) throw new Error(x.why)
      expect([brk.long, +x.E.toFixed(5), +x.plan.stop.toFixed(5), +x.plan.tp1.toFixed(5)]).toEqual([
        false,
        1.3099,
        1.31278,
        1.30558,
      ])
    })

    it('a year of thirds: every part inside the 2% cap, and about 1 in 20 signals goes in at once', () => {
      const run = runLondon(data, { k: 2, b: 0.5, mode: 'thirds' }, FROM, TO)
      for (const t of run.trades.filter((x) => x.kind === 'thirds'))
        for (const p of t.parts!)
          expect(p.tradeRiskAfter).toBeLessThanOrEqual(0.02 * p.balanceAtEntry + 1e-6)
      expect(run.thirds!.confident).toBeLessThan(run.thirds!.taken / 10)
      expect(run.maxOpenRiskSeen).toBeLessThanOrEqual(V1.maxOpenRiskPct / 100 + 1e-9)
    })

    it('every v1-NY trade enters from 08:30 New York and exits by 11:30 New York, inside the race hours', () => {
      const run = runNY(data, { k: 2, b: 0.5, c: 5, w: true }, FROM, TO)
      for (const t of run.trades) {
        const s = nySessionFor(Date.parse(t.day) / 1000)
        expect(t.entryTime).toBeGreaterThan(s.rangeEnd)
        expect(t.entryTime).toBeLessThanOrEqual(s.lastEntry + 5 * 60)
        expect(inRaceHours(s, t.entryTime)).toBe(true)
        expect(t.exitTime).toBeLessThanOrEqual(s.timeExit)
      }
    })

    it('no look-ahead on real data: cutting the year in half changes no trade that closed before the cut', () => {
      const cutAt = Date.UTC(2026, 4, 1) / 1000
      const cut = data.map((d) =>
        prepareMarket(
          d.id,
          d.m1.filter((b) => b.time < cutAt),
          [],
        ),
      )
      cut.forEach((c, n) => (c.windows = data[n].windows))
      const before = (ts: LondonTrade[]) => ts.filter((t) => t.exitTime < cutAt - 86_400)
      for (const mode of ['flip', 'thirds'] as const) {
        const full = runLondon(data, { k: 2, b: 0.5, mode, ext: 0.272, g: 1.5 }, FROM, TO)
        const part = runLondon(cut, { k: 2, b: 0.5, mode, ext: 0.272, g: 1.5 }, FROM, cutAt)
        expect(before(part.trades)).toEqual(before(full.trades))
      }
      const fullNY = runNY(data, { k: 2, b: 0.5, c: 5, w: false }, FROM, TO)
      const partNY = runNY(cut, { k: 2, b: 0.5, c: 5, w: false }, FROM, cutAt)
      expect(before(partNY.trades)).toEqual(before(fullNY.trades))
    })
  },
)
