import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import { nearRound, roundGrid } from './levelsClock'
import {
  PLACEBO_SET,
  placeboFar,
  placeTwins,
  roundKind,
  runLevels,
  TV,
  TWIN_SETS,
  utcYear,
  type Level,
  type VisitRec,
} from './levels'

describe('the twins', () => {
  const grid = roundGrid('EURUSD')

  it('sit m x ATR below (visited from below) and above (from above), 46 sets each', () => {
    const t = placeTwins(grid, 1.312, 1.312, 3, 0.01, [])
    expect(t.length).toBe(92)
    const lower20 = t.find((x) => x.side === 1 && x.set === 20)!
    expect(TWIN_SETS[20]).toBe(0.6)
    expect(lower20.lo).toBeCloseTo(1.306, 12)
    expect(lower20.shift).toBeCloseTo(-0.006, 12)
    const upper45 = t.find((x) => x.side === -1 && x.set === 45)!
    expect(upper45.hi).toBeCloseTo(1.3205, 12)
    // A ceiling (from below only) has only its lower twins.
    expect(placeTwins(grid, 1.312, 1.3125, 1, 0.01, []).every((x) => x.side === 1)).toBe(true)
    expect(placeTwins(grid, 1.312, 1.3125, 2, 0.01, []).length).toBe(46)
  })

  it('a twin is left out within 0.05 x ATR of a round number, or inside or near another level', () => {
    // Lower twins at 1.3080 - 0.0001 i. Within 0.0005 of 1.3050: i = 25 to 35. Another level
    // [1.3070, 1.3075]: inside or within 0.0005 of it, 1.3065 to 1.3080: i = 0 to 15.
    const t = placeTwins(grid, 1.312, 1.312, 1, 0.01, [[1.307, 1.3075]])
    const out = t.filter((x) => x.leftOut).map((x) => x.set)
    const want = [
      ...Array.from({ length: 16 }, (_, i) => i),
      ...Array.from({ length: 11 }, (_, i) => 25 + i),
    ]
    expect(out).toEqual(want)
    // Upper twins 1.3160 to 1.3205: within 0.0005 of 1.3200 for i = 35 to 45.
    const up = placeTwins(grid, 1.312, 1.312, 2, 0.01, []).filter((x) => x.leftOut)
    expect(up.map((x) => x.set)).toEqual(Array.from({ length: 11 }, (_, i) => 35 + i))
  })

  it('Placebo 1: set 0.60 is the level, against the sets at least 0.10 away', () => {
    expect(TWIN_SETS[PLACEBO_SET]).toBe(0.6)
    // 0.50 and 0.70 are 0.10 away; 0.51 and 0.69 are not.
    expect([10, 30].map(placeboFar)).toEqual([true, true])
    expect([11, 29, PLACEBO_SET].map(placeboFar)).toEqual([false, false, false])
  })

  it('a level that sits on a round number is left out by its nearest edge', () => {
    expect(nearRound(grid, 1.3005, 1.302, 0.01)).toBe(true)
    expect(nearRound(grid, 1.3006, 1.302, 0.01)).toBe(false)
  })

  it('round numbers: R00 the big figures, R50 between; gold R00 every $50, R50 the other $10s', () => {
    expect([roundKind(grid, 130_000), roundKind(grid, 130_500)]).toEqual(['R00', 'R50'])
    const g = roundGrid('XAUUSD')
    expect([roundKind(g, 130_000), roundKind(g, 131_000), roundKind(g, 135_000)]).toEqual([
      'R00',
      'R50',
      'R00',
    ])
    const j = roundGrid('USDJPY')
    expect([roundKind(j, 120_000), roundKind(j, 120_500)]).toEqual(['R00', 'R50'])
  })
})

