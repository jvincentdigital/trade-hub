import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { simulate, type LabEntry, type SimSetup } from './engine'
import { labMarket } from './markets'
import { newsWindows, parseNewsCsv } from './news'

// Wednesday 2026-07-01 00:00 UTC, 15-minute candles.
const T0 = Date.UTC(2026, 6, 1) / 1000
const bar = (i: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time: T0 + i * 900,
  open: o,
  high: h,
  low: l,
  close: c,
})
const flat = (n: number, p = 1.3) =>
  Array.from({ length: n }, (_, i) => bar(i, p, p + 0.0002, p - 0.0002, p))

const GBP = labMarket('GBPUSD') // spread 1 pip, slippage 0.2 pip, fee 0.0025% a side
const setup = (o: Partial<SimSetup> = {}): SimSetup => ({
  market: GBP,
  tf: '15m',
  style: 'swing',
  news: 'off',
  windows: [],
  ...o,
})
const long = (i: number, stop: number, target: number, o: Partial<LabEntry> = {}): LabEntry => ({
  i,
  kind: 'market',
  direction: 'long',
  stop,
  target,
  signalTime: 0,
  ...o,
})

describe('spread and slippage', () => {
  it('a buy at the open pays the ask plus slippage and sells back at the bid', () => {
    const c = flat(10)
    c[5] = bar(5, 1.3, 1.3025, 1.2999, 1.302)
    const [t] = simulate(c, [long(2, 1.29, 1.302)], setup())
    expect(t.entry).toBeCloseTo(1.3 + 0.0001 + 0.00002, 9)
    expect(t.exit).toBe(1.302) // target is a limit: no slippage
    expect(t.why).toBe('target')
    expect(t.feeRate).toBe(GBP.fee)
  })
  it('a short is stopped when the ASK reaches the stop', () => {
    const c = flat(10)
    // Bid high 1.30095 + 1 pip spread = 1.30105 >= stop 1.301
    c[4] = bar(4, 1.3, 1.30095, 1.2999, 1.3)
    const [t] = simulate(c, [{ ...long(2, 1.301, 1.29), direction: 'short' }], setup())
    expect(t.entry).toBeCloseTo(1.3 - 0.00002, 9)
    expect(t.why).toBe('stop')
    expect(t.exit).toBeCloseTo(1.301 + 0.00002, 9)
    // Without costs the same candle does not reach it.
    const [free] = simulate(
      c,
      [{ ...long(2, 1.301, 1.29), direction: 'short' }],
      setup({ costMult: 0 }),
    )
    expect(free.why).not.toBe('stop')
  })
  it('costs turn a flat trade into a loss of about 1.4 pips plus fees', () => {
    const c = flat(10)
    const [t] = simulate(c, [long(2, 1.29, 1.31)], setup({ style: 'race' }))
    // Exit at the last close (end of data) on the bid, minus slippage.
    expect(t.why).toBe('end')
    expect((t.exit - t.entry) / 0.0001).toBeCloseTo(-1.4, 6)
    expect(t.r).toBeLessThan(0)
  })
})

describe('backtest rules', () => {
  it('stop first when a candle touches both, gaps through the stop fill at the open', () => {
    const c = flat(10)
    c[3] = bar(3, 1.3, 1.31, 1.28, 1.3)
    expect(simulate(c, [long(2, 1.29, 1.305)], setup())[0].why).toBe('stop')
    const g = flat(10)
    g[3] = bar(3, 1.285, 1.286, 1.284, 1.285)
    const [t] = simulate(g, [long(2, 1.29, 1.305)], setup())
    expect(t.exit).toBeCloseTo(1.285 - 0.00002, 9)
  })
  it('a limit fill never reaches its target inside its own candle', () => {
    const c = flat(10)
    c[2] = bar(2, 1.3, 1.302, 1.299, 1.3)
    const [t] = simulate(
      c,
      [long(2, 1.295, 1.301, { kind: 'limit', price: 1.2995 })],
      setup({ style: 'race' }),
    )
    expect(t.entry).toBe(1.2995)
    expect(t.why).toBe('end')
  })
  it('half off at the first target, the rest at the second', () => {
    const c = flat(12)
    c[4] = bar(4, 1.3, 1.3051, 1.2999, 1.305)
    c[6] = bar(6, 1.305, 1.3101, 1.304, 1.31)
    const [t] = simulate(c, [long(2, 1.29, 1.31, { target1: 1.305, part1: 0.5 })], setup())
    expect(t.part1Hit).toBe(true)
    expect(t.exit).toBeCloseTo((1.305 + 1.31) / 2, 9)
    expect(t.why).toBe('target')
  })
  it('one position at a time', () => {
    const c = flat(20)
    const ts = simulate(c, [long(2, 1.29, 1.31), long(5, 1.29, 1.31)], setup({ style: 'race' }))
    expect(ts).toHaveLength(1)
  })
})

describe('styles', () => {
  it('a day trade is flat by 21:00 UTC', () => {
    const c = Array.from({ length: 96 }, (_, i) => bar(i, 1.3, 1.3002, 1.2998, 1.3))
    const [t] = simulate(c, [long(79, 1.29, 1.31)], setup({ style: 'day' })) // 19:45
    expect(t.why).toBe('time')
    expect(t.exitTime).toBe(T0 + 83 * 900) // the 20:45 candle, out at its close (21:00)
  })
  it('a scalp is out at the end of its session, and no day or scalp entries after 20:00 UTC', () => {
    const c = Array.from({ length: 96 }, (_, i) => bar(i, 1.3, 1.3002, 1.2998, 1.3))
    const [t] = simulate(c, [long(36, 1.29, 1.31)], setup({ style: 'scalp' })) // 09:00, London ends 13:00
    expect(t.exitTime).toBe(T0 + 51 * 900)
    expect(simulate(c, [long(81, 1.29, 1.31)], setup({ style: 'scalp' }))).toHaveLength(0)
  })
})

describe('news filter in the engine', () => {
  const ev = parseNewsCsv('time_utc,currency,event\n2026-07-01T12:30:00Z,USD,CPI m/m\n')
  const w = (mode: 'block' | 'close') => newsWindows(ev, GBP.currencies, mode)
  const c = Array.from({ length: 96 }, (_, i) => bar(i, 1.3, 1.3002, 1.2998, 1.3))
  it('block: no new trade from 12:00 to 13:00 UTC, an open trade stays', () => {
    expect(
      simulate(c, [long(48, 1.29, 1.31)], setup({ news: 'block', windows: w('block') })),
    ).toHaveLength(0) // 12:00
    expect(
      simulate(c, [long(52, 1.29, 1.31)], setup({ news: 'block', windows: w('block') })),
    ).toHaveLength(1) // 13:00
    const [kept] = simulate(
      c,
      [long(40, 1.29, 1.31)],
      setup({ style: 'day', news: 'block', windows: w('block') }),
    )
    expect(kept.why).toBe('time')
  })
  it('close: an open trade is closed at the open of the candle where the window starts', () => {
    const [t] = simulate(
      c,
      [long(40, 1.29, 1.31)],
      setup({ style: 'day', news: 'close', windows: w('close') }),
    )
    expect(t.why).toBe('news')
    expect(t.exitTime).toBe(T0 + 48 * 900)
  })
})
