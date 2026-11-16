import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { seeded } from './control'
import { johnsFib } from './fib'
import { anchorImpulse, planFib, type PlanOptions } from './fibAnchors'

const bar = (i: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time: 1_762_819_200 + i * 900,
  open: o,
  high: h,
  low: l,
  close: c,
})
const flatAtr = (n: number) => Array<number>(n).fill(1)
const flip = (c: OHLCCandle[]) =>
  c.map((b) => ({
    ...b,
    open: 200 - b.open,
    high: 200 - b.low,
    low: 200 - b.high,
    close: 200 - b.close,
  }))

/**
 * Quiet candles (ATR 1), a swing high of 102, a small down candle, a last up
 * candle (high 101.7), the first big down candle (open 101.6, high 101.65), a
 * bounce (high 99.5) and the low of 95.
 */
function drop(): OHLCCandle[] {
  const c: OHLCCandle[] = []
  for (let i = 0; i < 20; i++) c.push(bar(i, 100, 100.5, 99.5, 100 + (i % 2 ? 0.2 : -0.2)))
  c.push(bar(20, 100, 102, 99.9, 101.8)) // swing high
  c.push(bar(21, 101.8, 101.9, 101.3, 101.5)) // small down candle (body 0.3)
  c.push(bar(22, 101.5, 101.7, 101.4, 101.6)) // last up candle before the drop
  c.push(bar(23, 101.6, 101.65, 98, 98.2)) // first big candle of the drop
  c.push(bar(24, 98.2, 99.5, 98.1, 99.3)) // bounce inside the drop
  c.push(bar(25, 99.3, 99.4, 95, 95.2)) // the low: 0 = 95
  return c
}

describe('the five anchors on one drop', () => {
  const c = drop()
  const at = (a: 'A' | 'B' | 'C' | 'D' | 'E') =>
    anchorImpulse(c, flatAtr(c.length), 25, 'down', 3, 12, a)
  it('A (lab rule) takes the bounce inside the drop', () => {
    expect(at('A')).toMatchObject({ one: 99.5, zero: 95, oneIdx: 24 })
  })
  it('B takes the high of the last up candle before the first big candle', () => {
    expect(at('B')).toMatchObject({ one: 101.7, zero: 95, oneIdx: 22 })
  })
  it('C takes the high of the first big candle of the drop', () => {
    expect(at('C')).toMatchObject({ one: 101.65, zero: 95, oneIdx: 23 })
  })
  it('D takes the swing high', () => {
    expect(at('D')).toMatchObject({ one: 102, zero: 95, oneIdx: 20 })
  })
  it('E takes the open of the first big candle of the drop', () => {
    expect(at('E')).toMatchObject({ one: 101.6, zero: 95, oneIdx: 23 })
  })
  it('keeps 0 and the size test the same for every anchor', () => {
    for (const a of ['A', 'B', 'C', 'D', 'E'] as const) {
      expect(at(a)?.zero).toBe(95)
      expect(anchorImpulse(c, flatAtr(c.length), 25, 'down', 8, 12, a)).toBeNull()
      expect(anchorImpulse(c, flatAtr(c.length), 24, 'down', 3, 12, a)).toBeNull() // not a new low
    }
  })
  it('mirrors for a buy', () => {
    const u = flip(c)
    const up = (a: 'B' | 'C' | 'D' | 'E') => anchorImpulse(u, flatAtr(u.length), 25, 'up', 3, 12, a)
    expect(up('B')).toMatchObject({ one: 98.3, zero: 105 })
    expect(up('C')?.one).toBeCloseTo(98.35, 9)
    expect(up('D')).toMatchObject({ one: 98, zero: 105 })
    expect(up('E')).toMatchObject({ one: 98.4, zero: 105 })
  })
  it('B, C and E need a big candle in the move', () => {
    const q = drop()
    q[23] = bar(23, 101.6, 101.65, 101.0, 101.1) // body 0.5
    q[24] = bar(24, 101.1, 101.2, 100.5, 100.6) // body 0.5
    q[25] = bar(25, 100.6, 100.7, 95, 100.1) // long wick, body 0.5
    expect(anchorImpulse(q, flatAtr(q.length), 25, 'down', 3, 12, 'E')).toBeNull()
    expect(anchorImpulse(q, flatAtr(q.length), 25, 'down', 3, 12, 'D')).not.toBeNull()
  })
})

const opts = (o: Partial<PlanOptions>): PlanOptions => ({
  anchor: 'E',
  k: 3,
  bars: 12,
  expiry: 24,
  entry: 'R786',
  exit: 'XJ',
  setupSec: 900,
  atrSetup: undefined,
  atrEntry: undefined,
  ...o,
})

