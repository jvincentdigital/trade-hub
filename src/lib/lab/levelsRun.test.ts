import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import { nearRound, roundGrid } from './levelsClock'
import { placeTwins, roundKind, runLevels, TV, TWIN_SETS, utcYear } from './levels'

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