describe('one market in one walk', () => {
  // 25 weekdays from Monday 2015-01-05, a minute every 10 minutes around the clock, a slow
  // wave plus a fast one so that prices cross yesterday's lines and the round numbers.
  const rows: number[][] = []
  for (let d = 0; d < 35; d++) {
    const day = Date.UTC(2015, 0, 5 + d) / 1000
    const wd = new Date(day * 1000).getUTCDay()
    if (wd === 0 || wd === 6) continue
    for (let m = 0; m < 144; m++) {
      const t = day + m * 600
      const k = rows.length
      const p = 1.3 + 0.006 * Math.sin(k / 97) + 0.002 * Math.sin(k / 7)
      rows.push([t, p, p + 0.0004, p - 0.0004, p])
    }
  }
  const col = (i: number) => Float64Array.from(rows.map((r) => r[i]))
  const bars: Bars = {
    n: rows.length,
    time: col(0),
    open: col(1),
    high: col(2),
    low: col(3),
    close: col(4),
  }
  const run = runLevels(bars, 'EURUSD', { listYear: 2015, snapshots: [bars.time[bars.n - 1]] })

  it('watches nothing before the 15th day and no touch comes before its level was known', () => {
    expect(run.levels.length).toBeGreaterThan(0)
    expect(
      run.levels.every((l) => l.firstWatched >= run.fifteenth && l.firstWatched >= l.knownFrom),
    ).toBe(true)
    expect(run.visits.length).toBeGreaterThan(0)
    expect(
      run.visits.every(
        (v) => v.touch >= run.fifteenth && (v.knownFrom === null || v.touch >= v.knownFrom),
      ),
    ).toBe(true)
    expect(
      run.levels.every((l) => l.leftOut === nearRound(roundGrid('EURUSD'), l.low, l.high, l.atr)),
    ).toBe(true)
  })

  it('the twin sums add up the same by week and by set, and match the full list of the year', () => {
    const sum = (cells: { v: Float64Array }[], f: number) => cells.reduce((a, c) => a + c.v[f], 0)
    const n = sum(run.twins.visitsByWeek, TV.n)
    expect(n).toBeGreaterThan(0)
    expect(sum(run.twins.visitsBySet, TV.n)).toBe(n)
    expect(run.twinVisits.length).toBe(n)
    expect(run.counts.reduce((a, c) => a + c.twinVisits, 0)).toBe(n)
    const turns = run.twinVisits.filter((v) => v.race[1] === 'turn').length
    expect(sum(run.twins.visitsByWeek, TV.turn + 1)).toBe(turns)
    expect(run.twinVisits.every((v) => utcYear(v.touch) === 2015)).toBe(true)
  })

  it('a snapshot after the last minute holds each watcher still live, with what it remembers', () => {
    expect(run.snaps.length).toBeGreaterThan(0)
    expect(run.snaps.every((s) => s.at === bars.time[bars.n - 1] && s.mem >= 0 && s.mem <= 2)).toBe(
      true,
    )
  })
})

