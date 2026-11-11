// The race's trading day (John, 2026-11-11): new trades only from 02:00 to
// 12:30 Puerto Rico time (AST) on weekdays, and every open trade closes at the
// first race check at or after 12:45 AST, after the New York session. Plus the
// funded test's day, which starts at midnight in Prague like FTMO's. Pure,
// tested. Puerto Rico has no daylight saving: AST is UTC-4 all year.

const AST = -4 * 3600
const DAY = 86_400

/** First and last AST minute of the day a new trade may open (02:00 and 12:30). */
export const ENTRY_FROM = 2 * 60
export const ENTRY_TO = 12 * 60 + 30
/** The daily close: 12:45 AST. */
export const DAILY_CLOSE = 12 * 60 + 45

/** Weekday (0 Sunday) and minute of the day in Puerto Rico. */
export function astClockOf(sec: number): { weekday: number; minute: number } {
  const d = new Date((sec + AST) * 1000)
  return { weekday: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5

/** Why no new trade may open at `sec`, or null inside 02:00 to 12:30 AST on a weekday. */
export function entryWindowBlock(sec: number): string | null {
  const { weekday, minute } = astClockOf(sec)
  if (!isWeekday(weekday)) return 'no new trades on the weekend'
  if (minute < ENTRY_FROM || minute > ENTRY_TO) return 'new trades only from 02:00 to 12:30 AST'
  return null
}

/** The latest weekday 12:45 AST at or before `sec`, in Unix seconds. */
export function lastDailyClose(sec: number): number {
  const midnight = Math.floor((sec + AST) / DAY) * DAY - AST
  for (let back = 0; back < 7; back++) {
    const at = midnight - back * DAY + DAILY_CLOSE * 60
    if (at <= sec && isWeekday(astClockOf(at).weekday)) return at
  }
  return -Infinity // never: a week always has a weekday
}

/** True when a weekday 12:45 AST has passed since the check that did the last daily close. */
export const dailyCloseDue = (sec: number, lastCloseSec: number) =>
  lastDailyClose(sec) > lastCloseSec

// ── FTMO's day: midnight to midnight in Prague (CET, or CEST in summer) ──

const PRAGUE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Prague',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Seconds Prague is ahead of UTC at `sec`: 3600 in winter, 7200 in summer. */
function pragueOffset(sec: number): number {
  const p = Object.fromEntries(
    PRAGUE.formatToParts(new Date(sec * 1000)).map((x) => [x.type, Number(x.value)]),
  )
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - sec
}

/**
 * Midnight in Prague that starts the day holding `sec`, in Unix seconds:
 * 19:00 AST the evening before in winter, 18:00 AST in summer. The clocks
 * change at 02:00 or 03:00, so midnight keeps the offset from before the change.
 */
export function pragueDayStart(sec: number): number {
  const local = Math.floor((sec + pragueOffset(sec)) / DAY) * DAY
  return local - pragueOffset(local - pragueOffset(sec))
}

/** The next Prague midnight after `sec` (a day is 23 to 25 hours long). */
export const nextPragueDayStart = (sec: number) => pragueDayStart(pragueDayStart(sec) + 26 * 3600)

/** "2026-11-11": the Prague date of `sec`, for counting trading days. */
export const pragueDate = (sec: number) =>
  new Date((pragueDayStart(sec) + 12 * 3600) * 1000).toISOString().slice(0, 10)
