import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import {
  atrInForce,
  buildDays,
  buildFourHours,
  buildWeeks,
  dayClose,
  dayNameOf,
  dayStart,
  fifteenthDay,
  nearRound,
  nyClockBucket,
  roundDistance,
  roundGrid,
} from './levelsClock'
import { MinuteIndex } from './levelsIndex'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 1000
const epochDay = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d) / 86_400_000

type Row = [number, number, number, number, number]
const bars = (rows: Row[]): Bars => {
  const col = (k: number) => Float64Array.from(rows.map((r) => r[k]))
  return { n: rows.length, time: col(0), open: col(1), high: col(2), low: col(3), close: col(4) }
}

describe('days and weeks', () => {
  it('a day runs 17:00 to 17:00 New York time; the weekend stub joins Monday', () => {
    // Winter: New York is UTC-5. Friday 2015-01-09 16:59 NY is 21:59 UTC.
    expect(dayNameOf(utc(2015, 1, 9, 21, 59))).toBe(epochDay(2015, 1, 9))
    // Friday 17:00 NY, Saturday, and Sunday 16:59 NY belong to Monday's day.
    expect(dayNameOf(utc(2015, 1, 9, 22, 0))).toBe(epochDay(2015, 1, 12))
    expect(dayNameOf(utc(2015, 1, 10, 12, 0))).toBe(epochDay(2015, 1, 12))
    expect(dayNameOf(utc(2015, 1, 11, 21, 59))).toBe(epochDay(2015, 1, 12))
    // Sunday 18:00 NY (23:00 UTC) too, and Monday 16:59 NY; Monday 17:00 NY is Tuesday's.
    expect(dayNameOf(utc(2015, 1, 11, 23, 0))).toBe(epochDay(2015, 1, 12))
    expect(dayNameOf(utc(2015, 1, 12, 21, 59))).toBe(epochDay(2015, 1, 12))
    expect(dayNameOf(utc(2015, 1, 12, 22, 0))).toBe(epochDay(2015, 1, 13))
    // Summer: New York is UTC-4, so a day ends at 21:00 UTC.
    expect(dayNameOf(utc(2015, 7, 7, 20, 59))).toBe(epochDay(2015, 7, 7))
    expect(dayNameOf(utc(2015, 7, 7, 21, 0))).toBe(epochDay(2015, 7, 8))
    expect(dayClose(epochDay(2015, 1, 12))).toBe(utc(2015, 1, 12, 22))
    expect(dayStart(epochDay(2015, 1, 12))).toBe(utc(2015, 1, 9, 22))
    expect(dayStart(epochDay(2015, 1, 13))).toBe(utc(2015, 1, 12, 22))
  })

  it('builds the Monday day from the weekend stub and Monday, with its clock times', () => {
    const d = buildDays(
      bars([
        [utc(2015, 1, 9, 21, 59), 100, 101, 99, 100],
        [utc(2015, 1, 9, 22, 0), 100, 105, 100, 104],
        [utc(2015, 1, 11, 23, 0), 103, 104, 98, 99],
        [utc(2015, 1, 12, 15, 0), 99, 100, 99, 99.5],
      ]),
    )
    expect(d.n).toBe(2)
    expect(Array.from(d.first)).toEqual([0, 1])
    expect(Array.from(d.end)).toEqual([1, 4])
    expect([d.high[1], d.low[1], d.close[1]]).toEqual([105, 98, 99.5])
    expect(d.start[1]).toBe(utc(2015, 1, 9, 22))
    expect(d.stop[1]).toBe(utc(2015, 1, 12, 22))
    // True range: the first candle uses its high minus its low; then the previous close counts.
    expect(d.tr[0]).toBe(2)
    expect(d.tr[1]).toBe(105 - 98)
  })

  it('a week is the days named Monday to Friday of one calendar week', () => {
    const d = buildDays(
      bars([
        [utc(2015, 1, 9, 17), 100, 101, 99, 100], // Friday the 9th
        [utc(2015, 1, 10, 12), 100, 102, 100, 101], // Saturday: Monday the 12th, a new week
        [utc(2015, 1, 16, 17), 100, 103, 97, 100], // Friday the 16th
        [utc(2015, 1, 16, 23), 100, 100, 100, 100], // Friday 18:00 NY: Monday the 19th
      ]),
    )
    const w = buildWeeks(d)
    expect(w.n).toBe(3)
    expect(Array.from(w.firstDay)).toEqual([0, 1, 3])
    expect(Array.from(w.lastDay)).toEqual([0, 2, 3])
    expect([w.high[1], w.low[1]]).toEqual([103, 97])
  })
})

