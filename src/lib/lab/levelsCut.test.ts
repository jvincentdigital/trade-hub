import { describe, expect, it } from 'vitest'
import type { Bars } from './harmonicFind'
import { mulberry32 } from './harmonicStudy'
import {
  canon,
  CUT_KINDS,
  cutCandidates,
  diffMaps,
  keyed,
  linesMayLack,
  pickCuts,
  SetPrint,
  snapKey,
  snapView,
  visitKey,
  visitView,
} from './levelsCut'
import type { VisitRec } from './levelsRecord'
import { runLevels } from './levelsRun'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 1000
const H = 3600

const flat = (times: number[]): Bars => ({
  n: times.length,
  time: Float64Array.from(times),
  open: new Float64Array(times.length).fill(1),
  high: new Float64Array(times.length).fill(1),
  low: new Float64Array(times.length).fill(1),
  close: new Float64Array(times.length).fill(1),
})

describe('cut minutes', () => {
  it('finds the first hour of a day, the first minute after a 4-hour close, the last two hours', () => {
    // New York = UTC-5: 16:59, 17:00, 17:30, 18:00, 21:00, 21:01 on Mon 2015-01-05.
    const b = flat([
      utc(2015, 1, 5, 21, 59),
      utc(2015, 1, 5, 22, 0),
      utc(2015, 1, 5, 22, 30),
      utc(2015, 1, 5, 23, 0),
      utc(2015, 1, 6, 2, 0),
      utc(2015, 1, 6, 2, 1),
    ])
    const c = cutCandidates(b, 0, Infinity).map((x) => Array.from(x))
    expect(c[0]).toEqual([1, 2])
    // 4-hour candles 13-17, 17-21, 21-01 New York: their first minutes after the file's first.
    expect(c[1]).toEqual([1, 4])
    // Stamped less than two hours before the last minute (02:01 UTC).
    expect(c[2]).toEqual([4, 5])
    expect(c[3]).toEqual([0, 1, 2, 3, 4, 5])
    // The span stops at 02:01: the last minute is 02:00, so the last two hours hold it alone.
    expect(Array.from(cutCandidates(b, 0, utc(2015, 1, 6, 2, 1))[2])).toEqual([4])
  })

  it('draws over all markets kind by kind, again on a repeat', () => {
    const seq = [0.5, 0.7, 0.5]
    let i = 0
    const gen = () => () => (i < seq.length ? seq[i++] : (i++ * 0.0137) % 1)
    const picks = pickCuts(
      [
        [100, 100, 2, 1000],
        [50, 50, 3, 500],
      ],
      1,
      gen,
    )
    // 150 first-hour minutes: 0.5 -> 75 (market 0); 0.7 -> 105 = market 1's 5th; 0.5 again is
    // drawn again: 3 x 0.0137 x 150 = 6.165 -> market 0's 6.
    expect(picks.slice(0, 3)).toEqual([
      { kind: 0, market: 0, pos: 75 },
      { kind: 0, market: 1, pos: 5 },
      { kind: 0, market: 0, pos: 6 },
    ])
    expect(picks.length).toBe(40)
    expect(CUT_KINDS.map((_, k) => picks.filter((p) => p.kind === k).length)).toEqual([
      10, 10, 1, 19,
    ])
  })
})

// A visit from below touched at t0, near 1.0, far 1.1; outcomes at stated minutes.
const t0 = utc(2015, 1, 6, 12)
const rec = (over: Partial<VisitRec> = {}): VisitRec => ({
  kind: 'PD',
  twin: 'level',
  set: -1,
  what: 'high',
  knownFrom: t0 - 10 * H,
  level: 7,
  side: 'below',
  touch: t0,
  year: 2015,
  week: 0,
  near: 1,
  far: 1.1,
  atr: 1,
  turns: 0,
  seq: 1,
  leftOut: false,
  dayRangeAtr: 1.2,
  end: 'turn',
  endAt: t0 + 2 * H,
  race: ['turn', 'turn', 'neither', 'break'],
  raceAt: [t0 + H, t0 + 2 * H, null, t0 + 50 * H],
  m15: 'at',
  m60: 'back',
  howFar: 0.4,
  brkAt: null,
  run: ['none', 'none', 'none', 'none'],
  runAt: [null, null, null, null],
  done: t0 + 120 * H,
  trades: [],
  ...over,
})

