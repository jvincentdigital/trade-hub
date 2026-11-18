// Levels study (docs/levels-study.md, "How the numbers are checked", Placebo
// 2): the shuffled-days series. Each day changes places only with days of the
// same name (Monday ... Friday) in the same block of years, by a Fisher-Yates
// shuffle from one named generator with seed 1. A day keeps its own 1-minute
// candles; in time order, every price of a moved day is multiplied by the close
// of the day now before it over the close of the day that was really before it
// (a day left in its own place keeps its prices);
// each minute keeps its New York clock time counted from its day's 17:00
// start; a minute whose new stamp falls outside its new day, or on a stamp
// already taken, is dropped. Pure.

import type { Bars } from './harmonicFind'
import { mulberry32 } from './harmonicStudy'
import { buildDays, dayNameOf, dayStart, nyLocal, nyToUtc, weekdayOf } from './levelsClock'

const DAY = 86_400

export const SHUFFLE_SEED = 1
export const SHUFFLE_GENERATOR =
  'mulberry32 (src/lib/lab/harmonicStudy.ts) seeded with 1, one generator per market; groups (block of years, then day name Monday to Friday) in that order, each a Fisher-Yates shuffle of its days in time order (for i from the last down to 1: j = floor(u x (i + 1)), swap i and j)'

export interface Shuffled {
  bars: Bars
  /** Slot (the original day sequence) to the day now placed there. */
  order: Int32Array
  days: number
  /** Days now in another day's place. */
  moved: number
  minutes: number
  /** Minutes dropped: their clock time has no stamp in the new day, or falls outside it; or their stamp was taken. */
  outside: number
  taken: number
}

/**
 * Shuffle the days of one market's file. `blocks` are [from, to) spans of
 * UTC seconds; a day belongs to the block holding the midnight of the date it
 * is named by. The first day of the file keeps its place and its prices (it
 * has no day before it); a day in no block keeps its place.
 */
export function shuffleDays(
  bars: Bars,
  blocks: [number, number][],
  seed = SHUFFLE_SEED,
  gen: (seed: number) => () => number = mulberry32,
): Shuffled {
  const days = buildDays(bars)
  const D = days.n
  const order = Int32Array.from({ length: D }, (_, i) => i)
  // Groups: block, then day name; days of a group in time order.
  const groups = new Map<number, number[]>()
  for (let d = 1; d < D; d++) {
    const at = days.name[d] * DAY
    const b = blocks.findIndex(([a, z]) => at >= a && at < z)
    if (b < 0) continue
    const key = b * 7 + weekdayOf(days.name[d])
    const g = groups.get(key)
    if (g) g.push(d)
    else groups.set(key, [d])
  }
  const rng = gen(seed)
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const slots = groups.get(key)!
    const a = slots.slice()
    for (let i = a.length - 1; i >= 1; i--) {
      const j = Math.floor(rng() * (i + 1))
      const x = a[i]
      a[i] = a[j]
      a[j] = x
    }
    slots.forEach((s, k) => (order[s] = a[k]))
  }

  const time: number[] = []
  const open: number[] = []
  const high: number[] = []
  const low: number[] = []
  const close: number[] = []
  let outside = 0
  let taken = 0
  let moved = 0
  let lastClose = NaN
  const startWall = (d: number) => nyLocal(dayStart(days.name[d]))
  for (let p = 0; p < D; p++) {
    const q = order[p]
    if (q !== p) moved++
    const f = q === p ? 1 : lastClose / days.close[q - 1]
    const shift = startWall(p) - startWall(q)
    const name = days.name[p]
    const seen = new Set<number>()
    const kept: { t: number; i: number }[] = []
    for (let i = days.first[q]; i < days.end[q]; i++) {
      const wall = nyLocal(bars.time[i]) + shift
      const t = nyToUtc(wall)
      if (nyLocal(t) !== wall || dayNameOf(t) !== name) {
        outside++
        continue
      }
      if (seen.has(t)) {
        taken++
        continue
      }
      seen.add(t)
      kept.push({ t, i })
    }
    kept.sort((x, y) => x.t - y.t)
    for (const { t, i } of kept) {
      time.push(t)
      open.push(bars.open[i] * f)
      high.push(bars.high[i] * f)
      low.push(bars.low[i] * f)
      close.push(bars.close[i] * f)
    }
    if (kept.length) lastClose = close[close.length - 1]
  }
  return {
    bars: {
      n: time.length,
      time: Float64Array.from(time),
      open: Float64Array.from(open),
      high: Float64Array.from(high),
      low: Float64Array.from(low),
      close: Float64Array.from(close),
    },
    order,
    days: D,
    moved,
    minutes: bars.n,
    outside,
    taken,
  }
}
