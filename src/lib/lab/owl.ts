// The Golden Owl's idea on 1-minute gold (docs/owl-study.md). Two things:
// a rule-free count of how often gold, having moved one step, comes back a
// step before going another (the bounce a grid collects), and an
// illustration of a grid with the Owl's passive preset numbers. The grid is
// our own simple reading of its preset files, not the Owl: its code is
// closed. Pure: candles in, counts and play-money results out.

import type { OHLCCandle } from '../types/market'
import { HOUR, MIN, londonSummer, nyOffset, utcWeekday } from './time'

/** Every fixed number of the study (the plan, before any count). */
export const OWL = {
  /** Dollars between ladder levels, and between a side's trades. */
  step: 1,
  /** A side closes when price is this many dollars better than its average entry. */
  target: 1,
  /** First trade: 0.02 lots of 100 ounces. */
  firstOz: 2,
  /** Each added trade is this many times the last. */
  factor: 1.357,
  /** At most 0.5 lots a trade. */
  maxOz: 50,
  /** The evening ends when it is down this share of the balance, open trades included. */
  stopPct: 4,
  /** While the evening is down this much, a side that closes does not start again. */
  cautionPct: 2,
  startMoney: 50_000,
  /** The Owl's hours: 18:05 to 24:00 New York, Monday to Wednesday. */
  eveningFrom: 18 * HOUR + 5 * MIN,
  eveningTo: 24 * HOUR,
  eveningDays: [1, 2, 3],
  /** A window sits out with fewer than this share of its minutes present. */
  minShare: 0.9,
} as const

export interface Window {
  /** UTC midnight of the window's calendar date (New York date for evenings, London date for London hours). */
  day: number
  from: number
  to: number
}

/** The evening of a New York calendar date, given as that date's UTC midnight: 18:05 to 24:00 New York time. */
export function eveningOf(day: number): Window {
  const off = nyOffset(day + 23 * HOUR)
  return { day, from: day + OWL.eveningFrom - off * HOUR, to: day + OWL.eveningTo - off * HOUR }
}

/** London hours of a London calendar date: 07:00 to 16:30 London time. */
export function londonHoursOf(day: number): Window {
  const off = londonSummer(day + 12 * HOUR) ? HOUR : 0
  return { day, from: day + 7 * HOUR - off, to: day + 16.5 * HOUR - off }
}

export const isWeekday = (day: number, days: readonly number[]) => days.includes(utcWeekday(day))

/** The window's candles, or null when it sits out (too few minutes present). */
export function candlesIn(m1: OHLCCandle[], from: number, w: Window): OHLCCandle[] | null {
  const out: OHLCCandle[] = []
  for (let i = from; i < m1.length && m1[i].time < w.to; i++)
    if (m1[i].time >= w.from) out.push(m1[i])
  return out.length >= OWL.minShare * ((w.to - w.from) / MIN) ? out : null
}

/** The order prices are visited inside one candle: open, low, high, close when it closed up; open, high, low, close when it closed down. */
export function pathOf(b: OHLCCandle): number[] {
  return b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close]
}

const EPS = 1e-9

export interface BounceCount {
  /** Every time price first reached the next level up or down. */
  steps: number
  /** Steps that went back the way the last one came. */
  bounces: number
  /** Steps that continued the way of the last one. */
  onward: number
}

/**
 * Part 1. A ladder of levels `step` apart from the first price. A step is
 * the first touch of the next level up or down; after the first step, each
 * one is a bounce (against the last step) or an onward step (with it).
 */
export function bounceCount(candles: OHLCCandle[], step: number = OWL.step): BounceCount {
  const out: BounceCount = { steps: 0, bounces: 0, onward: 0 }
  let anchor: number | null = null
  let level = 0
  let last = 0
  for (const b of candles)
    for (const p of pathOf(b)) {
      if (anchor == null) {
        anchor = p
        continue
      }
      for (;;) {
        const dir =
          p >= anchor + (level + 1) * step - EPS
            ? 1
            : p <= anchor + (level - 1) * step + EPS
              ? -1
              : 0
        if (!dir) break
        level += dir
        out.steps++
        if (last) {
          if (dir === last) out.onward++
          else out.bounces++
        }
        last = dir
      }
    }
  return out
}

export interface GridEvening {
  /** The evening's result in dollars, after costs. */
  pnl: number
  /** It hit the account stop. */
  stopped: boolean
  /** Times a side closed at its target. */
  closes: number
  /** The lowest point of the evening, open trades included, in dollars. */
  worst: number
  /** The most ounces open at once on one side. */
  maxOz: number
}

interface Order {
  price: number
  oz: number
}

/**
 * Part 2. One evening of a two-sided grid with the Owl's passive numbers on
 * an account of `balance` dollars; `cost` is the round trip in dollars per
 * ounce, charged when a trade closes.
 */
export function gridEvening(candles: OHLCCandle[], balance: number, cost: number): GridEvening {
  const sides: { long: boolean; orders: Order[] }[] = [
    { long: true, orders: [] },
    { long: false, orders: [] },
  ]
  let realized = 0
  let closes = 0
  let worst = 0
  let maxOz = 0
  const stopAt = (-OWL.stopPct / 100) * balance
  const cautionAt = (-OWL.cautionPct / 100) * balance
  const openAt = (p: number) =>
    sides.reduce(
      (a, s) =>
        a + s.orders.reduce((x, o) => x + o.oz * ((s.long ? p - o.price : o.price - p) - cost), 0),
      0,
    )
  const total = (p: number) => realized + openAt(p)
  const result = (p: number, stopped: boolean): GridEvening => {
    const pnl = total(p)
    return { pnl, stopped, closes, worst: Math.min(worst, pnl), maxOz }
  }

  let lastPrice: number | null = null
  for (const b of candles)
    for (const p of pathOf(b)) {
      lastPrice = p
      for (const s of sides) {
        for (;;) {
          if (!s.orders.length) {
            // A side starts (again) at the price, unless the evening is in caution.
            if (total(p) <= cautionAt) break
            s.orders.push({ price: p, oz: OWL.firstOz })
            continue
          }
          const oz = s.orders.reduce((a, o) => a + o.oz, 0)
          maxOz = Math.max(maxOz, oz)
          const avg = s.orders.reduce((a, o) => a + o.price * o.oz, 0) / oz
          const target = s.long ? avg + OWL.target : avg - OWL.target
          if (s.long ? p >= target - EPS : p <= target + EPS) {
            realized += oz * (OWL.target - cost)
            closes++
            s.orders = []
            if (total(p) <= cautionAt) break
            s.orders.push({ price: target, oz: OWL.firstOz })
            continue
          }
          const lastOrder = s.orders[s.orders.length - 1]
          const next = s.long ? lastOrder.price - OWL.step : lastOrder.price + OWL.step
          if (s.long ? p <= next + EPS : p >= next - EPS) {
            s.orders.push({ price: next, oz: Math.min(OWL.maxOz, lastOrder.oz * OWL.factor) })
            continue
          }
          break
        }
      }
      const now = total(p)
      if (now < worst) worst = now
      if (now <= stopAt) return result(p, true)
    }
  return lastPrice == null
    ? { pnl: 0, stopped: false, closes: 0, worst: 0, maxOz: 0 }
    : result(lastPrice, false)
}