describe('planFib entries', () => {
  // Anchor E: 1 = 101.6, 0 = 95, range 6.6. 0.786 = 100.1876, 0.886 = 100.8476, stop 101.85.
  const withPullback = (...more: OHLCCandle[]) => {
    const c = [...drop(), ...more]
    return { c, atr: flatAtr(c.length) }
  }
  it('R786: a resting sell at 0.786, stop past 1, half off at 0, rest at -0.272', () => {
    const { c, atr } = withPullback(bar(26, 95.2, 100.5, 95.1, 100.2))
    const p = planFib(c, c, opts({ atrSetup: atr, atrEntry: atr }))
    expect(p).toHaveLength(1)
    expect(p[0].entry).toMatchObject({ i: 26, kind: 'limit', direction: 'short', target1: 95 })
    expect(p[0].entry.price).toBeCloseTo(100.1876, 6)
    expect(p[0].entry.stop).toBeCloseTo(101.85, 9)
    expect(p[0].entry.target).toBeCloseTo(95 - 0.272 * 6.6, 9)
  })
  it('X2R: one target at twice the risk', () => {
    const { c, atr } = withPullback(bar(26, 95.2, 100.5, 95.1, 100.2))
    const p = planFib(c, c, opts({ exit: 'X2R', atrSetup: atr, atrEntry: atr }))
    expect(p[0].entry.target1).toBeUndefined()
    expect(p[0].entry.target).toBeCloseTo(100.1876 - 2 * (101.85 - 100.1876), 6)
  })
  it('HALVES: one leg when only 0.786 is reached, two when 0.886 is too, one shared stop', () => {
    const one = withPullback(bar(26, 95.2, 100.5, 95.1, 100.2), bar(27, 100.2, 100.3, 94.9, 95))
    const p1 = planFib(
      one.c,
      one.c,
      opts({ entry: 'HALVES', atrSetup: one.atr, atrEntry: one.atr }),
    )
    expect(p1).toHaveLength(1)
    const two = withPullback(bar(26, 95.2, 100.5, 95.1, 100.2), bar(27, 100.2, 101, 100.1, 100.4))
    const p2 = planFib(
      two.c,
      two.c,
      opts({ entry: 'HALVES', atrSetup: two.atr, atrEntry: two.atr }),
    )
    expect(p2).toHaveLength(2)
    expect(p2[0].setup).toBe(p2[1].setup)
    expect(p2[1].entry.price).toBeCloseTo(100.8476, 6)
    expect(p2[0].entry.stop).toBe(p2[1].entry.stop)
    expect(p2[0].total).toBeCloseTo(101.85 - 100.1876 + (101.85 - 100.8476), 6)
    expect(p2[0].dist + p2[1].dist).toBeCloseTo(p2[0].total, 9)
  })
  it('CONF2: waits for two strong candles after the touch, then sells at the next open', () => {
    const { c, atr } = withPullback(
      bar(26, 95.2, 100.5, 95.1, 100.2), // touch
      bar(27, 100.2, 100.3, 99.4, 99.5), // strong down (0.7)
      bar(28, 99.5, 99.6, 98.8, 98.9), // strong down (0.6)
      bar(29, 98.9, 99, 98, 98.1),
    )
    const p = planFib(c, c, opts({ entry: 'CONF2', atrSetup: atr, atrEntry: atr }))
    expect(p).toHaveLength(1)
    expect(p[0].entry).toMatchObject({ i: 29, kind: 'market', direction: 'short', target1: 95 })
    const weak = withPullback(
      bar(26, 95.2, 100.5, 95.1, 100.2),
      bar(27, 100.2, 100.3, 99.9, 100), // weak (0.2)
      bar(28, 100, 100.1, 99.3, 99.4),
      bar(29, 99.4, 99.5, 99.3, 99.45),
    )
    expect(
      planFib(weak.c, weak.c, opts({ entry: 'CONF2', atrSetup: weak.atr, atrEntry: weak.atr })),
    ).toHaveLength(0)
  })
  it('CONT: a close beyond 0.786 buys the next open, stop his distance below, targets mirrored', () => {
    const { c, atr } = withPullback(
      bar(26, 95.2, 100.5, 95.1, 100.3),
      bar(27, 100.4, 100.6, 100.2, 100.5),
    )
    const p = planFib(c, c, opts({ entry: 'CONT', atrSetup: atr, atrEntry: atr }))
    expect(p).toHaveLength(1)
    const d = 101.85 - 100.1876
    expect(p[0].entry).toMatchObject({ i: 27, kind: 'market', direction: 'long' })
    expect(p[0].entry.stop).toBeCloseTo(100.4 - d, 6)
    expect(p[0].entry.target1).toBeCloseTo(100.4 + (100.1876 - 95), 6)
    // A wick through 0.786 that closes back under it is not a continuation.
    const wick = withPullback(bar(26, 95.2, 100.5, 95.1, 99.8))
    expect(
      planFib(wick.c, wick.c, opts({ entry: 'CONT', atrSetup: wick.atr, atrEntry: wick.atr })),
    ).toHaveLength(0)
  })
  it('reads entries on a smaller chart: nothing fills before the Fib-chart candle has closed', () => {
    const big = drop()
    // Two 450 s entry candles per Fib candle; the pullback comes after the low candle closed.
    const small: OHLCCandle[] = []
    for (const b of big) {
      small.push({ ...b, time: b.time })
      small.push({ time: b.time + 450, open: b.close, high: b.close, low: b.close, close: b.close })
    }
    const t = big[25].time + 900
    small.push({ time: t, open: 95.2, high: 100.5, low: 95.1, close: 100.2 })
    const p = planFib(
      big,
      small,
      opts({ atrSetup: flatAtr(big.length), atrEntry: flatAtr(small.length) }),
    )
    expect(p).toHaveLength(1)
    expect(small[p[0].entry.i].time).toBe(t)
  })
  it('on one chart, anchor A with a single level is exactly the lab bot', () => {
    const rnd = seeded(11)
    const c: OHLCCandle[] = []
    let px = 100
    for (let i = 0; i < 4000; i++) {
      const o = px
      const cl = o + (rnd() - 0.5) * 0.8
      const h = Math.max(o, cl) + rnd() * 0.3
      const l = Math.min(o, cl) - rnd() * 0.3
      c.push(bar(i, o, h, l, cl))
      px = cl
    }
    for (const [entry, lvl] of [
      ['R786', 0.786],
      ['R886', 0.886],
    ] as const) {
      const lab = johnsFib(c, { k: 3, entry: lvl, spreadOf: () => 0.01 })
      const mine = planFib(c, c, opts({ anchor: 'A', entry, spreadOf: () => 0.01 })).map(
        (p) => p.entry,
      )
      expect(lab.length).toBeGreaterThan(20)
      expect(mine).toEqual(lab)
    }
  })
})

