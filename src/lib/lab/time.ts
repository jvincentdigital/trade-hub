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

/** Session clock used for "out by the end of the session" and the session breakdown (UTC). */
export const SESSIONS = [
  { name: 'Asia', from: 0, to: 7 },
  { name: 'London', from: 7, to: 13 },
  { name: 'New York', from: 13, to: 21 },
  { name: 'Late', from: 21, to: 24 },
] as const
export type SessionName = (typeof SESSIONS)[number]['name']

export function sessionOf(t: number): (typeof SESSIONS)[number] {
  const h = utcHour(t)
  return SESSIONS.find((s) => h >= s.from && h < s.to) ?? SESSIONS[3]
}

/** End of the session that `t` falls in. */
export const sessionEnd = (t: number) => dayStart(t) + sessionOf(t).to * HOUR

export type Style = 'scalp' | 'day' | 'swing' | 'race'

export const STYLE_WORDS: Record<Style, string> = {
  scalp:
    'scalp: entries 00:00-20:00 UTC, out by the end of the session it opened in (Asia 07:00, London 13:00, New York 21:00 UTC)',
  day: 'day trade: entries 00:00-20:00 UTC, flat by 21:00 UTC',
  swing: 'swing: held at most 5 days',
  race: 'as in the live race: stop or target only (at most 10 days)',
}

const LAST_ENTRY_H = 20
const FLAT_H = 21
export const SWING_DAYS = 5
const RACE_DAYS = 10

/** May a trade of this style open at `t`? */
export const entryAllowed = (style: Style, t: number) =>
  style === 'scalp' || style === 'day' ? utcHour(t) < LAST_ENTRY_H : true

/** Latest time a trade of this style opened at `t` may still be open. */
export function deadlineFor(style: Style, t: number): number {
  switch (style) {
    case 'scalp':
      return Math.min(sessionEnd(t), dayStart(t) + FLAT_H * HOUR)
    case 'day':
      return dayStart(t) + FLAT_H * HOUR
    case 'swing':
      return t + SWING_DAYS * DAY
    case 'race':
      return t + RACE_DAYS * DAY
  }
}

/** "2026-03" for a time. */
export const monthKey = (t: number) => new Date(t * 1000).toISOString().slice(0, 7)

export const isoMinute = (t: number) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z'
