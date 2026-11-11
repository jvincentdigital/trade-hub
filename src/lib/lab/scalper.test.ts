import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { bbWidth, rangeBefore, scalper, squeezeRank } from './scalper'

const bar = (i: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time: i * 300,
  open: o,
  high: h,
  low: l,
  close: c,
})

/** 220 wide candles, then a tight range 99.9-100.1. */
function series(): OHLCCandle[] {
  const c: OHLCCandle[] = []
  for (let i = 0; i < 220; i++) {
    const m = 100 + (i % 2 ? 1 : -1)
    c.push(bar(i, m, m + 0.5, m - 0.5, i % 2 ? m - 0.2 : m + 0.2))
  }
  for (let i = 220; i < 260; i++) c.push(bar(i, 100, 100.1, 99.9, i % 2 ? 100.05 : 99.95))
  return c
}

describe('range detection', () => {
  it('reads the range of the 20 candles before', () => {
    expect(rangeBefore(series(), 250)).toEqual({ high: 100.1, low: 99.9 })
    expect(rangeBefore(series(), 5)).toBeNull()
  })
  it('Bollinger width falls in the quiet part, and the squeeze rank shows it', () => {
    const c = series()
    const w = bbWidth(c)
    expect(w[250]).toBeLessThan(w[200] / 5)
    const rank = squeezeRank(w)
    expect(rank[250]).toBeLessThan(0.2)
  })
})

describe('scalper', () => {
  it('buys a reversal candle at the bottom edge, stop just past it, target the middle', () => {
    const c = series()
    c.push(bar(260, 99.95, 99.97, 99.88, 99.92)) // touches the bottom zone, closes back inside
    c.push(bar(261, 99.94, 100, 99.93, 99.99))
    const conf = new Int8Array(c.length)
    conf[260] = 1
    const atr = Array<number>(c.length).fill(0.04)
    const e = scalper(c, { far: 0, squeeze: 0.2, confirmations: conf, atr })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ i: 261, direction: 'long', kind: 'market' })
    expect(e[0].stop).toBeCloseTo(99.88 - 0.25 * 0.04, 9)
    expect(e[0].target).toBeCloseTo(100, 9)
    const far = scalper(c, { far: 1, squeeze: 0.2, confirmations: conf, atr })
    expect(far[0].target).toBeCloseTo(99.9 + 0.9 * 0.2, 9)
  })
  it('stops fading after a breakout', () => {
    const c = series()
    c.push(bar(260, 100.05, 100.4, 100.04, 100.35)) // closes 0.25 over the range: breakout
    c.push(bar(261, 100.3, 100.31, 100.0, 100.02))
    c.push(bar(262, 100.02, 100.03, 99.98, 100.0))
    const conf = new Int8Array(c.length).fill(1)
    const atr = Array<number>(c.length).fill(0.04)
    const e = scalper(c, { far: 0, squeeze: 1, confirmations: conf, atr })
    expect(e.filter((x) => x.i > 260 && x.i <= 281)).toHaveLength(0)
  })
  it('needs a squeeze and a reversal candle', () => {
    const c = series()
    c.push(bar(260, 99.95, 99.97, 99.88, 99.92))
    c.push(bar(261, 99.94, 100, 99.93, 99.99))
    const conf = new Int8Array(c.length)
    const atr = Array<number>(c.length).fill(0.04)
    expect(scalper(c, { far: 0, squeeze: 0.2, confirmations: conf, atr })).toHaveLength(0)
    conf[260] = 1
    expect(scalper(c, { far: 0, squeeze: 0, confirmations: conf, atr })).toHaveLength(0)
  })
})
