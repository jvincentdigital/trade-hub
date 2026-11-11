import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { loadCandleFile, mergeSundayBars } from './load'
import { londonSummer, deadlineFor, utcWeekday } from './time'

describe('history loader', () => {
  it('streams a gzipped CSV into candles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-'))
    const f = join(dir, 'X_1h.csv.gz')
    writeFileSync(
      f,
      gzipSync(
        'time,open,high,low,close,volume\n1762819200,1.31716,1.31728,1.31716,1.31723,22.09\n1762822800,1.3172,1.3175,1.317,1.3174,1\n',
      ),
    )
    expect(await loadCandleFile(f)).toEqual([
      { time: 1762819200, open: 1.31716, high: 1.31728, low: 1.31716, close: 1.31723 },
      { time: 1762822800, open: 1.3172, high: 1.3175, low: 1.317, close: 1.3174 },
    ])
    writeFileSync(f, gzipSync('time,open,high,low,close,volume\n2,1,1,1,1,0\n1,1,1,1,1,0\n'))
    await expect(loadCandleFile(f)).rejects.toThrow(/out of order/)
  })
  it('merges the short Sunday daily bar into Monday', () => {
    const sun = Date.UTC(2026, 10, 8) / 1000
    expect(utcWeekday(sun)).toBe(0)
    const out = mergeSundayBars([
      { time: sun - 2 * 86_400, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: sun, open: 1.4, high: 1.6, low: 1.3, close: 1.45 },
      { time: sun + 86_400, open: 1.45, high: 1.5, low: 1.2, close: 1.25 },
    ])
    expect(out).toEqual([
      { time: sun - 2 * 86_400, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: sun + 86_400, open: 1.4, high: 1.6, low: 1.2, close: 1.25 },
    ])
  })
})

describe('clock', () => {
  it('knows London summer time (last Sundays of March and October, 01:00 UTC)', () => {
    expect(londonSummer(Date.UTC(2026, 2, 29, 0, 59) / 1000)).toBe(false)
    expect(londonSummer(Date.UTC(2026, 2, 29, 1, 0) / 1000)).toBe(true)
    expect(londonSummer(Date.UTC(2026, 9, 25, 0, 59) / 1000)).toBe(true)
    expect(londonSummer(Date.UTC(2026, 9, 25, 1, 0) / 1000)).toBe(false)
  })
  it('swing trades last at most 5 days', () => {
    expect(deadlineFor('swing', 1000)).toBe(1000 + 5 * 86_400)
  })
})
