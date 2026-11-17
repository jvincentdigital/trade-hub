import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import {
  AS_SOLD,
  averages,
  lots,
  eveningMoves,
  momentsOf,
  runSession,
  signalAtClose,
  type Averages,
  type CopyConfig,
  type Moments,
} from './owlCopy'

/** Moments given directly as [price, signal] pairs, so each rule can be tested on its own. */
const M = (pts: [number, number][], jumps: number[] = []): Moments => ({
  n: pts.length,
  p: Float64Array.from(pts.map((x) => x[0])),
  jump: Uint8Array.from(pts.map((_, k) => (jumps.includes(k) ? 1 : 0))),
  sig: Int8Array.from(pts.map((x) => x[1])),
  sigInv: Int8Array.from(pts.map(() => 0)),
})
const cfg = (over: Partial<CopyConfig> = {}): CopyConfig => ({
  ...AS_SOLD,
  spread: 0,
  commission: 0,
  ...over,
})
const BIG = 1e9

describe('owl copy: sizes', () => {
  it('the passive 50k file grows 0.02 by 1.357 a trade, rounded to 0.01 lot, up to 0.5', () => {
    expect(Array.from({ length: 13 }, (_, n) => lots(AS_SOLD, n))).toEqual([
      0.02, 0.03, 0.04, 0.05, 0.07, 0.09, 0.12, 0.17, 0.23, 0.31, 0.42, 0.5, 0.5,
    ])
  })
})

describe('owl copy: one session', () => {
  it('a buy opens at the Ask on a buy signal and closes at its target, paying commission', () => {
    const r = runSession(
      M([
        [100, 1],
        [100.5, 0],
        [101.1, 0],
      ]),
      cfg({ spread: 0.1, commission: 0.07 }),
      BIG,
    )
    // 2 ounces bought at 100.10, target 101.10, reached when the Bid is 101.10.
    expect(r).toMatchObject({ targets: 1, trades: 1, stopped: false })
    expect(r.pnl).toBeCloseTo(2 * 1 - 2 * 0.07, 9)
  })
  it('a sell is the mirror image: opens at the Bid, target reached by the Ask', () => {
    const r = runSession(
      M([
        [100, -1],
        [99, 0],
        [98.9, 0],
      ]),
      cfg({ spread: 0.1, commission: 0.07 }),
      BIG,
    )
    expect(r).toMatchObject({ targets: 1, trades: 1 })
    expect(r.pnl).toBeCloseTo(2 * 1 - 2 * 0.07, 9)
  })
  it('adds only when the price is a step worse AND the signal is on again; one target for the pile', () => {
    const r = runSession(
      M([
        [100, 1], // buy 2 oz at 100.10
        [98.5, 0], // a step worse, but no signal: nothing
        [98.6, 1], // signal on: add 3 oz at 98.70
        [100.3, 0], // average (100.10*2 - 0.02*2 + 98.70*3) / 5 = 99.252, to the cent 99.25; target 100.25
      ]),
      cfg({ spread: 0.1, commission: 0.07 }),
      BIG,
    )
    expect(r).toMatchObject({ targets: 1, trades: 2, deepest: 2 })
    expect(r.pnl).toBeCloseTo(5 * 100.25 - (2 * 100.1 + 3 * 98.7) - 5 * 0.07, 9)
  })
  it('what is still open at the end of the session closes at market', () => {
    const r = runSession(
      M([
        [100, 1],
        [99.5, 0],
      ]),
      cfg({ spread: 0.1, commission: 0.07 }),
      BIG,
    )
    expect(r).toMatchObject({ targets: 0, stopped: false })
    expect(r.pnl).toBeCloseTo(2 * (99.5 - 100.1) - 2 * 0.07, 9)
  })
  it('an open loss above 4% of equity closes everything and ends the session', () => {
    const r = runSession(
      M([
        [100, 1], // buy 2 oz at 100.10 on a $100 account
        [98.3, 0], // open -3.60, 4% of 96.40 is 3.856: not yet
        [98.1, 0], // open -4.00, 4% of 96.00 is 3.84: stop
        [97, 1], // never reached
      ]),
      cfg({ spread: 0.1, commission: 0.07 }),
      100,
    )
    expect(r).toMatchObject({ stopped: true, trades: 1 })
    expect(r.pnl).toBeCloseTo(-4 - 0.14, 9)
    expect(r.worst).toBeCloseTo(-4.14, 9)
  })
  it("a side in pause opens nothing, and the buy side's pause also blocks the sell side", () => {
    const pts: [number, number][] = [
      [100, 1], // buy 2 oz at 100
      [99, 1], // add 3 oz at 99; own open result -2, 2% of 198 is 3.96: no pause
      [98.4, 1], // no add (0.6 from the last); own open result -5.0 > 3.9: pause on
      [98, 1], // a full step from the last trade, but paused: nothing
      [98, -1], // the sell side is blocked by the buy side's pause
    ]
    const paused = runSession(M(pts), cfg(), 200)
    expect(paused).toMatchObject({ trades: 2, stopped: false })
    expect(paused.pnl).toBeCloseTo(2 * (98 - 100) + 3 * (98 - 99), 9)
    // Without the pause the same moments add a third buy and open a sell.
    expect(runSession(M(pts), cfg({ pausePct: 50 }), 200).trades).toBe(4)
  })
  it('the fresh side opens bigger once the other side was seen with 3 or more trades', () => {
    const start: [number, number][] = [
      [100, 1], // buy 0.02
      [99, 1], // add 0.03
      [98, 1], // add 0.04 (the count stored at this call is still 2)
    ]
    const seen: [number, number][] = [...start, [97.9, 1], [97.9, -1], [96.9, 0]]
    const buys = 2 * (96.9 - 100) + 3 * (96.9 - 99) + 4 * (96.9 - 98)
    // 0.04 / 1.357 = 0.0295, rounded to 0.03 lots = 3 ounces sold at 97.90.
    expect(runSession(M(seen), cfg(), BIG).pnl).toBeCloseTo(buys + 3 * (97.9 - 96.9), 9)
    // The sensitivity reading: that first trade is refused, so no sell at all.
    const refused = runSession(M(seen), cfg({ hedgeFirst: 'refused' }), BIG)
    expect(refused.trades).toBe(3)
    expect(refused.pnl).toBeCloseTo(buys, 9)
    // The count is only refreshed when the buy engine acts: without that call the sell opens at the normal size.
    const stale: [number, number][] = [...start, [97.9, -1], [96.9, 0]]
    expect(runSession(M(stale), cfg(), BIG).pnl).toBeCloseTo(buys + 2 * (97.9 - 96.9), 9)
  })
  it('a trade limit stops adds on that side', () => {
    const pts: [number, number][] = [
      [100, 1],
      [99, 1],
      [98, 1],
      [97, 1],
    ]
    expect(runSession(M(pts), cfg(), BIG).trades).toBe(4)
    expect(runSession(M(pts), cfg({ maxTrades: 2 }), BIG).trades).toBe(2)
  })
  it('the hidden rule: more than 12 trades seen on a side and a dollar of open profit closes everything', () => {
    const pts: [number, number][] = []
    for (let n = 0; n < 13; n++) pts.push([100 - n * 0.11, 1]) // 13 buys of 1 oz, average 99.34
    pts.push([98.64, 1]) // no add; the stored count becomes 13
    pts.push([99.5, 0]) // open result 13 * 0.16 = 2.08
    pts.push([99.6, 0])
    const r = runSession(M(pts), cfg({ grid: 0.1, take: 100, factor: 1, firstLot: 0.01 }), BIG)
    expect(r).toMatchObject({ trades: 13, kills: 1, targets: 0, stopped: false })
    expect(r.pnl).toBeCloseTo(13 * (99.5 - 99.34), 6)
  })
})

