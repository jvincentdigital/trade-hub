import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import {
  buildZones,
  dayLevels,
  fibLevels,
  findLevelSwings,
  segmentAt,
  weekLevels,
  zoneLevels,
  type Level,
  type LevelSwing,
} from './levelsBuild'
import { buildDays, buildWeeks, type NyChart } from './levelsClock'
import { MinuteIndex } from './levelsIndex'

const f64 = (a: number[]) => Float64Array.from(a)
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 1000

/** A hand-made chart of n candles: candle c holds minute c; it closes at 1000 x (c + 1). */
function chart(n: number, close: (c: number) => number, atr = 4): NyChart {
  const idx = Int32Array.from({ length: n }, (_, i) => i)
  return {
    n,
    start: f64(Array.from({ length: n }, (_, c) => 1000 * c)),
    stop: f64(Array.from({ length: n }, (_, c) => 1000 * (c + 1))),
    name: idx,
    open: f64(Array.from({ length: n }, (_, c) => close(c))),
    high: f64(Array.from({ length: n }, (_, c) => close(c))),
    low: f64(Array.from({ length: n }, (_, c) => close(c))),
    close: f64(Array.from({ length: n }, (_, c) => close(c))),
    first: idx,
    end: Int32Array.from({ length: n }, (_, i) => i + 1),
    ofMinute: idx,
    tr: new Float64Array(n),
    atr: new Float64Array(n).fill(atr),
  }
}

const high = (confirm: number, price: number): LevelSwing => ({
  kind: 1,
  idx: confirm - 1,
  price,
  confirm,
  next: 0,
})
const collect = () => {
  const out: Level[] = []
  return { out, push: (l: Omit<Level, 'id'>) => out.push({ id: out.length, ...l }) }
}

