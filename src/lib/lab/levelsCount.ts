// Levels study (docs/levels-study.md, "Counting"): z and the lift by market,
// the lift of a kind, the bootstrap t of a lift (2,000 seeded draws of counting
// weeks), a trade's weekly t and a trade's gap to its twins. Pure.

import { weeklyT, weekOf, weekStart } from './harmonicStats'
import { mulberry32 } from './harmonicStudy'

export { weeklyT, weekOf, weekStart }

export const BOOT_DRAWS = 2000
export const BOOT_GENERATOR =
  'mulberry32 (src/lib/lab/harmonicStudy.ts), seeded with the draw number 1 to 2,000; each of the W picks is week floor(u x W) of the W counting weeks sorted by start'

/**
 * One counting week's share of a comparison in one market and one cell (the
 * UTC year and side the twins are matched by). Lift: hits are turns (runs),
 * n are turns + breaks (runs + fails), for the level's visits and for its
 * twins'. Gap: hits are sums of trade results, n the numbers of trades.
 * A week whose visits all ended "neither" still counts as a week: give it
 * zeros.
 */
export interface Unit {
  week: number
  market: string
  cell: string
  hits: number
  n: number
  twinHits: number
  twinN: number
}

/** z of one decided level visit: 1 for a turn (run), 0 for a break (fail), minus the twins' rate; NaN with no twin rate. */
export const zOf = (hit: boolean, twinHits: number, twinN: number) =>
  twinN > 0 ? (hit ? 1 : 0) - twinHits / twinN : NaN

interface Prepared {
  weeks: number[]
  /** Per unit: week index and cell index. */
  wk: Int32Array
  cl: Int32Array
  hits: Float64Array
  n: Float64Array
  th: Float64Array
  tn: Float64Array
  /** Per cell: market index. */
  mk: Int32Array
  cells: number
  markets: number
}

function prepare(units: Unit[]): Prepared {
  const weeks = [...new Set(units.map((u) => u.week))].sort((a, b) => a - b)
  const wIdx = new Map(weeks.map((w, i) => [w, i]))
  const cIdx = new Map<string, number>()
  const mIdx = new Map<string, number>()
  const mk: number[] = []
  const wk = new Int32Array(units.length)
  const cl = new Int32Array(units.length)
  units.forEach((u, i) => {
    if (!mIdx.has(u.market)) mIdx.set(u.market, mIdx.size)
    const key = `${u.market}|${u.cell}`
    let c = cIdx.get(key)
    if (c === undefined) {
      c = cIdx.size
      cIdx.set(key, c)
      mk.push(mIdx.get(u.market)!)
    }
    wk[i] = wIdx.get(u.week)!
    cl[i] = c
  })
  return {
    weeks,
    wk,
    cl,
    hits: Float64Array.from(units, (u) => u.hits),
    n: Float64Array.from(units, (u) => u.n),
    th: Float64Array.from(units, (u) => u.twinHits),
    tn: Float64Array.from(units, (u) => u.twinN),
    mk: Int32Array.from(mk),
    cells: cIdx.size,
    markets: mIdx.size,
  }
}

/**
 * The statistic with each week weighted (1 for the real data, the number of
 * times it was drawn in a draw). 'lift': per market the average z in points
 * out of 100 (visits with no twin rate left out), then the plain average of
 * the markets that have a level visit with a twin rate. 'gap': the average,
 * over all trades together, of the result minus the twins' average result.
 */
function statOf(p: Prepared, mode: 'lift' | 'gap', weight: Float64Array | null): number {
  const H = new Float64Array(p.cells)
  const N = new Float64Array(p.cells)
  const TH = new Float64Array(p.cells)
  const TN = new Float64Array(p.cells)
  for (let i = 0; i < p.wk.length; i++) {
    const w = weight ? weight[p.wk[i]] : 1
    if (w === 0) continue
    const c = p.cl[i]
    H[c] += w * p.hits[i]
    N[c] += w * p.n[i]
    TH[c] += w * p.th[i]
    TN[c] += w * p.tn[i]
  }
  if (mode === 'gap') {
    let s = 0
    let k = 0
    for (let c = 0; c < p.cells; c++) {
      if (TN[c] <= 0 || N[c] <= 0) continue
      s += H[c] - (N[c] * TH[c]) / TN[c]
      k += N[c]
    }
    return k > 0 ? s / k : NaN
  }
  const zs = new Float64Array(p.markets)
  const ks = new Float64Array(p.markets)
  for (let c = 0; c < p.cells; c++) {
    if (TN[c] <= 0 || N[c] <= 0) continue
    zs[p.mk[c]] += H[c] - (N[c] * TH[c]) / TN[c]
    ks[p.mk[c]] += N[c]
  }
  let s = 0
  let k = 0
  for (let m = 0; m < p.markets; m++)
    if (ks[m] > 0) {
      s += (100 * zs[m]) / ks[m]
      k++
    }
  return k > 0 ? s / k : NaN
}

/** The lift of a kind (or of one market, given only its units), in points out of 100. */
export const lift = (units: Unit[]) => statOf(prepare(units), 'lift', null)

/** Each market's lift, in points out of 100 (NaN for a market with no level visit to count). */
export function marketLifts(units: Unit[]): Map<string, number> {
  const by = new Map<string, Unit[]>()
  for (const u of units) {
    const a = by.get(u.market)
    if (a) a.push(u)
    else by.set(u.market, [u])
  }
  return new Map([...by].map(([m, us]) => [m, lift(us)]))
}

/** The gap of a trade to its twins, in R, over all its trades together. */
export const gap = (units: Unit[]) => statOf(prepare(units), 'gap', null)

export interface Boot {
  value: number
  /** Standard deviation of the value over the draws (n - 1), draws with no value left out. */
  se: number
  t: number
  draws: number
}

/**
 * The t of a lift (mode 'lift') or of a gap (mode 'gap'): the value over the
 * standard deviation of the value over `draws` draws of the counting weeks
 * (seeds 1 to draws), each taking as many weeks as there are, by index, with
 * replacement.
 */
export function bootstrap(
  units: Unit[],
  mode: 'lift' | 'gap',
  draws = BOOT_DRAWS,
  gen: (seed: number) => () => number = mulberry32,
): Boot {
  const p = prepare(units)
  const value = statOf(p, mode, null)
  const W = p.weeks.length
  const weight = new Float64Array(W)
  const vals: number[] = []
  for (let s = 1; s <= draws; s++) {
    const rng = gen(s)
    weight.fill(0)
    for (let i = 0; i < W; i++) weight[Math.floor(rng() * W)]++
    const v = statOf(p, mode, weight)
    if (!Number.isNaN(v)) vals.push(v)
  }
  const k = vals.length
  if (k < 2) return { value, se: NaN, t: NaN, draws: k }
  const mean = vals.reduce((a, b) => a + b, 0) / k
  const se = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1))
  return { value, se, t: value / se, draws: k }
}

/** Sum units that share a week, market and cell (fewer units, the same statistic). */
export function mergeUnits(units: Iterable<Unit>): Unit[] {
  const m = new Map<string, Unit>()
  for (const u of units) {
    const key = `${u.week}|${u.market}|${u.cell}`
    const a = m.get(key)
    if (!a) m.set(key, { ...u })
    else {
      a.hits += u.hits
      a.n += u.n
      a.twinHits += u.twinHits
      a.twinN += u.twinN
    }
  }
  return [...m.values()]
}