describe('the ATR in force', () => {
  // One minute a day at 12:00 NY on 16 weekdays from Monday 2015-01-05: each a range of 2
  // around a close of 100 (true range 2), except Friday the 23rd (day 14), a thin holiday
  // with a range of 1. Day 15 is Monday the 26th.
  const dates: number[] = []
  for (let d = 5; dates.length < 16; d++) {
    const wd = new Date(Date.UTC(2015, 0, d)).getUTCDay()
    if (wd !== 0 && wd !== 6) dates.push(utc(2015, 1, d, 17))
  }
  const b = bars(dates.map((t, i) => [t, 100, i === 14 ? 100.5 : 101, i === 14 ? 99.5 : 99, 100]))
  const days = buildDays(b)
  const inForce = atrInForce(days)

  it('is the ATR at the last existing day before the minute own day', () => {
    expect(days.n).toBe(16)
    expect(new Date(days.start[15] * 1000).toISOString()).toBe('2015-01-23T22:00:00.000Z')
    expect(Number.isNaN(days.atr[12])).toBe(true)
    expect(days.atr[13]).toBe(2)
    expect(days.atr[14]).toBe(27 / 14)
    expect(Number.isNaN(inForce[13])).toBe(true)
    expect(inForce[14]).toBe(2)
  })

  it('on a Monday is Friday ATR, and after a thin day that day ATR, counted like any other', () => {
    // Day 15 is Monday; the last existing day before it is Friday, the thin day.
    expect(inForce[15]).toBe(27 / 14)
  })

  it('nothing is watched before the 15th existing day', () => {
    expect(fifteenthDay(days, b.n)).toBe(14)
    expect(fifteenthDay(buildDays(bars(dates.slice(0, 14).map((t) => [t, 1, 1, 1, 1]))), 14)).toBe(
      14,
    )
  })
})

describe('4-hour candles', () => {
  it('start at 17, 21, 01, 05, 09 and 13 New York time; the doubled 01:00 hour joins one candle', () => {
    // 2015-11-01: 01:00 to 01:59 happens twice (05:00 and 06:00 UTC).
    const c = buildFourHours(
      bars([
        [utc(2015, 11, 1, 4, 59), 1, 1, 1, 1], // 00:59 EDT, the 21 candle
        [utc(2015, 11, 1, 5, 30), 1, 1, 1, 1], // 01:30 EDT
        [utc(2015, 11, 1, 6, 30), 1, 1, 1, 1], // 01:30 EST
        [utc(2015, 11, 1, 9, 59), 1, 1, 1, 1], // 04:59 EST
        [utc(2015, 11, 1, 10, 0), 1, 1, 1, 1], // 05:00 EST
      ]),
    )
    expect(c.n).toBe(3)
    expect(Array.from(c.first)).toEqual([0, 1, 4])
    expect(c.start[0]).toBe(utc(2015, 11, 1, 1))
    expect(c.start[1]).toBe(utc(2015, 11, 1, 5))
    expect(c.stop[1]).toBe(utc(2015, 11, 1, 10))
    expect(c.start[2]).toBe(utc(2015, 11, 1, 10))
  })

  it('the spring night 01 candle runs three hours', () => {
    const c = buildFourHours(
      bars([
        [utc(2015, 3, 8, 6, 0), 1, 1, 1, 1], // 01:00 EST
        [utc(2015, 3, 8, 8, 59), 1, 1, 1, 1], // 04:59 EDT
        [utc(2015, 3, 8, 9, 0), 1, 1, 1, 1], // 05:00 EDT
      ]),
    )
    expect(c.n).toBe(2)
    expect([c.start[0], c.stop[0], c.start[1]]).toEqual([
      utc(2015, 3, 8, 6),
      utc(2015, 3, 8, 9),
      utc(2015, 3, 8, 9),
    ])
  })

  it('New York clock buckets', () => {
    const at = (h: number, m: number) => nyClockBucket(utc(2015, 1, 6, h + 5, m))
    expect([
      at(17, 0),
      at(2, 59),
      at(3, 0),
      at(7, 59),
      at(8, 0),
      at(11, 59),
      at(12, 0),
      at(16, 59),
    ]).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })
})