// John's drawn examples on the real candles (all inside the tune period).
// Skipped where the history folder is missing (CI).
describe("John's drawn anchors on real candles", async () => {
  const { existsSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const { historyFile, loadMarket } = await import('./load')
  const { atrSeries } = await import('../race/londonBreakout')
  const dir = process.env.LAB_HISTORY ?? join(homedir(), 'jvd-outputs/trading/history-majors')
  const have =
    existsSync(historyFile(dir, 'USDJPY', '1h')) && existsSync(historyFile(dir, 'GBPUSD', '1h'))
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16)
  const load = async (m: 'USDJPY' | 'GBPUSD', tf: '1d' | '4h', stamp: string) => {
    const c = await loadMarket(dir, m, tf)
    return { c, atr: atrSeries(c, 14), j: c.findIndex((b) => iso(b.time) === stamp) }
  }
  it.skipIf(!have)(
    'USD/JPY daily sell (he drew 1 = 163.738, 0 = 152.846): C is his line',
    async () => {
      const { c, atr, j } = await load('USDJPY', '1d', '2026-09-07T21:00')
      const one = (a: 'A' | 'B' | 'C' | 'D' | 'E', bars: number) =>
        anchorImpulse(c, atr, j, 'down', 4, bars, a)
      expect(one('C', 40)).toMatchObject({ one: 163.738, zero: 152.889 })
      expect(iso(c[one('C', 40)!.oneIdx].time)).toBe('2026-07-29T21:00')
      expect(one('E', 40)?.one).toBe(163.383) // the same candle's open
      expect(one('B', 40)?.one).toBe(163.948) // last up candle before it
      expect(one('D', 40)?.one).toBe(163.989) // swing high, 07-23
      expect(one('A', 40)?.one).toBe(160.273) // the lab rule stops at the 09-01 bounce
      expect(one('A', 12)?.one).toBe(160.273)
    },
  )
  it.skipIf(!have)(
    'USD/JPY daily buy (he drew 1 = 153.174, 0 = 159.032): every anchor is close',
    async () => {
      const { c, atr, j } = await load('USDJPY', '1d', '2026-09-23T21:00')
      const one = (a: 'A' | 'C' | 'D' | 'E', bars: number) =>
        anchorImpulse(c, atr, j, 'up', 3, bars, a)
      expect(one('A', 12)).toMatchObject({ one: 153.24, zero: 159.034 })
      // In a 40-candle window the July highs are still above 159, so only the 12-candle window sees this buy.
      expect(one('D', 40)).toBeNull()
      expect(one('C', 12)?.one).toBe(153.281)
      expect(one('E', 12)?.one).toBe(153.447)
      expect(one('D', 12)?.one).toBe(152.939)
    },
  )
  it.skipIf(!have)(
    'GBP/USD 4-hour sell from his recording (1 = 1.3488, the open, not the 1.3505 wick): E is his line',
    async () => {
      const { c, atr } = await load('GBPUSD', '4h', '2026-11-05T06:00')
      // His 0 (1.3250) printed after this data ends; the last new low on file is 11-10 14:00 UTC.
      const j = c.findIndex((b) => iso(b.time) === '2026-11-10T14:00')
      const e = anchorImpulse(c, atr, j, 'down', 3, 40, 'E')
      expect(e?.one).toBe(1.34887)
      expect(iso(c[e!.oneIdx].time)).toBe('2026-11-05T06:00')
      expect(anchorImpulse(c, atr, j, 'down', 3, 40, 'C')?.one).toBe(1.35007) // its wick
    },
  )
})
