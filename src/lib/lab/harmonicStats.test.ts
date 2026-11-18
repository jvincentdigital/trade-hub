import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { loadBars } from './harmonicLoad'
import { weekOf, weeklyT, weekStart } from './harmonicStats'

const u = (m: number, d: number, h = 0, mi = 0) => Date.UTC(2015, m, d, h, mi) / 1000

describe('weeks', () => {
  it('run from Saturday 00:00 UTC to the next', () => {
    // 2015-01-03 was a Saturday.
    expect(weekOf(u(0, 3))).toBe(weekOf(u(0, 9, 23, 59)))
    expect(weekOf(u(0, 3))).toBe(weekOf(u(0, 2, 23, 59)) + 1)
    expect(weekOf(u(0, 10))).toBe(weekOf(u(0, 3)) + 1)
    expect(weekStart(u(0, 7, 12))).toBe(u(0, 3))
  })
  it('the weekly t-statistic: mean of weekly sums over sd (n - 1) / sqrt(n)', () => {
    // Weekly sums 1 (0.5 + 0.5), 2 and 3; an empty week between is left out.
    const t = weeklyT([
      { time: u(0, 5), r: 0.5 },
      { time: u(0, 9, 23), r: 0.5 },
      { time: u(0, 10), r: 2 },
      { time: u(0, 26), r: 3 },
    ])
    expect(t.weeks).toBe(3)
    expect(t.mean).toBe(2)
    expect(t.sd).toBe(1)
    expect(t.t).toBeCloseTo(2 * Math.sqrt(3), 12)
    expect(Number.isNaN(weeklyT([{ time: u(0, 5), r: 1 }]).t)).toBe(true)
    expect(weeklyT([]).weeks).toBe(0)
  })
})

describe('1-minute loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harmonic-'))
  const file = (name: string, text: string) => {
    const f = join(dir, name)
    writeFileSync(f, gzipSync(text))
    return f
  }
  const H = 'time,open,high,low,close,volume\n'

  it('streams a gzip CSV into typed arrays', async () => {
    const b = await loadBars(
      file('ok.csv.gz', H + '60,1.1,1.2,1.0,1.15,3\n120,1.15,1.16,1.1,1.12,0\n'),
    )
    expect(b.n).toBe(2)
    expect(b.time).toBeInstanceOf(Float64Array)
    expect([...b.time]).toEqual([60, 120])
    expect([...b.open]).toEqual([1.1, 1.15])
    expect([...b.high]).toEqual([1.2, 1.16])
    expect([...b.low]).toEqual([1.0, 1.1])
    expect([...b.close]).toEqual([1.15, 1.12])
  })
  it('refuses a malformed row or one out of order', async () => {
    const bad = async (name: string, text: string, re: RegExp) =>
      expect(loadBars(file(name, text))).rejects.toThrow(re)
    await bad('order.csv.gz', H + '120,1,1,1,1,0\n60,1,1,1,1,0\n', /out of order/)
    await bad('same.csv.gz', H + '120,1,1,1,1,0\n120,1,1,1,1,0\n', /out of order/)
    await bad('fields.csv.gz', H + '60,1,1,1,1\n', /fields/)
    await bad('nan.csv.gz', H + '60,1,x,1,1,0\n', /malformed/)
    await bad('empty.csv.gz', H + '60,1,,1,1,0\n', /malformed/)
    await bad('hilo.csv.gz', H + '60,1,0.9,0.8,0.85,0\n', /malformed/) // open above the high
    await bad('sec.csv.gz', H + '61,1,1,1,1,0\n', /malformed/) // not on a minute
    await bad('blank.csv.gz', H + '60,1,1,1,1,0\n\n120,1,1,1,1,0\n', /empty line/)
    await bad('header.csv.gz', 'time,o,h,l,c,v\n60,1,1,1,1,0\n', /header/)
  })
})
