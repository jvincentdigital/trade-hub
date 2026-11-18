import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import { mulberry32 } from './harmonicStudy'
import { drawAt, MIRROR_FROM, mirrorMinutes, turned } from './levelsMirror'

const bars = (rows: [number, number, number, number, number][]): Bars => ({
  n: rows.length,
  time: Float64Array.from(rows, (r) => r[0]),
  open: Float64Array.from(rows, (r) => r[1]),
  high: Float64Array.from(rows, (r) => r[2]),
  low: Float64Array.from(rows, (r) => r[3]),
  close: Float64Array.from(rows, (r) => r[4]),
})

describe('drawAt', () => {
  it('equals stepping mulberry32, for several seeds and k up to 5,000', () => {
    for (const seed of [1, 2, 5, 10, 99, 123_456_789, 0xffffffff]) {
      const g = mulberry32(seed)
      for (let k = 0; k < 5000; k++) expect(drawAt(seed, k)).toBe(g())
    }
  })

  it('equals stepping mulberry32 above 14,000,000 draws (the clock minutes up to 2026)', () => {
    const g = mulberry32(3)
    const k = 14_000_123
    for (let i = 0; i < k; i++) g()
    expect(drawAt(3, k)).toBe(g())
    expect(drawAt(3, k + 1)).toBe(g())
  })
})

describe('mirrorMinutes (Amendment 1, A)', () => {
  // Seed 5 from 2010-01-04 00:15 UTC: stepping mulberry32(5) to these clock
  // minutes gives draws 0.572 (kept), 0.247 (turned), 0.172 (no candle in the
  // file), 0.261 (turned), 0.543 (kept).
  const t0 = 1_262_564_100
  it('decides by the draw of each clock minute, a gap minute included', () => {
    expect([0, 1, 2, 3, 4].map((i) => turned(5, t0 + 60 * i))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })

  it('works a four-minute example with a gap, both wicks, kept and turned minutes', () => {
    const m = mirrorMinutes(
      bars([
        [t0, 100, 102, 99, 101],
        [t0 + 60, 101, 101.5, 100, 100.5],
        [t0 + 180, 100.8, 101, 100, 100.2],
        [t0 + 240, 100.2, 100.5, 100.1, 100.4],
      ]),
      5,
    )
    const near = (a: ArrayLike<number>, b: number[]) =>
      b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, 10))
    // Minute 1, kept, the first of the file (p = P = its open 100): the same prices.
    // Minute 2, turned, p = 101, P = 101: O = 101 x 101 / 101 = 101; C = 101 x 101 / 100.5;
    // H = C x 100.5 / 100 = 10201 / 100 = 102.01 (the lower wick becomes the upper);
    // L = O x 101 / 101.5 (the upper wick becomes the lower).
    // Minute 3, turned after the gap: p = 100.5 (the real close before it), P = 10201 / 100.5:
    // O = P x 100.5 / 100.8 = 10201 / 100.8; C = O x 100.8 / 100.2 = 10201 / 100.2;
    // H = C x 100.2 / 100 = 102.01; L = O x 100.8 / 101 = 10201 / 101 = 101.
    // Minute 4, kept: p = 100.2, P = 10201 / 100.2: O = P x 100.2 / 100.2 = P;
    // C = O x 100.4 / 100.2; H = C x 100.5 / 100.4; L = O x 100.1 / 100.2.
    const O4 = 10201 / 100.2
    near(m.open, [100, 101, 10201 / 100.8, O4])
    near(m.close, [101, 10201 / 100.5, 10201 / 100.2, (O4 * 100.4) / 100.2])
    near(m.high, [102, 102.01, 102.01, (O4 * 100.5) / 100.2])
    near(m.low, [99, 10201 / 101.5, 101, (O4 * 100.1) / 100.2])
    expect(Array.from(m.time)).toEqual([t0, t0 + 60, t0 + 180, t0 + 240])
  })

  it('keeps H at or above max(O, C) and L at or below min(O, C), exactly', () => {
    const g = mulberry32(17)
    const rows: [number, number, number, number, number][] = []
    let c = 1.1
    for (let i = 0; i < 20_000; i++) {
      const o = c * (1 + (g() - 0.5) * 1e-3)
      c = o * (1 + (g() - 0.5) * 2e-3)
      // A quarter of the minutes have no upper wick, a quarter no lower wick.
      const h = g() < 0.25 ? Math.max(o, c) : Math.max(o, c) * (1 + g() * 1e-3)
      const l = g() < 0.25 ? Math.min(o, c) : Math.min(o, c) * (1 - g() * 1e-3)
      rows.push([MIRROR_FROM + 600_000 * 60 + 60 * i, o, h, l, c])
    }
    for (const seed of [1, 2]) {
      const m = mirrorMinutes(bars(rows), seed)
      for (let i = 0; i < m.n; i++) {
        expect(m.high[i] >= Math.max(m.open[i], m.close[i])).toBe(true)
        expect(m.low[i] <= Math.min(m.open[i], m.close[i])).toBe(true)
      }
    }
  })

  it('gives two markets with different missing minutes the same decision in every shared clock minute', () => {
    const start = 1_300_000_020 // a whole minute: (start - 2000-01-01) / 60 is an integer
    expect((start - MIRROR_FROM) % 60).toBe(0)
    const make = (skip: (i: number) => boolean) => {
      const rows: [number, number, number, number, number][] = []
      for (let i = 0; i < 300; i++)
        if (!skip(i)) rows.push([start + 60 * i, 1.2, 1.25, 1.15, 1.22 + (i % 7) * 0.001])
      return bars(rows)
    }
    const a = make((i) => i % 3 === 0)
    const b = make((i) => i % 5 === 1 || i > 250)
    // Kept: C / O = c / o; turned: C / O = o / c (c differs from o in every minute here).
    const decisions = (src: Bars) => {
      const m = mirrorMinutes(src, 4)
      const out = new Map<number, boolean>()
      for (let i = 0; i < m.n; i++) {
        const kept = Math.abs(m.close[i] / m.open[i] - src.close[i] / src.open[i]) < 1e-12
        out.set(src.time[i], !kept)
      }
      return out
    }
    const da = decisions(a)
    const db = decisions(b)
    let shared = 0
    for (const [t, x] of da)
      if (db.has(t)) {
        shared++
        expect(db.get(t)).toBe(x)
      }
    expect(shared).toBeGreaterThan(100)
    expect(new Set(da.values()).size).toBe(2)
  })

  it('differs between seed 1 and seed 2', () => {
    const t = Array.from({ length: 64 }, (_, i) => 1_262_563_200 + 60 * i)
    expect(t.map((x) => turned(1, x))).not.toEqual(t.map((x) => turned(2, x)))
  })

  it('stops on a stamp that is not a whole minute', () => {
    expect(() => mirrorMinutes(bars([[1_262_563_230, 1, 1, 1, 1]]), 1)).toThrow(/whole minute/)
    expect(() => turned(1, MIRROR_FROM - 60)).toThrow(/whole minute/)
  })
})
