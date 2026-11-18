import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import { shuffleDays } from './levelsShuffle'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 1000

/** Minutes [time, value]: open = high = low = close = value. */
const flat = (rows: [number, number][]): Bars => ({
  n: rows.length,
  time: Float64Array.from(rows, (r) => r[0]),
  open: Float64Array.from(rows, (r) => r[1]),
  high: Float64Array.from(rows, (r) => r[1]),
  low: Float64Array.from(rows, (r) => r[1]),
  close: Float64Array.from(rows, (r) => r[1]),
})

/** A fixed list of draws in place of the generator. */
const draws = (u: number[]) => (): (() => number) => {
  let i = 0
  return () => u[i++]
}

// Two weeks of winter days (New York = UTC-5): Mon 2015-01-05 to Fri 01-16.
// Day d has two minutes: at 18:00 + d minutes New York time the evening
// before (Sunday evening for a Monday), and at 10:00 + d minutes on its date.
const DATES = [5, 6, 7, 8, 9, 12, 13, 14, 15, 16]
const FIRST = [6, 5, 12, 10, 24, 20, 10, 40, 5, 12]
const CLOSE = [8, 4, 16, 8, 32, 16, 8, 32, 4, 16]
const evening = (date: number) => (date === 5 ? 4 : date === 12 ? 11 : date - 1)
const twoWeeks = flat(
  DATES.flatMap((date, d): [number, number][] => [
    [utc(2015, 1, evening(date), 23, d), FIRST[d]],
    [utc(2015, 1, date, 15, d), CLOSE[d]],
  ]),
)
const ALL: [number, number][] = [[utc(2015, 1, 1), utc(2015, 2, 1)]]

