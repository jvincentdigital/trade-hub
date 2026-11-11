import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { fibLevel, impulseAt, johnsFib, JOHN_FIB_LEVELS, STOP_PAD_ATR } from './fib'

const bar = (i: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time: 1_762_819_200 + i * 900,
  open: o,
  high: h,
  low: l,
  close: c,
})

/** 20 quiet candles around 100 (range 1, so ATR is 1), then a drop of 6. */
function dropSeries(): OHLCCandle[] {
  const c: OHLCCandle[] = []
  for (let i = 0; i < 20; i++) c.push(bar(i, 100, 100.5, 99.5, 100 + (i % 2 ? 0.2 : -0.2)))
  c.push(bar(20, 100, 101, 99.8, 100.8)) // last bullish candle: its high (101) is "1"
  c.push(bar(21, 100.8, 100.9, 98, 98.2))
  c.push(bar(22, 98.2, 98.3, 96, 96.1))
  c.push(bar(23, 96.1, 96.2, 95, 95.2)) // bottom of the drop: "0" = 95
  return c
}
const flatAtr = (n: number) => Array<number>(n).fill(1)

describe("John's Fib levels", () => {
  it("matches John's USD/JPY example (1 = 163.738, 0 = 152.846)", () => {
    expect(fibLevel(163.738, 152.846, 0.786)).toBeCloseTo(161.407, 3)
    expect(fibLevel(163.738, 152.846, 0.886)).toBeCloseTo(162.496, 3)
    expect(fibLevel(163.738, 152.846, -0.272)).toBeCloseTo(149.883, 3)
    expect(fibLevel(163.738, 152.846, 0)).toBe(152.846)
    expect(fibLevel(163.738, 152.846, 1)).toBeCloseTo(163.738, 9)
  })
  it('mirrors for a buy (1 at the bottom, 0 at the top)', () => {
    // John's second USD/JPY chart: 1 = 153.174, 0 = 159.032
    expect(fibLevel(153.174, 159.032, 0.786)).toBeCloseTo(154.428, 2)
    expect(fibLevel(153.174, 159.032, -0.272)).toBeCloseTo(160.625, 2)
  })
  it('keeps his level list', () => {
    expect(JOHN_FIB_LEVELS).toContain(0.886)
    expect(JOHN_FIB_LEVELS).not.toContain(0.236)
  })
})

describe('impulse detection', () => {
  it('anchors 1 at the top of the last bullish candle and 0 at the low, when the drop is k x ATR', () => {
    const c = dropSeries()
    const imp = impulseAt(c, flatAtr(c.length), 23, 'down', 3)
    expect(imp).toMatchObject({ direction: 'down', one: 101, zero: 95, oneIdx: 20, zeroIdx: 23 })
  })
  it('uses the last bullish candle right before the drop, not an older higher swing', () => {
    const c = dropSeries()
    c[15] = bar(15, 100, 101.2, 99.9, 101.1) // older, higher bullish candle
    const imp = impulseAt(c, flatAtr(c.length), 23, 'down', 3)
    expect(imp).toMatchObject({ one: 101, oneIdx: 20 })
  })
  it('skips a small bounce inside the drop when the move from it is too small', () => {
    const c = dropSeries()
    c[22] = bar(22, 98.2, 98.8, 98.1, 98.6) // bullish pause, 3.8 above the low
    const imp = impulseAt(c, flatAtr(c.length), 23, 'down', 4)
    expect(imp).toMatchObject({ one: 101, oneIdx: 20, zero: 95 })
  })
  it('needs the move to be big enough', () => {
    const c = dropSeries()
    expect(impulseAt(c, flatAtr(c.length), 23, 'down', 7)).toBeNull()
  })
  it('only fires on the candle that sets the new extreme', () => {
    const c = dropSeries()
    expect(impulseAt(c, flatAtr(c.length), 22, 'down', 3)).not.toBeNull()
    c.push(bar(24, 95.2, 95.6, 95.1, 95.5)) // no new low
    expect(impulseAt(c, flatAtr(c.length), 24, 'down', 3)).toBeNull()
  })
  it('finds the buy mirror', () => {
    const c = dropSeries().map((b) => ({
      ...b,
      open: 200 - b.open,
      high: 200 - b.low,
      low: 200 - b.high,
      close: 200 - b.close,
    }))
    const imp = impulseAt(c, flatAtr(c.length), 23, 'up', 3)
    expect(imp).toMatchObject({ direction: 'up', one: 99, zero: 105 })
  })
})