describe('owl copy: details fixed in the plan after review', () => {
  it('a target passed by a jump at a candle open fills at the jump price', () => {
    const pts: [number, number][] = [
      [100, 1], // buy 2 oz at 100, target 101
      [101.6, 0],
    ]
    expect(runSession(M(pts), cfg(), BIG).pnl).toBeCloseTo(2 * 1, 9)
    expect(runSession(M(pts, [1]), cfg(), BIG).pnl).toBeCloseTo(2 * 1.6, 9)
  })
  it('after a stop the evening ends; in the sensitivity run trading starts over at the next moment', () => {
    const pts: [number, number][] = [
      [100, 1], // buy 2 oz at 100 on a $100 account
      [98, 1], // open -4.00 > 4% of 96: stop; nothing else happens at this moment
      [98, 1], // start over: a new first buy at 98
      [99, 0], // its target
    ]
    const ended = runSession(M(pts), cfg(), 100)
    expect(ended).toMatchObject({ stopped: true, trades: 1, targets: 0 })
    expect(ended.pnl).toBeCloseTo(-4, 9)
    const resumed = runSession(M(pts), cfg({ afterStop: 'resume' }), 100)
    expect(resumed).toMatchObject({ stopped: true, trades: 2, targets: 1 })
    expect(resumed.pnl).toBeCloseTo(-4 + 2, 9)
  })
  it('a twin runs on the same signal moved in time', () => {
    const pts: [number, number][] = [
      [100, 0],
      [100, 1],
      [101, 0],
      [101, 0],
    ]
    // As is: buy at the second moment, target 101 reached at the third.
    expect(runSession(M(pts), cfg(), BIG)).toMatchObject({ trades: 1, targets: 1 })
    // Moved by two moments, the signal is on at the fourth moment only: the buy at 101 is still open at the end.
    const twin = runSession(M(pts), cfg(), BIG, false, 2)
    expect(twin).toMatchObject({ trades: 1, targets: 0 })
    expect(twin.pnl).toBeCloseTo(0, 9)
  })
  it('a grid step that is exact in dollars is not lost to floating point', () => {
    const pts: [number, number][] = [
      [100, 1],
      [99.9, 1], // 100 - 99.9 is 0.0999... in binary; it still counts as a full 10-cent step
    ]
    expect(runSession(M(pts), cfg({ grid: 0.1 }), BIG).trades).toBe(2)
  })
})

