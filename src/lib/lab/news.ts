// Strategy lab: the high-impact ("red") news filter. Events come from
// news-high-impact.csv in the history folder (time_utc,currency,event,source_url).
// Pure, tested.

import { DAY, MIN, dayStart } from './time'

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
  block: 'no new trades 30 min either side of red news, open trades kept',
  close: 'no new trades 30 min either side of red news, open trades closed before it',
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

/** Sorted, merged blackout windows for a market's currencies. */
export function newsWindows(events: NewsEvent[], currencies: string[], mode: NewsMode): Window[] {
  if (mode === 'off') return []
  const raw = events
    .filter((e) => currencies.includes(e.currency))
    .map((e) =>
      mode === 'day'
        ? { from: dayStart(e.time), to: dayStart(e.time) + DAY }
        : { from: e.time - NEWS_PAD_SEC, to: e.time + NEWS_PAD_SEC },
    )
    .sort((a, b) => a.from - b.from)
  const out: Window[] = []
  for (const w of raw) {
    const last = out[out.length - 1]
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to)
    else out.push({ ...w })
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
