// Strategy lab: clock helpers (all times unix seconds, UTC). Pure, tested.

export const MIN = 60
export const HOUR = 3600
export const DAY = 86_400

export const dayStart = (t: number) => Math.floor(t / DAY) * DAY
/** Fractional UTC hour, 0 <= h < 24. */
export const utcHour = (t: number) => (t - dayStart(t)) / HOUR
/** 0 = Sunday ... 6 = Saturday (1970-01-01 was a Thursday). */
export const utcWeekday = (t: number) => (Math.floor(t / DAY) + 4) % 7

const bstCache = new Map<number, [number, number]>()

/** Last Sunday of a month (0-based), 01:00 UTC: when the UK clocks change. */
function lastSunday0100(year: number, month: number): number {
  const last = Date.UTC(year, month + 1, 0) / 1000
  return last - utcWeekday(last) * DAY + HOUR
}

/** True while London is on summer time (BST, UTC+1). */
export function londonSummer(t: number): boolean {
  const y = new Date(t * 1000).getUTCFullYear()
  let span = bstCache.get(y)
  if (!span) {
    span = [lastSunday0100(y, 2), lastSunday0100(y, 9)]
    bstCache.set(y, span)
  }
  return t >= span[0] && t < span[1]
}

/** London wall-clock hour (fractional). */
export const londonHour = (t: number) => (utcHour(t) + (londonSummer(t) ? 1 : 0)) % 24

/** The London session the "London only" bots trade: 08:00 to 16:00 London time. */
export const inLondonSession = (t: number) => {
  const h = londonHour(t)
  return h >= 8 && h < 16
}

/** Second Sunday of March 07:00 UTC to first Sunday of November 06:00 UTC: New York on summer time (EDT, UTC-4). */
const usCache = new Map<number, [number, number]>()
export function nySummer(t: number): boolean {
  const y = new Date(t * 1000).getUTCFullYear()
  let span = usCache.get(y)
  if (!span) {
    const mar1 = Date.UTC(y, 2, 1) / 1000
    const nov1 = Date.UTC(y, 10, 1) / 1000
    const firstSun = (d: number) => d + ((7 - utcWeekday(d)) % 7) * DAY
    span = [firstSun(mar1) + 7 * DAY + 7 * HOUR, firstSun(nov1) + 6 * HOUR]
    usCache.set(y, span)
  }
  return t >= span[0] && t < span[1]
}

/** New York offset from UTC in hours (-4 summer, -5 winter). */
export const nyOffset = (t: number) => (nySummer(t) ? -4 : -5)
/** London offset from UTC in hours (+1 summer, 0 winter). */
export const londonOffset = (t: number) => (londonSummer(t) ? 1 : 0)

/**
 * Session clock for "out by the end of the session" and the session
 * breakdown, on local time with daylight saving (UTC hours of the day of t):
 * Asia from 00:00 UTC (Tokyo 09:00, no daylight saving) to 08:00 London,
 * London to 09:00 New York, New York to 17:00 New York, Late to midnight UTC.
 * In US summer that is 00-07, 07-13, 13-21, 21-24 UTC; in winter 00-08,
 * 08-14, 14-22, 22-24.
 */
export function sessionHours(t: number) {
  const ldn = 8 - londonOffset(t)
  const nyOpen = 9 - nyOffset(t)
  const nyClose = 17 - nyOffset(t)
  return [
    { name: 'Asia', from: 0, to: ldn },
    { name: 'London', from: ldn, to: nyOpen },
    { name: 'New York', from: nyOpen, to: nyClose },
    { name: 'Late', from: nyClose, to: 24 },
  ] as const
}
export type SessionName = 'Asia' | 'London' | 'New York' | 'Late'

export function sessionOf(t: number): { name: SessionName; from: number; to: number } {
  const h = utcHour(t)
  const ss = sessionHours(t)
  return ss.find((s) => h >= s.from && h < s.to) ?? ss[3]
}

/** End of the session that `t` falls in. */
export const sessionEnd = (t: number) => dayStart(t) + sessionOf(t).to * HOUR

/** UTC season label for the season breakdown: UK summer time or winter time. */
export const seasonOf = (t: number): 'summer' | 'winter' => (londonSummer(t) ? 'summer' : 'winter')

export type Style = 'scalp' | 'day' | 'swing' | 'position' | 'race'

export const STYLE_WORDS: Record<Style, string> = {
  scalp:
    'scalp: entries until 16:00 New York, out by the end of the session it opened in (Asia at 08:00 London, London at 09:00 New York, New York at 17:00 New York)',
  day: 'day trade: entries until 16:00 New York, flat by 17:00 New York',
  swing: 'swing: held at most 5 days',
  position: 'position: held at most 30 days',
  race: 'as in the live race: stop or target only (at most 10 days)',
}

/** Last entry hour and flat hour, New York local time (daylight saving included). */
const LAST_ENTRY_NY = 16
const FLAT_NY = 17
export const SWING_DAYS = 5
const POSITION_DAYS = 30
const RACE_DAYS = 10

/** May a trade of this style open at `t`? Scalp and day: from 00:00 UTC to 16:00 New York. */
export const entryAllowed = (style: Style, t: number) =>
  style === 'scalp' || style === 'day' ? utcHour(t) < LAST_ENTRY_NY - nyOffset(t) : true

/** 17:00 New York on the UTC day of t, in unix seconds. */
const nyFlat = (t: number) => dayStart(t) + (FLAT_NY - nyOffset(t)) * HOUR

/** Latest time a trade of this style opened at `t` may still be open. */
export function deadlineFor(style: Style, t: number): number {
  switch (style) {
    case 'scalp':
      return Math.min(sessionEnd(t), nyFlat(t))
    case 'day':
      return nyFlat(t)
    case 'swing':
      return t + SWING_DAYS * DAY
    case 'position':
      return t + POSITION_DAYS * DAY
    case 'race':
      return t + RACE_DAYS * DAY
  }
}

/** "2026-03" for a time. */
export const monthKey = (t: number) => new Date(t * 1000).toISOString().slice(0, 7)

export const isoMinute = (t: number) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z'