describe('owl copy: counters for the flipped study', () => {
  it('counts the ounces opened and the best point, so the exact opposite of a session can be worked out', () => {
    const r = runSession(
      M([
        [100, 1],
        [100.5, 0],
        [101.1, 0],
      ]),
      cfg({ spread: 0.1, commission: 0.07 }),
      BIG,
    )
    expect(r.ounces).toBe(2)
    expect(r.best).toBeCloseTo(1.86, 9)
    // The opposite trade: 2 ounces sold at the Bid of 100.00 and bought back at the Ask of 101.20, less commission.
    const opposite = 2 * (100 - 101.2) - 2 * 0.07
    expect(-r.pnl - 2 * (0.1 + 0.07) * r.ounces).toBeCloseTo(opposite, 9)
  })
})

describe('owl copy: averages, moments and signal', () => {
  const c = (time: number, open: number, high: number, low: number, close: number): OHLCCandle => ({
    time,
    open,
    high,
    low,
    close,
  })
  it('the averages are exponential: half weight on the newest high and low, 2/35 on the newest open', () => {
    const a = averages([c(0, 10, 12, 8, 11), c(60, 20, 22, 18, 21)])
    expect([a.high[0], a.low[0], a.open[0]]).toEqual([12, 8, 10])
    expect(a.high[1]).toBeCloseTo(17, 12)
    expect(a.low[1]).toBeCloseTo(13, 12)
    expect(a.open[1]).toBeCloseTo((2 / 35) * 20 + (33 / 35) * 10, 12)
  })
  it("every candle's open is a moment, then low, high, close in moves of at most 10 cents, with the signal at each", () => {
    const m1 = [c(0, 100, 100, 100, 100), c(60, 100, 100.25, 99.95, 100.2)]
    const avg: Averages = {
      high: Float64Array.of(100.1, 0),
      low: Float64Array.of(99.9, 0),
      open: Float64Array.of(0, 100),
    }
    const m = momentsOf(m1, avg, 1, 2)
    expect(Array.from(m.p).map((x) => Math.round(x * 100) / 100)).toEqual([
      100, 99.95, 100.05, 100.15, 100.25, 100.2,
    ])
    // Buy signal only where the price is above half the candle's high so far plus half of 100.10, and above 100.
    expect(Array.from(m.sig)).toEqual([0, 0, 0, 1, 1, 1])
    expect(Array.from(m.sigInv)).toEqual([0, 0, 0, 0, 0, 0])
    expect(Array.from(m.jump)).toEqual([1, 0, 0, 0, 0, 0])
    // Reversed order: the high comes first.
    const r = momentsOf(m1, avg, 1, 2, true)
    expect(Array.from(r.p).map((x) => Math.round(x * 100) / 100)).toEqual([
      100, 100.08, 100.17, 100.25, 100.15, 100.05, 99.95, 100.03, 100.12, 100.2,
    ])
    // A leg of zero length adds no moment: a candle that opens on its low and closes on its high.
    const flat = momentsOf([m1[0], c(60, 100, 100.1, 100, 100.1)], avg, 1, 2)
    expect(Array.from(flat.p).map((x) => Math.round(x * 100) / 100)).toEqual([100, 100.1])
  })
  it('inverted, the short average part flips: a dip below the lows while above the 34 average is a buy', () => {
    const m1 = [c(0, 100, 100, 100, 100), c(60, 100, 100, 99.8, 99.8)]
    const avg: Averages = {
      high: Float64Array.of(100.1, 0),
      low: Float64Array.of(99.95, 0),
      open: Float64Array.of(0, 99),
    }
    const m = momentsOf(m1, avg, 1, 2)
    expect(Array.from(m.sig)).toEqual(Array.from(m.sig).map(() => 0))
    expect(m.sigInv[m.n - 1]).toBe(1)
  })
  it('part B measures the move after each fresh signal, next to the move from every candle', () => {
    const m1 = [
      c(0, 100, 100, 100, 100),
      c(60, 100, 101, 100, 101), // close above both averages: fresh buy signal
      c(120, 101, 102, 101, 102), // still on: not fresh
      c(180, 102, 102, 101.5, 101.6),
      c(240, 101.6, 101.7, 101.5, 101.6),
      c(300, 101.6, 101.7, 101.5, 101.5),
      c(360, 101.5, 103, 101.5, 103),
    ]
    const avg = averages(m1)
    expect(signalAtClose(m1, avg, 1)).toBe(1)
    // The session is candles 1 and 2 and ends at 400: only the 5-minute move can be measured, and only from candle 1.
    const e = eveningMoves(m1, avg, 1, 3, 400)
    expect(e.buy.map((t) => t.n)).toEqual([1, 0, 0])
    expect(e.buy[0].sum).toBeCloseTo(103 - 101, 9)
    expect(e.sell.map((t) => t.n)).toEqual([0, 0, 0])
    expect(e.base.map((t) => t.n)).toEqual([1, 0, 0])
  })
})
