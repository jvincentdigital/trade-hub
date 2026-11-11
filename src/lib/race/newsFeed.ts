import { z } from 'zod'
import type { NewsEvent } from '../lab/news'

// The live red-news list for the race's lab bots: Forex Factory's free weekly
// feed (no key, no account), https://nfs.faireconomy.media/ff_calendar_thisweek.json.
// Only "High" impact rows count, as in the lab's list. The script caches it
// (scripts/race-io.ts, at most one download every 6 hours). Pure, tested.

export const FF_WEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'

const ffRowSchema = z.object({
  title: z.string(),
  country: z.string(),
  date: z.string(),
  impact: z.string(),
})

/** Red ("High") events from the feed, sorted; rows that do not parse are skipped. */
export function parseFfWeek(raw: unknown): NewsEvent[] {
  if (!Array.isArray(raw)) return []
  const out: NewsEvent[] = []
  for (const row of raw) {
    const r = ffRowSchema.safeParse(row)
    if (!r.success || r.data.impact !== 'High') continue
    const time = Date.parse(r.data.date) / 1000
    if (!Number.isFinite(time)) continue
    out.push({ time, currency: r.data.country.toUpperCase(), event: r.data.title })
  }
  return out.sort((a, b) => a.time - b.time)
}