describe('shuffled days (Placebo 2)', () => {
  it('swaps same-name days by Fisher-Yates and chains the prices by the closes', () => {
    // Groups: Monday holds only Mon 12 (the first day keeps its place), so no
    // draw; then Tue [1, 6], Wed [2, 7], Thu [3, 8], Fri [4, 9], one draw
    // each: j = floor(u x 2). 0.1 swaps, 0.9 keeps.
    const s = shuffleDays(twoWeeks, ALL, 1, draws([0.1, 0.9, 0.1, 0.9]))
    expect(Array.from(s.order)).toEqual([0, 6, 2, 8, 4, 5, 1, 7, 3, 9])
    expect(s.moved).toBe(4)
    expect(s.outside + s.taken).toBe(0)
    // Worked by hand, slot by slot: factor = new close before / real close before.
    // slot 0 day 0: 1 -> 6, 8.  slot 1 day 6: 8/16 -> 5, 4.  slot 2 day 2: 4/4 -> 12, 16.
    // slot 3 day 8: 16/32 -> 2.5, 2.  slot 4 day 4: 2/8 -> 6, 8.  slot 5 day 5: 8/32 -> 5, 4.
    // slot 6 day 1: 4/8 -> 2.5, 2.  slot 7 day 7: 2/8 -> 10, 8.  slot 8 day 3: 8/16 -> 5, 4.
    // slot 9 day 9: 4/4 -> 12, 16.
    expect(Array.from(s.bars.close)).toEqual([
      6, 8, 5, 4, 12, 16, 2.5, 2, 6, 8, 5, 4, 2.5, 2, 10, 8, 5, 4, 12, 16,
    ])
    expect(Array.from(s.bars.high)).toEqual(Array.from(s.bars.close))
    // Each minute keeps its clock time on its new day: slot 1 (Tue 6) now holds
    // day 6's minutes at 18:06 and 10:06; slot 6 (Tue 13) day 1's at 18:01, 10:01.
    expect(s.bars.time[2]).toBe(utc(2015, 1, 5, 23, 6))
    expect(s.bars.time[3]).toBe(utc(2015, 1, 6, 15, 6))
    expect(s.bars.time[12]).toBe(utc(2015, 1, 12, 23, 1))
    expect(s.bars.time[13]).toBe(utc(2015, 1, 13, 15, 1))
    // The first day keeps its prices and its stamps.
    expect(s.bars.time[0]).toBe(twoWeeks.time[0])
    expect(s.bars.time[1]).toBe(twoWeeks.time[1])
  })

  it('uses mulberry32 with seed 1 by default', () => {
    // mulberry32(1) gives 0.627, 0.0027, 0.527, 0.981: Tue keeps, Wed swaps, Thu and Fri keep.
    const s = shuffleDays(twoWeeks, ALL)
    expect(Array.from(s.order)).toEqual([0, 1, 7, 3, 4, 5, 6, 2, 8, 9])
    // slot 2 day 7: factor 4/8 -> 20, 16; slot 3 day 3: 16/16 -> 10, 8; ... slot 7 day 2: 8/4.
    expect(s.bars.close[4]).toBe(20)
    expect(s.bars.close[5]).toBe(16)
    expect(s.bars.close[14]).toBe(24)
    expect(s.bars.close[15]).toBe(32)
  })

  it('moves a day only inside its block', () => {
    const weeks: [number, number][] = [
      [utc(2015, 1, 5), utc(2015, 1, 10)],
      [utc(2015, 1, 12), utc(2015, 1, 17)],
    ]
    const s = shuffleDays(twoWeeks, weeks, 1, draws([]))
    expect(Array.from(s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(Array.from(s.bars.close)).toEqual(Array.from(twoWeeks.close))
    expect(Array.from(s.bars.time)).toEqual(Array.from(twoWeeks.time))
  })

  it('drops a minute on a stamp already taken (the doubled 01:00 hour)', () => {
    // DST ends Sunday 2015-11-01 at 02:00 EDT: 01:30 happens at 05:30 and 06:30 UTC.
    // Day 0 Fri Oct 30; day 1 Mon Nov 2 holds both 01:30s and 10:00; day 2 Mon Nov 9.
    const b = flat([
      [utc(2015, 10, 30, 14), 10],
      [utc(2015, 11, 1, 5, 30), 11],
      [utc(2015, 11, 1, 6, 30), 12],
      [utc(2015, 11, 2, 15), 10],
      [utc(2015, 11, 8, 6, 30), 20],
      [utc(2015, 11, 9, 15), 20],
    ])
    const s = shuffleDays(b, [[utc(2015, 10, 1), utc(2015, 12, 1)]], 1, draws([0.1]))
    expect(Array.from(s.order)).toEqual([0, 2, 1])
    expect(s.taken).toBe(1)
    expect(s.outside).toBe(0)
    // Slot 1 (Mon Nov 2) gets day 2's Sunday 01:30 at its first 01:30 (05:30 UTC), factor 10/10.
    // Slot 2 (Mon Nov 9) gets day 1: the first 01:30 at 06:30 UTC (EST), the second dropped;
    // factor = 20 / 10.
    expect(Array.from(s.bars.time)).toEqual([
      utc(2015, 10, 30, 14),
      utc(2015, 11, 1, 5, 30),
      utc(2015, 11, 2, 15),
      utc(2015, 11, 8, 6, 30),
      utc(2015, 11, 9, 15),
    ])
    expect(Array.from(s.bars.close)).toEqual([10, 20, 20, 22, 20])
  })

  it('drops a minute whose clock time has no stamp in its new day (the skipped 02:00 hour)', () => {
    // DST starts Sunday 2015-03-08 at 02:00 EST: there is no 02:30 that night.
    // Day 0 Fri Feb 27; day 1 Mon Mar 2 holds Sunday Mar 1 02:30 EST (07:30 UTC); day 2 Mon Mar 9.
    const b = flat([
      [utc(2015, 2, 27, 15), 10],
      [utc(2015, 3, 1, 7, 30), 11],
      [utc(2015, 3, 2, 15), 10],
      [utc(2015, 3, 9, 14), 40],
    ])
    const s = shuffleDays(b, [[utc(2015, 2, 1), utc(2015, 4, 1)]], 1, draws([0.1]))
    expect(Array.from(s.order)).toEqual([0, 2, 1])
    expect(s.outside).toBe(1)
    // Slot 1 (Mon Mar 2) gets day 2's 10:00 EDT at 10:00 EST (15:00 UTC), factor 10/10;
    // slot 2 (Mon Mar 9) keeps only day 1's 10:00, now 10:00 EDT (14:00 UTC), factor 40/10.
    expect(Array.from(s.bars.time)).toEqual([
      utc(2015, 2, 27, 15),
      utc(2015, 3, 2, 15),
      utc(2015, 3, 9, 14),
    ])
    expect(Array.from(s.bars.close)).toEqual([10, 40, 40])
  })
})