describe('johnsFib entries', () => {
  it('sells the pullback at 0.786 with a limit, stop past 1, half off at 0, rest at -0.272', () => {
    const c = dropSeries()
    c.push(bar(24, 95.2, 96.5, 95.1, 96.4))
    c.push(bar(25, 96.4, 99.9, 96.3, 99.5)) // reaches 0.786 = 95 + 0.786 * 6 = 99.716
    const e = johnsFib(c, { k: 3, entry: 0.786, atr: flatAtr(c.length) })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({
      i: 25,
      kind: 'limit',
      direction: 'short',
      target1: 95,
      part1: 0.5,
    })
    expect(e[0].price).toBeCloseTo(99.716, 6)
    expect(e[0].stop).toBeCloseTo(101 + STOP_PAD_ATR, 9)
    expect(e[0].target).toBeCloseTo(95 - 0.272 * 6, 9)
  })
  it('a new low moves 0 down, and a trade past 1 cancels the setup', () => {
    const c = dropSeries()
    c.push(bar(24, 95.2, 95.3, 94, 94.2)) // new low: 0 = 94
    c.push(bar(25, 94.2, 99.5, 94.1, 99.4)) // 0.786 of 101..94 = 99.502: not reached
    c.push(bar(26, 99.4, 101.5, 99, 101.2)) // past 1 first? the limit at 99.502 fills on this candle
    const e = johnsFib(c, { k: 3, entry: 0.786, atr: flatAtr(c.length) })
    expect(e).toHaveLength(1)
    expect(e[0].i).toBe(26)
    expect(e[0].price).toBeCloseTo(94 + 0.786 * 7, 6)
    // That candle also went past 1: no second entry from the same setup.
    c.push(bar(27, 101.2, 101.3, 99, 99.2))
    expect(johnsFib(c, { k: 3, entry: 0.786, atr: flatAtr(c.length) })).toHaveLength(1)
  })
  it('with confirmation, waits for a reversal candle in the zone and enters at the next open', () => {
    const c = dropSeries()
    c.push(bar(24, 95.2, 96.5, 95.1, 96.4))
    c.push(bar(25, 96.4, 99.8, 96.3, 99.6))
    c.push(bar(26, 99.6, 99.9, 98.4, 98.5))
    c.push(bar(27, 98.5, 98.6, 97, 97.2))
    const conf = new Int8Array(c.length)
    conf[26] = -1 // bearish candle on 26
    const e = johnsFib(c, {
      k: 3,
      entry: 0.786,
      confirm: true,
      confirmations: conf,
      atr: flatAtr(c.length),
    })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ i: 27, kind: 'market', direction: 'short' })
  })
  it('a buy limit fills only when the ask reaches it', () => {
    const c = dropSeries().map((b) => ({
      ...b,
      open: 200 - b.open,
      high: 200 - b.low,
      low: 200 - b.high,
      close: 200 - b.close,
    }))
    // Buy level 0.786 = 105 - 0.786 * 6 = 100.284; the bid low reaches 100.25,
    // so the ask only gets there with a spread under 0.034.
    c.push(bar(24, 104.8, 104.9, 103.5, 103.6))
    c.push(bar(25, 103.6, 103.7, 100.25, 100.5))
    expect(johnsFib(c, { k: 3, entry: 0.786, atr: flatAtr(c.length) })).toHaveLength(1)
    expect(
      johnsFib(c, { k: 3, entry: 0.786, atr: flatAtr(c.length), spreadOf: () => 0.05 }),
    ).toHaveLength(0)
  })
})