describe('round numbers', () => {
  it('grids are 41 lines 15 to 35 pips (gold $3 to $7) above each half figure', () => {
    const e = roundGrid('EURUSD')
    expect(e.offsets.length).toBe(41)
    expect([e.labels[0], e.labels[1], e.labels[40]]).toEqual(['15.0', '15.5', '35.0'])
    expect((260 * e.half + e.offsets[20]) / e.unit).toBe(1.3025)
    const j = roundGrid('USDJPY')
    expect((240 * j.half + j.offsets[0]) / j.unit).toBe(120.15)
    const g = roundGrid('XAUUSD')
    expect([g.labels[0], g.labels[40]]).toEqual(['3.00', '7.00'])
    expect((130 * g.half + g.offsets[40]) / g.unit).toBe(1307)
  })

  it('the distance to the nearest R00 or R50, and the 0.05 x ATR rule on the nearest edge', () => {
    const e = roundGrid('EURUSD')
    expect(roundDistance(e, 1.2998)).toBeCloseTo(0.0002, 12)
    expect(roundDistance(e, 1.3051)).toBeCloseTo(0.0001, 12)
    // ATR 0.01: within 0.0005 of a round number.
    expect(nearRound(e, 1.2995, 1.2995, 0.01)).toBe(true)
    expect(nearRound(e, 1.2994, 1.2994, 0.01)).toBe(false)
    // A band: its nearest edge counts.
    expect(nearRound(e, 1.298, 1.2994, 0.01)).toBe(false)
    expect(nearRound(e, 1.298, 1.2996, 0.01)).toBe(true)
    expect(roundDistance(roundGrid('USDJPY'), 120.47)).toBeCloseTo(0.03, 10)
    expect(roundDistance(roundGrid('XAUUSD'), 1296)).toBe(4)
  })
})

describe('MinuteIndex', () => {
  it('answers like a plain scan', () => {
    let s = 7
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const n = 1000
    const high = Float64Array.from({ length: n }, () => 100 + Math.floor(rnd() * 40) / 4)
    const low = Float64Array.from(high, (h) => h - 1 - Math.floor(rnd() * 8) / 4)
    const ix = new MinuteIndex(high, low, n)
    for (let k = 0; k < 2000; k++) {
      const a = Math.floor(rnd() * n)
      const b = a + Math.floor(rnd() * (n - a + 1))
      const x = 100 + Math.floor(rnd() * 44) / 4
      let fh = -1
      let fl = -1
      let mx = -Infinity
      let mn = Infinity
      for (let m = a; m < b; m++) {
        if (fh < 0 && high[m] >= x) fh = m
        if (fl < 0 && low[m] <= x - 3) fl = m
        mx = Math.max(mx, high[m])
        mn = Math.min(mn, low[m])
      }
      expect(ix.firstHigh(a, b, x)).toBe(fh)
      expect(ix.firstLow(a, b, x - 3)).toBe(fl)
      expect(ix.maxHigh(a, b)).toBe(mx)
      expect(ix.minLow(a, b)).toBe(mn)
    }
  })
})
