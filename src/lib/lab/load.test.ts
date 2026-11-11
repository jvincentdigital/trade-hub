import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { loadCandleFile, nyCloseBars, utcBars } from './load'
import { deadlineFor, entryAllowed, londonSummer, nySummer, sessionOf } from './time'

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
  it('builds daily candles on the 17:00 New York close (no Sunday stub)', () => {
    // Sunday 2026-11-08 22:00 UTC (17:00 EST) to Monday 21:00 UTC: one Monday candle.
    const sun22 = Date.UTC(2026, 10, 8, 22) / 1000
    const h1 = Array.from({ length: 26 }, (_, i) => ({
      time: sun22 + i * 3600,
      open: 100 + i,
      high: 100.5 + i,
      low: 99.5 + i,
      close: 100.2 + i,
    }))
    const d = nyCloseBars(h1, 86_400)
    expect(d).toHaveLength(2)
    expect(d[0]).toEqual({ time: sun22, open: 100, high: 123.5, low: 99.5, close: 123.2 })
    expect(d[1].time).toBe(sun22 + 86_400)
    // Summer: the day starts at 21:00 UTC (17:00 EDT); 4h candles at 21, 01, 05 UTC...
    const jul = Date.UTC(2026, 6, 5, 21) / 1000
    const h = Array.from({ length: 9 }, (_, i) => ({
      time: jul + i * 3600,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }))
    expect(nyCloseBars(h, 4 * 3600).map((x) => x.time)).toEqual([
      jul,
      jul + 4 * 3600,
      jul + 8 * 3600,
    ])
  })
  it('builds UTC candles for Bitcoin', () => {
    const t = Date.UTC(2026, 6, 5, 22) / 1000
    const h = Array.from({ length: 4 }, (_, i) => ({
      time: t + i * 3600,
      open: i,
      high: i,
      low: i,
      close: i,
    }))
    expect(utcBars(h, 86_400).map((x) => x.time)).toEqual([
      Date.UTC(2026, 6, 5) / 1000,
      Date.UTC(2026, 6, 6) / 1000,
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
  it('knows New York summer time (second Sunday of March to first Sunday of November)', () => {
    expect(nySummer(Date.UTC(2026, 2, 8, 6, 59) / 1000)).toBe(false)
    expect(nySummer(Date.UTC(2026, 2, 8, 7, 0) / 1000)).toBe(true)
    expect(nySummer(Date.UTC(2026, 10, 1, 5, 59) / 1000)).toBe(true)
    expect(nySummer(Date.UTC(2026, 10, 1, 6, 0) / 1000)).toBe(false)
  })
  it('sessions and day-trade hours follow London and New York local time', () => {
    const jan = (h: number, m = 0) => Date.UTC(2026, 0, 14, h, m) / 1000
    const jul = (h: number, m = 0) => Date.UTC(2026, 6, 15, h, m) / 1000
    expect(sessionOf(jul(7)).name).toBe('London') // 08:00 BST
    expect(sessionOf(jan(7)).name).toBe('Asia') // 07:00 GMT
    expect(sessionOf(jan(13, 30)).name).toBe('London') // 08:30 EST
    expect(sessionOf(jan(21, 30)).name).toBe('New York') // 16:30 EST
    expect(deadlineFor('day', jul(10))).toBe(jul(21)) // 17:00 EDT
    expect(deadlineFor('day', jan(10))).toBe(jan(22)) // 17:00 EST
    expect(entryAllowed('day', jan(20, 30))).toBe(true) // 15:30 EST
    expect(entryAllowed('day', jul(20, 30))).toBe(false) // 16:30 EDT
  })
})
