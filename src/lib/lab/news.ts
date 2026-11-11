// Strategy lab: the high-impact ("red") news filter. Events come from
// news-high-impact.csv in the history folder (time_utc,currency,event,source_url).
// Pure, tested.

import { DAY, HOUR, MIN, dayStart, nyOffset, utcWeekday } from './time'

export interface NewsEvent {
  time: number
  currency: string
  event: string
}

/** off: no filter. block: no new trades from 30 min before to 30 min after; open trades stay. close: the same, and open trades are closed before the window. day: no new trades on a day with red news (scalper combo). */
export type NewsMode = 'off' | 'block' | 'close' | 'day'
export const NEWS_MODES: NewsMode[] = ['off', 'block', 'close']

export const NEWS_WORDS: Record<NewsMode, string> = {
  off: 'no news filter',
  block:
    'no new trades 30 min either side of red news (BoJ: 02:00-04:30 and 06:00-07:00 UTC), open trades kept',
  close:
    'no new trades 30 min either side of red news (BoJ: 02:00-04:30 and 06:00-07:00 UTC), open trades closed before it',
  day: 'no new trades on a red-news day',
}

export const NEWS_PAD_SEC = 30 * MIN

export interface Window {
  from: number
  to: number
}

export function parseNewsCsv(text: string): NewsEvent[] {
  const out: NewsEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('time_utc')) continue
    const [iso, currency, event] = line.split(',')
    const time = Date.parse(iso) / 1000
    if (!Number.isFinite(time) || !currency) continue
    out.push({ time, currency, event: event ?? '' })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** The BoJ publishes no time: its statement lands about 02:30-04:30 UTC, the press conference about 06:00-07:00 UTC. */
const isBoj = (e: NewsEvent) => e.currency === 'JPY' && /BOJ/i.test(e.event)

/**
 * The span(s) one event blocks, padded `before` and `after` its time. A BoJ
 * decision has no fixed time, so it blocks 02:00-04:30 UTC (the statement)
 * and 06:00-07:00 UTC (the press conference) that day, whatever the pad.
 */
export function eventSpans(e: NewsEvent, before = NEWS_PAD_SEC, after = NEWS_PAD_SEC): Window[] {
  if (isBoj(e)) {
    const d = dayStart(e.time)
    return [
      { from: d + 2 * HOUR, to: d + 4.5 * HOUR },
      { from: d + 6 * HOUR, to: d + 7 * HOUR },
    ]
  }
  return [{ from: e.time - before, to: e.time + after }]
}

function merge(raw: Window[]): Window[] {
  raw.sort((a, b) => a.from - b.from)
  const out: Window[] = []
  for (const w of raw) {
    const last = out[out.length - 1]
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to)
    else out.push({ ...w })
  }
  return out
}

/** Sorted, merged blackout windows for a market's currencies. */
export function newsWindows(events: NewsEvent[], currencies: string[], mode: NewsMode): Window[] {
  if (mode === 'off') return []
  const mine = events.filter((e) => currencies.includes(e.currency))
  return merge(
    mine.flatMap((e) =>
      mode === 'day' ? [{ from: dayStart(e.time), to: dayStart(e.time) + DAY }] : eventSpans(e),
    ),
  )
}

/** Where spreads blow out around an event (the cost model): 5 minutes before to 15 after (BoJ: its whole windows). */
export const spikeWindows = (events: NewsEvent[], currencies: string[]): Window[] =>
  merge(
    events
      .filter((e) => currencies.includes(e.currency))
      .flatMap((e) => eventSpans(e, 5 * MIN, 15 * MIN)),
  )

/**
 * ISM Manufacturing PMI (first business day of the month) and ISM Services
 * PMI (third business day), 10:00 New York, which Forex Factory marks red.
 * The ISM calendar sits behind a captcha, so these come from the rule:
 * weekdays, skipping New Year's Day and Labor Day; another holiday shift can
 * put one a day off.
 */
export function ismEvents(from: number, to: number): NewsEvent[] {
  const out: NewsEvent[] = []
  const start = new Date(from * 1000)
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    const first = Date.UTC(y, m, 1) / 1000
    if (first > to) break
    const days: number[] = []
    for (let d = first; days.length < 3; d += DAY) {
      const wd = utcWeekday(d)
      const dt = new Date(d * 1000)
      const newYear = dt.getUTCMonth() === 0 && dt.getUTCDate() === 1
      const laborDay = dt.getUTCMonth() === 8 && wd === 1 && dt.getUTCDate() <= 7
      if (wd !== 0 && wd !== 6 && !newYear && !laborDay) days.push(d)
    }
    const at = (d: number) => d + (10 - nyOffset(d + 12 * HOUR)) * HOUR
    for (const [d, event] of [
      [days[0], 'ISM Manufacturing PMI (date by rule)'],
      [days[2], 'ISM Services PMI (date by rule)'],
    ] as const) {
      const t = at(d)
      if (t >= from && t <= to) out.push({ time: t, currency: 'USD', event })
    }
  }
  return out
}

/** Index of the first window that ends after `t`. */
function firstEndingAfter(ws: Window[], t: number): number {
  let lo = 0
  let hi = ws.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ws[mid].to <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** True when `t` is inside a window [from, to). */
export function inWindow(ws: Window[], t: number): boolean {
  const w = ws[firstEndingAfter(ws, t)]
  return !!w && w.from <= t
}

/** True when the span [from, to) touches a window. */
export function overlapsWindow(ws: Window[], from: number, to: number): boolean {
  const w = ws[firstEndingAfter(ws, from)]
  return !!w && w.from < to
}

/** Start of the first window that starts after `t` (Infinity if none). */
export function nextWindowStart(ws: Window[], t: number): number {
  for (let i = firstEndingAfter(ws, t); i < ws.length; i++) if (ws[i].from > t) return ws[i].from
  return Infinity
}
