// Harmonic study (docs/harmonic-study.md, "Counting", Amendment 1 point 5):
// weeks and the weekly t-statistic. Pure.

export const WEEK = 7 * 86_400
/** 1970-01-03 00:00 UTC was a Saturday. */
const SATURDAY = 2 * 86_400

/** Week number: weeks run from Saturday 00:00 UTC to the next. */
export const weekOf = (t: number) => Math.floor((t - SATURDAY) / WEEK)
/** Saturday 00:00 UTC that starts the week of t. */
export const weekStart = (t: number) => weekOf(t) * WEEK + SATURDAY

export interface WeeklyT {
  /** Weeks with at least one trade. */
  weeks: number
  /** Mean of the weekly sums of R. */
  mean: number
  /** Standard deviation of the weekly sums (n - 1). */
  sd: number
  /** mean / (sd / sqrt(weeks)); NaN with fewer than 2 weeks. */
  t: number
}

/** Weekly t-statistic of results in R, each placed in the week of its fill minute. */
export function weeklyT(items: Iterable<{ time: number; r: number }>): WeeklyT {
  const sums = new Map<number, number>()
  for (const { time, r } of items) {
    const w = weekOf(time)
    sums.set(w, (sums.get(w) ?? 0) + r)
  }
  const v = [...sums.values()]
  const n = v.length
  if (n === 0) return { weeks: 0, mean: NaN, sd: NaN, t: NaN }
  const mean = v.reduce((s, x) => s + x, 0) / n
  if (n < 2) return { weeks: n, mean, sd: NaN, t: NaN }
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
  return { weeks: n, mean, sd, t: mean / (sd / Math.sqrt(n)) }
}
