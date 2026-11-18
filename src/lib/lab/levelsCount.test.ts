import { describe, expect, it } from 'vitest'
import {
  bootstrap,
  gap,
  lift,
  marketLifts,
  mergeUnits,
  weeklyT,
  zOf,
  type Unit,
} from './levelsCount'

const u = (
  week: number,
  market: string,
  cell: string,
  hits: number,
  n: number,
  twinHits: number,
  twinN: number,
): Unit => ({
  week,
  market,
  cell,
  hits,
  n,
  twinHits,
  twinN,
})

/** A stub generator: seed s gives the numbers seq[s - 1] in turn. */
const stub = (seq: number[][]) => (seed: number) => {
  let i = 0
  return () => seq[seed - 1][i++]
}

describe('z and the lift', () => {
  it('z is 1 for a turn or 0 for a break minus the twins turn rate', () => {
    expect(zOf(true, 1, 4)).toBe(0.75)
    expect(zOf(false, 1, 4)).toBe(-0.25)
    expect(Number.isNaN(zOf(true, 0, 0))).toBe(true)
  })

  // Market A, one cell: week 1 a level turn, twins 1 turn of 2; week 2 a level break, twins 0 of 2.
  // Twins' rate 1 / 4; z = (1 - 0.25) + (0 - 0.25) = 0.5 over 2 visits: 25 points.
  const A = [u(1, 'A', 'y2010|below', 1, 1, 1, 2), u(2, 'A', 'y2010|below', 0, 1, 0, 2)]

  it('a market lift is its average z in points; a kind is the plain average of its markets', () => {
    expect(lift(A)).toBe(25)
    // Market B: one break against a twins' rate of 1 / 2: -50. The kind: (25 - 50) / 2.
    const B = [u(1, 'B', 'y2010|below', 0, 1, 1, 2)]
    expect(lift([...A, ...B])).toBe(-12.5)
    expect([...marketLifts([...A, ...B])]).toEqual([
      ['A', 25],
      ['B', -50],
    ])
  })

  it('visits with no twin rate are left out, and a market with no level visit', () => {
    expect(Number.isNaN(lift([u(1, 'A', 'c', 1, 1, 0, 0)]))).toBe(true)
    expect(lift([...A, u(1, 'C', 'c', 0, 0, 3, 4)])).toBe(25)
  })

  it('the bootstrap t: the lift over the standard deviation of the lift over draws of weeks', () => {
    // Two weeks, so a pick is week floor(2u). Draw 1 takes week 1 twice: z = 2 x (1 - 0.5) over
    // 2 visits, 50. Draw 2 takes week 2 twice: twins' rate 0, z = 0, 0. Draw 3 takes both: 25.
    const gen = stub([
      [0.1, 0.4],
      [0.9, 0.6],
      [0.2, 0.7],
    ])
    const b = bootstrap(A, 'lift', 3, gen)
    expect(b.value).toBe(25)
    // Mean 25; deviations 25, -25, 0; n - 1 = 2: sd = sqrt(1250 / 2) = 25.
    expect(b.se).toBe(25)
    expect(b.t).toBe(1)
    expect(b.draws).toBe(3)
  })

  it('a draw with no value is left out of the standard deviation', () => {
    // Week 1 holds only twins, week 2 only the level visit (twins elsewhere in its cell are none).
    const units = [u(1, 'A', 'c', 0, 0, 1, 2), u(2, 'A', 'c', 1, 1, 0, 0)]
    const gen = stub([
      [0.9, 0.9], // week 2 twice: no twin rate, no value
      [0.1, 0.9], // both: z = 1 - 0.5: 50
      [0.1, 0.1], // week 1 twice: no level visit, no value
      [0.6, 0.2], // both: 50
    ])
    const b = bootstrap(units, 'lift', 4, gen)
    expect([b.value, b.draws, b.se]).toEqual([50, 2, 0])
  })
})

describe('a trade gap to its twins and its weekly t', () => {
  it('the gap: each trade minus the twins average in its cell, averaged over all trades together', () => {
    // Cell 1: two level trades summing 3, twins average 1 / 4. Cell 2 (another market): one trade
    // of -1 against twins averaging -2. Gap = ((3 - 2 x 0.25) + (-1 + 2)) / 3.
    const units = [u(5, 'A', 'c1', 3, 2, 1, 4), u(6, 'B', 'c2', -1, 1, -4, 2)]
    expect(gap(units)).toBeCloseTo(3.5 / 3, 12)
    // A trade with no twin trade in its cell is left out.
    expect(gap([...units, u(7, 'A', 'c3', 10, 1, 0, 0)])).toBeCloseTo(3.5 / 3, 12)
  })

  it('merges units of one week, market and cell without changing the numbers', () => {
    const units = [
      u(1, 'A', 'c', 1, 1, 0, 0),
      u(1, 'A', 'c', 0, 0, 1, 2),
      u(2, 'A', 'c', 0, 1, 1, 3),
    ]
    expect(mergeUnits(units).length).toBe(2)
    expect(lift(mergeUnits(units))).toBe(lift(units))
  })

  it('the weekly t sums results per counting week (Saturday 00:00 UTC) of the fill minute', () => {
    const sat = Date.UTC(2015, 0, 3) / 1000
    const w = weeklyT([
      { time: sat + 100, r: 1 },
      { time: sat + 6 * 86_400, r: 1 }, // same week: 2
      { time: sat + 7 * 86_400, r: -1 }, // next week: -1
      { time: sat + 14 * 86_400, r: 2 },
    ])
    // Weekly sums 2, -1, 2: mean 1, sd sqrt((1 + 4 + 1) / 2) = sqrt(3).
    expect(w.weeks).toBe(3)
    expect(w.mean).toBe(1)
    expect(w.t).toBeCloseTo(1 / (Math.sqrt(3) / Math.sqrt(3)), 12)
  })
})
