import { LONDON_BREAKOUT } from '../race/londonBreakout'

// The London open strip on Today (docs/london-open.md). Times in UTC; Puerto
// Rico (AST) is UTC-4 all year. Session 06:00-11:00 UTC = 02:00-07:00 AST,
// weekdays: breakouts from 06:00 UTC (pre-open), Frankfurt opens 07:00 UTC
// (08:00 CET), London 08:00 UTC. Those are the winter hours; from late March
// both open an hour earlier (londonOnSummerTime). Pure, tested.

/** Markets on the "Pound & gold" tab: the London breakout's, plus GBP/JPY (the rules trade it). */
export const POUND_AND_GOLD: readonly string[] = [...LONDON_BREAKOUT.markets, 'GBP-JPY']

const H = 3_600_000
const DAY = 24 * H
const START_H = 6
const FRANKFURT_H = 7
const LONDON_H = 8
const BREAKOUT_END_H = 10
const END_H = 11
/** Show the countdown when the session starts within this long. */
const SOON = 12 * H

export type LondonStatus =
  | { phase: 'soon'; startsAt: number; frankfurtAt: number; opensAt: number }
  | { phase: 'preopen'; frankfurtAt: number; opensAt: number }
  | { phase: 'frankfurt'; opensAt: number }
  | { phase: 'open'; endsAt: number; breakoutsUntil: number }
  | null

const weekday = (dayStart: number) => {
  const d = new Date(dayStart).getUTCDay()
  return d >= 1 && d <= 5
}

/** Where we are around the London open, or null when it is far off (hide the strip). */
export function londonStatus(now: number): LondonStatus {
  const day = Math.floor(now / DAY) * DAY
  if (weekday(day)) {
    if (now >= day + START_H * H && now < day + FRANKFURT_H * H)
      return { phase: 'preopen', frankfurtAt: day + FRANKFURT_H * H, opensAt: day + LONDON_H * H }
    if (now >= day + FRANKFURT_H * H && now < day + LONDON_H * H)
      return { phase: 'frankfurt', opensAt: day + LONDON_H * H }
    if (now >= day + LONDON_H * H && now < day + END_H * H)
      return { phase: 'open', endsAt: day + END_H * H, breakoutsUntil: day + BREAKOUT_END_H * H }
  }
  for (let d = day; d <= day + 3 * DAY; d += DAY) {
    const start = d + START_H * H
    if (start > now && weekday(d))
      return start - now <= SOON
        ? {
            phase: 'soon',
            startsAt: start,
            frankfurtAt: d + FRANKFURT_H * H,
            opensAt: d + LONDON_H * H,
          }
        : null
  }
  return null
}

/** "5 h 27 min", "45 min", "1 min". */
export function untilText(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(min / 60)
  return h ? `${h} h ${min % 60} min` : `${min} min`
}

/** "2:00 AM" in Puerto Rico time, whatever the device's zone. */
export const astClock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/Puerto_Rico',
    hour: 'numeric',
    minute: '2-digit',
  })

const LONDON_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  hourCycle: 'h23',
})

/**
 * True while London is on summer time (BST, late March to late October). The
 * hours here are the winter ones (London opens 08:00 UTC = 4:00 AM AST); on
 * BST it opens 07:00 UTC = 3:00 AM AST and nothing has been moved yet.
 */
export const londonOnSummerTime = (ms: number) =>
  Number(LONDON_HOUR.format(ms)) !== new Date(ms).getUTCHours()

export const BST_NOTE =
  'London is on summer time: it opens an hour earlier (3:00 AM in Puerto Rico), but the London hours here have not moved yet (docs/london-open.md).'