describe('what a cut has decided', () => {
  it('keeps only the outcomes settled by a minute at or before the cut', () => {
    const v = visitView(rec(), t0 + 90 * 60) as Record<string, unknown>
    expect(v.end).toEqual('?')
    expect(v.race).toEqual([['turn', t0 + H], '?', '?', '?'])
    expect([v.m15, v.m60, v.howFar, v.brkAt, v.done]).toEqual(['at', 'back', '?', '?', '?'])
    const w = visitView(rec(), t0 + 30 * H) as Record<string, unknown>
    // The 24-hour window is over: how far, and no break minute; the 120-hour races are not.
    expect(w.end).toEqual(['turn', t0 + 2 * H])
    expect(w.race).toEqual([['turn', t0 + H], ['turn', t0 + 2 * H], '?', '?'])
    expect([w.howFar, w.brkAt, w.run]).toEqual([0.4, null, ['none', 'none', 'none', 'none']])
    const x = visitView(rec(), t0 + 120 * H) as Record<string, unknown>
    expect(x.race).toEqual([
      ['turn', t0 + H],
      ['turn', t0 + 2 * H],
      'neither',
      ['break', t0 + 50 * H],
    ])
    expect(x.done).toBe(t0 + 120 * H)
  })

  it('is blind to the level id and the day range, and keys the visit', () => {
    const a = canon(visitView(rec(), t0 + 30 * H))
    expect(canon(visitView(rec({ level: 99, dayRangeAtr: 3 }), t0 + 30 * H))).toBe(a)
    expect(canon(visitView(rec({ near: 1.0000001 }), t0 + 30 * H))).not.toBe(a)
    expect(visitKey(rec())).toBe(`PD|level|high|${t0 - 10 * H}|below|${t0}|1`)
  })

  it('names differences and excuses only what it is told to', () => {
    const out: string[] = []
    const r = diffMaps(
      'x',
      new Map([
        ['a', '1'],
        ['b', '2'],
        ['far', '0'],
      ]),
      new Map([
        ['a', '1'],
        ['b', '3'],
        ['c', '4'],
      ]),
      out,
      (k) => k === 'far',
    )
    expect(r).toEqual({ compared: 2, excused: 1 })
    expect(out).toEqual(['x b: whole 2 / cut 3', 'x c: in the cut run only'])
    expect(() => keyed([1, 1], String, String)).toThrow()
  })
})

/** A random walk of one-minute Bid candles on EUR/USD from Mon 2015-01-05 00:00 UTC. */
function walk(days: number, seed: number): Bars {
  const rng = mulberry32(seed)
  const n = days * 1440
  const b: Bars = {
    n,
    time: new Float64Array(n),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
  }
  let p = 1.2
  for (let i = 0; i < n; i++) {
    const o = p
    p += (rng() - 0.5) * 0.0006
    b.time[i] = utc(2015, 1, 5) + 60 * i
    b.open[i] = o
    b.close[i] = p
    b.high[i] = Math.max(o, p) + rng() * 0.0001
    b.low[i] = Math.min(o, p) - rng() * 0.0001
  }
  return b
}

const cutTo = (b: Bars, n: number): Bars => ({
  n,
  time: b.time.slice(0, n),
  open: b.open.slice(0, n),
  high: b.high.slice(0, n),
  low: b.low.slice(0, n),
  close: b.close.slice(0, n),
})

describe('a cut run against the whole run', () => {
  const b = walk(28, 3)
  const cutAt = 24 * 1440 + 333
  const T = b.time[cutAt]
  const prints = (bars: Bars, snapshots: number[]) => {
    const p = new SetPrint()
    const run = runLevels(bars, 'EURUSD', {
      snapshots,
      onTwinVisit: (v) => {
        if (v.touch <= T) p.add(visitKey(v) + canon(visitView(v, T)))
      },
    })
    return {
      p,
      visits: keyed(
        run.visits.filter((v) => v.touch <= T),
        visitKey,
        (v) => canon(visitView(v, T)),
      ),
      snaps: keyed(
        run.snaps.filter((s) => s.at === T),
        snapKey,
        snapView,
      ),
      lack: linesMayLack(run.snaps.filter((s) => s.at === T)),
    }
  }
  const whole = prints(b, [T])

  it('agrees on a file cut at the minute', () => {
    const cut = prints(cutTo(b, cutAt + 1), [T])
    expect(whole.p.n).toBeGreaterThan(100)
    expect(cut.p.same(whole.p)).toBe(true)
    const out: string[] = []
    diffMaps('visit', whole.visits, cut.visits, out)
    const w = diffMaps('watcher', whole.snaps, cut.snaps, out, (k) => whole.lack.has(k))
    expect(out).toEqual([])
    expect(w.compared).toBeGreaterThan(100)
  })

  it('sees a price changed before the minute', () => {
    const c = cutTo(b, cutAt + 1)
    for (let i = cutAt - 600; i <= cutAt; i++) c.high[i] += 0.002
    const cut = prints(c, [T])
    const out: string[] = []
    diffMaps('visit', whole.visits, cut.visits, out)
    diffMaps('watcher', whole.snaps, cut.snaps, out, (k) => whole.lack.has(k))
    expect(cut.p.same(whole.p) && out.length === 0).toBe(false)
  })
})
