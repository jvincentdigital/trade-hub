import { describe, expect, it } from 'vitest'
import { inWindow, nextWindowStart, newsWindows, overlapsWindow, parseNewsCsv } from './news'

const CSV = `time_utc,currency,event,source_url
2025-03-07T13:30:00Z,USD,Non-Farm Employment Change (Employment Situation Feb 2025),https://x
2025-03-07T13:45:00Z,USD,Made-up second event,https://x
2025-03-12T12:30:00Z,USD,CPI m/m (CPI Feb 2025),https://x
2025-04-30T11:00:00Z,GBP,BOE Official Bank Rate,https://x
2025-05-01T03:00:00Z,JPY,BOJ Policy Rate,https://x
`
const t = (iso: string) => Date.parse(iso) / 1000

describe('news filter windows', () => {
  const ev = parseNewsCsv(CSV)
  it('parses the CSV', () => {
    expect(ev).toHaveLength(5)
    expect(ev[0]).toMatchObject({ time: t('2025-03-07T13:30:00Z'), currency: 'USD' })
  })
  it('30 minutes either side, only the pair currencies, overlapping windows merged', () => {
    const w = newsWindows(ev, ['GBP', 'USD'], 'block')
    expect(w).toEqual([
      { from: t('2025-03-07T13:00:00Z'), to: t('2025-03-07T14:15:00Z') },
      { from: t('2025-03-12T12:00:00Z'), to: t('2025-03-12T13:00:00Z') },
      { from: t('2025-04-30T10:30:00Z'), to: t('2025-04-30T11:30:00Z') },
    ])
    expect(newsWindows(ev, ['JPY'], 'close')).toHaveLength(1)
    expect(newsWindows(ev, ['USD'], 'off')).toEqual([])
  })
  it('day mode blocks the whole UTC day', () => {
    expect(newsWindows(ev, ['GBP'], 'day')).toEqual([
      { from: t('2025-04-30T00:00:00Z'), to: t('2025-05-01T00:00:00Z') },
    ])
  })
  it('answers inside, overlap and next start', () => {
    const w = newsWindows(ev, ['USD'], 'block')
    expect(inWindow(w, t('2025-03-07T12:59:00Z'))).toBe(false)
    expect(inWindow(w, t('2025-03-07T13:00:00Z'))).toBe(true)
    expect(inWindow(w, t('2025-03-07T14:15:00Z'))).toBe(false)
    // A 1h candle from 12:00 ends exactly at the window start: no overlap. From 12:30 it overlaps.
    expect(overlapsWindow(w, t('2025-03-07T12:00:00Z'), t('2025-03-07T13:00:00Z'))).toBe(false)
    expect(overlapsWindow(w, t('2025-03-07T12:30:00Z'), t('2025-03-07T13:30:00Z'))).toBe(true)
    expect(nextWindowStart(w, t('2025-03-08T00:00:00Z'))).toBe(t('2025-03-12T12:00:00Z'))
    expect(nextWindowStart(w, t('2025-04-01T00:00:00Z'))).toBe(Infinity)
  })
})