describe('one walk with hand-made levels', () => {
  // Weekdays from Monday 2015-01-05, two minutes each at 12:00 and 12:01 UTC, Bid
  // high and low 0.005 either side of p: every true range is 0.01, so the ATR in
  // force is 0.01 from the 15th day on (g = 0.0025, 0.05 x ATR = 0.0005). Day
  // index 15 holds the rows of the test instead.
  const dates: number[] = []
  for (let d = 0; dates.length < 16; d++) {
    const t = Date.UTC(2015, 0, 5 + d, 12) / 1000
    const wd = new Date(t * 1000).getUTCDay()
    if (wd !== 0 && wd !== 6) dates.push(t)
  }
  function walk(p: number, test: number[][]): Bars {
    const rows: number[][] = []
    for (const t of dates.slice(0, 15))
      for (let k = 0; k < 2; k++) rows.push([t + 60 * k, p, p + 0.005, p - 0.005, p])
    test.forEach((r, k) => rows.push([dates[15] + 60 * k, ...r]))
    const col = (i: number) => Float64Array.from(rows.map((r) => r[i]))
    return { n: rows.length, time: col(0), open: col(1), high: col(2), low: col(3), close: col(4) }
  }
  /** A Fibonacci floor (from above, once) of chart F4, known from its first minute's stamp. */
  function floor(
    b: Bars,
    id: number,
    kind: 'F4C' | 'F4J',
    lo: number,
    hi: number,
    start: number,
    lifeEnd: number,
  ): Level {
    return {
      id,
      kind,
      what: `floor:${id}`,
      knownFrom: b.time[start],
      sides: 2,
      start,
      lifeEnd,
      once: true,
      from: [start],
      lo: [lo],
      hi: [hi],
      built: [b.time[start]],
      turns: [0],
      group: 'F4',
      legHigh: NaN,
      legLow: NaN,
    }
  }
  const m0 = 30 // first minute of day index 15

  it('Known from: stops when a level was built from a candle that closed after the time it became known', () => {
    const b = walk(1.3, [
      [1.3, 1.3005, 1.2995, 1.3],
      [1.3, 1.3005, 1.2995, 1.3],
    ])
    const ok = floor(b, 0, 'F4C', 1.312, 1.312, m0, b.n)
    expect(() => runLevels(b, 'EURUSD', { levels: [ok], noTwins: true })).not.toThrow()
    const late = { ...ok, built: [b.time[m0] + 60] }
    expect(() => runLevels(b, 'EURUSD', { levels: [late], noTwins: true })).toThrow(/Known from/)
    // A band that takes effect from minute m0 + 1 built from a candle closing after that minute.
    const widened = {
      ...ok,
      from: [m0, m0 + 1],
      lo: [1.312, 1.311],
      hi: [1.312, 1.312],
      turns: [0, 0],
      built: [b.time[m0], b.time[m0 + 1] + 1],
    }
    expect(() => runLevels(b, 'EURUSD', { levels: [widened], noTwins: true })).toThrow(/Known from/)
  })

  it('a twin is left out near another level of its group being watched in that minute, not near one whose life ended', () => {
    // Price stays at 1.30: nothing is visited. A, an F4C floor at 1.3120 from m0 + 1, has
    // upper twins at 1.3160 + 0.0001 s (set s). B, an F4J floor [1.3170, 1.3175] of the
    // same chart, watched from m0: sets 5 to 20 lie inside or within 0.0005 of it. C, an
    // F4C floor at 1.3190 whose life is the one minute m0 (it ended the minute before A's
    // first): sets 25 to 35 would be within 0.0005 of it, but C is not watched then. Sets
    // 35 to 45 are within 0.0005 of the round number 1.3200. A keeps 46 - 16 - 11 = 19.
    const b = walk(1.3, [
      [1.3, 1.3005, 1.2995, 1.3],
      [1.3, 1.3005, 1.2995, 1.3],
    ])
    const A = floor(b, 0, 'F4C', 1.312, 1.312, m0 + 1, b.n)
    const B = floor(b, 1, 'F4J', 1.317, 1.3175, m0, b.n)
    const C = floor(b, 2, 'F4C', 1.319, 1.319, m0, m0 + 1)
    const run = runLevels(b, 'EURUSD', { levels: [A, B, C] })
    const rec = (id: number) => run.levels.find((l) => l.id === id)!
    expect(rec(2).lastLive).toBe(b.time[m0])
    expect(rec(0).twins).toBe(19)
  })

  it("a Fibonacci twin's life ends at the end of its own first visit", () => {
    // An F4C floor at 1.3120 (never reached). Its upper twin of set s is the line
    // 1.3160 + 0.0001 s. Minute 1: away above for s <= 37 (1.3222 >= line + 0.0025).
    // Minute 2: low 1.31785 touches s >= 19. Minute 3: high 1.3222 ends each visit in a
    // turn. Minutes 4 and 5 do it again, but each twin's life is over. Sets 35 to 45 sit
    // on the round number 1.3200 and are left out: sets 19 to 34 have one visit each.
    const up = [1.3215, 1.3222, 1.3214, 1.322]
    const down = [1.319, 1.319, 1.31785, 1.318]
    const b = walk(1.322, [[1.322, 1.3222, 1.3218, 1.322], down, up, down, up])
    const A = floor(b, 0, 'F4C', 1.312, 1.312, m0, b.n)
    const seen: VisitRec[] = []
    runLevels(b, 'EURUSD', { levels: [A], onTwinVisit: (v) => seen.push(v) })
    const mine = seen.filter((v) => v.level === 0)
    const sets = mine.map((v) => v.set).sort((x, y) => x - y)
    expect(sets).toEqual(Array.from({ length: 16 }, (_, i) => 19 + i))
    expect(mine.every((v) => v.touch === b.time[m0 + 1] && v.end === 'turn')).toBe(true)
  })
})
