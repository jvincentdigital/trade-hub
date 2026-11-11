// Strategy lab: the race's London breakout (src/lib/race/londonBreakout.ts,
// run unchanged one day at a time), its opposite (fade the first break, the
// course's "stop hunt"), and the day's London direction for the Fib combo.
// Pure, tested.

import type { OHLCCandle } from '../types/market'
import { minStopForFullRisk, RACE_SIZING } from '../race/account'
import { londonBreakout } from '../race/londonBreakout'
import type { LabEntry } from './engine'
import { DAY, HOUR, dayStart, utcWeekday } from './time'

const M15 = 900

/** Index of the first candle with time >= t (binary search). */
export function firstAtOrAfter(c: OHLCCandle[], t: number): number {
  let lo = 0
  let hi = c.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (c[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface LondonLabOptions {
  /** Target as a multiple of the stop distance (the race uses 2). */
  rr: number
  /** Trade against the break instead (stop the same distance on the other side). */
  fade?: boolean
  leverage: number
}

/**
 * One London breakout per weekday, from 15m candles (and 1h for the 20-day
 * average range), exactly as the live race checks it at each 15-minute tick
 * from 06:15 to 10:00 UTC: the price is the open of the candle starting at
 * the tick (what the tick would fill at), so the race's "no chase" and "back
 * inside the range" checks run, the stop and target sit around that price,
 * and a break stays usable for 2 closed candles. The race's margin floor
 * applies to the stop. The trade enters at that candle's open.
 */
export function londonLab(m15: OHLCCandle[], h1: OHLCCandle[], o: LondonLabOptions): LabEntry[] {
  const out: LabEntry[] = []
  if (!m15.length) return out
  for (let d = dayStart(m15[0].time) + DAY; d <= m15[m15.length - 1].time; d += DAY) {
    const wd = utcWeekday(d)
    if (wd === 0 || wd === 6) continue
    const i0 = firstAtOrAfter(m15, d - 2 * DAY)
    const i1 = firstAtOrAfter(m15, d + 10 * HOUR + M15)
    const h0 = firstAtOrAfter(h1, d - 40 * DAY)
    const h1End = firstAtOrAfter(h1, d)
    const m = m15.slice(i0, i1)
    const h = h1.slice(h0, h1End)
    for (let now = d + 6 * HOUR + M15; now <= d + 10 * HOUR; now += M15) {
      const i = firstAtOrAfter(m15, now)
      if (i >= m15.length) break
      if (m15[i].time !== now) continue // no candle opens at this tick (a gap): no fill
      const price = m15[i].open
      const minDist = minStopForFullRisk(price, o.leverage, RACE_SIZING.riskPct)
      const chk = londonBreakout(m, h, now, { minDist, price })
      if (!chk.signal) continue
      const s = chk.signal
      const dist = Math.abs(s.entry - s.stop)
      const long = s.direction === 'long' ? !o.fade : !!o.fade
      out.push({
        i,
        kind: 'market',
        direction: long ? 'long' : 'short',
        stop: long ? s.entry - dist : s.entry + dist,
        target: long ? s.entry + o.rr * dist : s.entry - o.rr * dist,
        signalTime: now,
      })
      break
    }
  }
  return out
}

/**
 * The day's London direction for each candle: after the first close above
 * the Asian range (00:00-06:00 UTC) in the 06:00-10:00 UTC window, +1 until
 * 21:00 UTC; below, -1; otherwise 0. Read on the candles' own size, from
 * closed candles only (the direction starts at the break candle's close).
 */
export function londonDirection(c: OHLCCandle[], tfSec: number): Int8Array {
  const out = new Int8Array(c.length)
  let i = 0
  while (i < c.length) {
    const d = dayStart(c[i].time)
    let hi = -Infinity
    let lo = Infinity
    let n = 0
    let j = i
    for (; j < c.length && c[j].time < d + 6 * HOUR; j++) {
      hi = Math.max(hi, c[j].high)
      lo = Math.min(lo, c[j].low)
      n++
    }
    const enough = n >= Math.floor((6 * HOUR) / tfSec) * 0.75 && n > 0
    let dir = 0
    for (; j < c.length && c[j].time < d + DAY; j++) {
      // A candle closing at or before 10:00 may set it; the next one trades on it.
      if (dir) out[j] = c[j].time < d + 21 * HOUR ? dir : 0
      else if (enough && c[j].time < d + 10 * HOUR && c[j].time + tfSec <= d + 10 * HOUR) {
        if (c[j].close > hi) dir = 1
        else if (c[j].close < lo) dir = -1
      }
    }
    i = j
  }
  return out
}