describe('swings of size 2', () => {
  const atr = f64(Array.from({ length: 30 }, (_, i) => (i < 13 ? NaN : 1)))
  it('confirm at the close of the candle 2 ATR back, from the 14th candle, inclusive', () => {
    // Candles 0 to 12: highs 10, lows 9.5. Candle 13: low 8 = 10 - 2 x 1, at the line.
    const hi = [...Array(13).fill(10), 10, 9, 9.75, 9.5, 12, 11, 10]
    const lo = [...Array(13).fill(9.5), 8, 7.75, 8, 9, 11, 10.5, 9.75]
    const s = findLevelSwings(f64(hi), f64(lo), atr, hi.length)
    // The high: candle 0 (on a tie the earlier stays), confirmed at 13; candidate low 8 at 13.
    expect(s[0]).toEqual({ kind: 1, idx: 0, price: 10, confirm: 13, next: 8 })
    // Candle 14 makes a lower low (7.75); candle 15's high 9.75 = 7.75 + 2 confirms it.
    expect(s[1]).toEqual({ kind: -1, idx: 14, price: 7.75, confirm: 15, next: 9.75 })
    // The high candidate 9.75 (candle 15) is beaten by 12 at 17; 12 - 2 = 10 >= the low 9.75 at 19.
    expect(s[2]).toEqual({ kind: 1, idx: 17, price: 12, confirm: 19, next: 9.75 })
    expect(s.length).toBe(3)
  })

  it('no swing before the 14th candle, and a candle that never closes confirms nothing', () => {
    const hi = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
    const lo = [10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
    expect(findLevelSwings(f64(hi), f64(lo), atr, 13).length).toBe(0)
    expect(findLevelSwings(f64(hi), f64(lo), atr, 14)[0].confirm).toBe(13)
  })
})

describe('zones from six swing highs (and a seventh)', () => {
  // ATR 4 everywhere: a band may be 2 wide; a ceiling dies at a close at or above its high edge + 1.
  // Closes are 90 except candle 24, which closes at 102.75.
  const c = chart(60, (i) => (i === 24 ? 102.75 : 90))
  const swings = [
    high(14, 100), // A [100, 100]
    high(16, 103), // A would be 3 wide: B [103, 103]
    high(18, 101.5), // both could take it, middles 1.5 away each: the older, A [100, 101.5], 2 turns
    high(20, 102), // A would be exactly 2 wide, middle 1.25 away; B's middle is 1 away: B [102, 103]
    high(22, 101), // A (0.25 away) against B (1.5 away): A, 3 turns, armed
    high(24, 101.25), // candle 24 closes at 102.75 >= 101.5 + 1: A dies first; then B [101.25, 103], armed
    high(26, 101), // B [101, 103], 4 turns
  ]
  const zones = buildZones(c, swings, 10)

  it('joins the nearest middle, the older on a tie, and dies at a close beyond or of old age', () => {
    expect(zones.length).toBe(2)
    const [A, B] = zones
    expect(A).toEqual({
      type: 1,
      turnAt: [14, 18, 22],
      lo: [100, 100, 100],
      hi: [100, 101.5, 101.5],
      death: 24,
    })
    // B's latest turn is at 26: it dies at the close of the 10th candle after it.
    expect(B).toEqual({
      type: 1,
      turnAt: [16, 20, 24, 26],
      lo: [103, 102, 101.25, 101],
      hi: [103, 103, 103, 103],
      death: 36,
    })
  })

  it('is a two-turn zone from its second turn, armed from its third (never before)', () => {
    const { out, push } = collect()
    zoneLevels(c, zones, 'Z4', 60, push)
    const brief = out.map((l) => [
      l.kind,
      l.knownFrom,
      l.start,
      l.lifeEnd,
      l.from,
      l.lo,
      l.hi,
      l.turns,
      l.sides,
    ])
    expect(brief).toEqual([
      // A: two turns from the close of 18 (minute 19) until its third turn's close (minute 23).
      ['Z4x2', 19000, 19, 23, [19], [100], [101.5], [2], 1],
      // A armed from the close of 22 until its death at the close of 24.
      ['Z4', 23000, 23, 25, [23], [100], [101.5], [3], 1],
      ['Z4x2', 21000, 21, 25, [21], [102], [103], [2], 1],
      // B armed at 24; the band widens from the first minute after 26's close.
      ['Z4', 25000, 25, 37, [25, 27], [101.25, 101], [103, 103], [3, 4], 1],
    ])
    expect(out.every((l) => l.what === 'ceiling')).toBe(true)
    expect(segmentAt(out[3], 26)).toBe(0)
    expect(segmentAt(out[3], 27)).toBe(1)
  })

  it('floors mirror it, and a close at or below the low edge - 0.25 x ATR kills one', () => {
    const f = chart(40, (i) => (i === 20 ? 99 : 110))
    const low = (confirm: number, price: number): LevelSwing => ({
      kind: -1,
      idx: confirm - 1,
      price,
      confirm,
      next: 0,
    })
    const z = buildZones(f, [low(14, 100), low(16, 101), low(18, 100.5)], 540)
    expect(z).toEqual([
      { type: -1, turnAt: [14, 16, 18], lo: [100, 100, 100], hi: [100, 101, 101], death: 20 },
    ])
  })
})

describe('Fibonacci levels', () => {
  // Candle c holds minute c. Swings: a high at 105 (the file's first: no levels), a low at 90
  // confirmed at 20 with the candidate high 96, a high at 110 confirmed at 25 with the
  // candidate low 100. Minute 30 reaches 110 again.
  const c = chart(40, () => 95)
  const mh = f64(Array.from({ length: 40 }, (_, i) => (i === 30 ? 110 : 100)))
  const ml = f64(Array.from({ length: 40 }, () => 95))
  const ix = new MinuteIndex(mh, ml, 40)
  const swings: LevelSwing[] = [
    { kind: 1, idx: 10, price: 105, confirm: 15, next: 92 },
    { kind: -1, idx: 18, price: 90, confirm: 20, next: 96 },
    { kind: 1, idx: 23, price: 110, confirm: 25, next: 100 },
  ]
  const { out, push } = collect()
  fibLevels(c, swings, '4', ix, 40, push)

  it('a down-leg gives ceilings at L + r x (H - L); a level the candidate already reached is not used', () => {
    const ceil = out.filter((l) => l.what.startsWith('ceiling'))
    // 0.382: 95.73 <= the candidate high 96, not used. 0.5: 97.5. 0.618: 99.27. J: 101.79 to 103.29.
    expect(ceil.map((l) => [l.kind, l.what])).toEqual([
      ['F4C', 'ceiling:0.5'],
      ['F4C', 'ceiling:0.618'],
      ['F4J', 'ceiling:J'],
    ])
    expect(ceil[0].lo[0]).toBe(97.5)
    expect(ceil[1].lo[0]).toBeCloseTo(99.27, 12)
    expect(ceil[2].lo[0]).toBeCloseTo(101.79, 12)
    expect(ceil[2].hi[0]).toBeCloseTo(103.29, 12)
    // Visited from below only; known at the close of 20; life until the next swing's close (25).
    expect(
      ceil.every(
        (l) => l.sides === 1 && l.knownFrom === 21000 && l.start === 21 && l.lifeEnd === 26,
      ),
    ).toBe(true)
  })

  it('an up-leg gives floors at H - r x (H - L); the candidate low at or below the high edge leaves it out', () => {
    const floor = out.filter((l) => l.what.startsWith('floor'))
    // 0.382: 102.36 and 0.5: 100 are at or above the candidate low 100: not used.
    expect(floor.map((l) => l.what)).toEqual(['floor:0.618', 'floor:J'])
    expect(floor[0].lo[0]).toBeCloseTo(97.64, 12)
    expect(floor[1].lo[0]).toBeCloseTo(92.28, 12)
    expect(floor[1].hi[0]).toBeCloseTo(94.28, 12)
    // From above only; no next swing; minute 30's high 110 >= H ends the life after that minute.
    expect(floor.every((l) => l.sides === 2 && l.start === 26 && l.lifeEnd === 31 && l.once)).toBe(
      true,
    )
    expect([floor[0].legHigh, floor[0].legLow]).toEqual([110, 90])
  })
})

describe('PD and PW', () => {
  const rows: [number, number, number, number, number][] = [
    [utc(2015, 1, 8, 17), 100, 101, 99, 100], // Thursday
    [utc(2015, 1, 9, 17), 100, 102, 98, 100], // Friday
    [utc(2015, 1, 9, 22), 100, 103, 100, 101], // Friday 17:00 NY: Monday's day
    [utc(2015, 1, 12, 17), 101, 101.5, 97, 100], // Monday
    [utc(2015, 1, 13, 17), 100, 100, 100, 100], // Tuesday
  ]
  const col = (k: number) => f64(rows.map((r) => r[k]))
  const b: Bars = {
    n: rows.length,
    time: col(0),
    open: col(1),
    high: col(2),
    low: col(3),
    close: col(4),
  }
  const days = buildDays(b)

  it('PD: the previous day high and low, live for the day, known from its close', () => {
    const { out, push } = collect()
    dayLevels(days, push)
    expect(out.map((l) => [l.what, l.lo[0], l.knownFrom, l.start, l.lifeEnd, l.sides])).toEqual([
      ['high', 101, utc(2015, 1, 8, 22), 1, 2, 3],
      ['low', 99, utc(2015, 1, 8, 22), 1, 2, 3],
      // Monday's day holds the weekend stub: its PD is Friday's, and it starts with the stub.
      ['high', 102, utc(2015, 1, 9, 22), 2, 4, 3],
      ['low', 98, utc(2015, 1, 9, 22), 2, 4, 3],
      ['high', 103, utc(2015, 1, 12, 22), 4, 5, 3],
      ['low', 97, utc(2015, 1, 12, 22), 4, 5, 3],
    ])
  })

  it('PW: the previous week high and low, live for the whole week, known from its last day close', () => {
    const { out, push } = collect()
    weekLevels(days, buildWeeks(days), push)
    expect(out.map((l) => [l.what, l.lo[0], l.knownFrom, l.start, l.lifeEnd])).toEqual([
      ['high', 102, utc(2015, 1, 9, 22), 2, 5],
      ['low', 98, utc(2015, 1, 9, 22), 2, 5],
    ])
  })
})
