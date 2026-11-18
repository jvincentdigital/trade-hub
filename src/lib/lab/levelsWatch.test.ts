import { describe, expect, it } from 'vitest'
import { TOL } from './levelsClock'
import { barsOf, ctxOf, type Row } from './levelsTestKit'
import {
  levelsContext,
  measureVisit,
  watch,
  type LevelsCtx,
  type Touch,
  type VisitMeasure,
  type Watcher,
} from './levelsWatch'

/** Monday 2015-01-05 12:00 UTC (07:00 New York): every test below stays inside that day. */
const T = Date.UTC(2015, 0, 5, 12) / 1000
const H = 3600

const line = (x: number, sides = 3, over: Partial<Watcher> = {}): Watcher => ({
  sides,
  first: 0,
  lifeEnd: 1e9,
  once: false,
  from: [0],
  lo: [x],
  hi: [x],
  turns: [0],
  shift: 0,
  knownFrom: NaN,
  ...over,
})

function visitsOf(ctx: LevelsCtx, w: Watcher) {
  const out: Touch[] = []
  const end = watch(ctx, { ...w, lifeEnd: Math.min(w.lifeEnd, ctx.n) }, (t) => out.push(t))
  return { v: out.map((t) => [t.touch, t.dir, t.end, t.endKind, t.near, t.far]), end }
}

describe('the watch (line at 100, ATR 10, g = 2.5: away below at 97.5, away above at 102.5)', () => {
  it('the first watched minute remembers nothing, so no visit starts in it', () => {
    // Minute 0 is away below and at the line; its away update counts from minute 1 on.
    const ctx = ctxOf(
      barsOf([
        [100.5, 97],
        [100, 99],
        [99, 98],
      ]),
    )
    expect(visitsOf(ctx, line(100)).v).toEqual([[1, 1, -1, 0, 100, 100]])
  })

  it('away and touch never in one minute; the end minute sets the memory', () => {
    const ctx = ctxOf(
      barsOf([
        [103, 102.6], // 0: away above
        [103, 97], // 1: touch from above (what was remembered before); no away update here
        [101, 98], // 2
        [102.5, 100.5], // 3: high >= near + g: a turn; away above remembered
        [100.5, 99.9], // 4: a new visit from above
        [100, 97.5], // 5: low <= far - g: a break; away below remembered
        [100, 99], // 6: a visit from below
      ]),
    )
    expect(visitsOf(ctx, line(100)).v).toEqual([
      [1, -1, 3, 1, 100, 100],
      [4, -1, 5, 2, 100, 100],
      [6, 1, -1, 0, 100, 100],
    ])
  })

  it('a minute both away below and away above clears the memory', () => {
    // A ceiling (from below only): above, then both (cleared), then nothing, then below, then a touch.
    const ctx = ctxOf(
      barsOf([
        [103, 102],
        [103, 97],
        [100, 99.5],
        [99, 97.5],
        [100, 99],
      ]),
    )
    expect(visitsOf(ctx, line(100, 1)).v).toEqual([[4, 1, -1, 0, 100, 100]])
  })

  it('an end minute that is both a turn and a break is a break, and remembers away above', () => {
    const ctx = ctxOf(
      barsOf([
        [99, 97],
        [100, 99],
        [102.5, 97.5],
        [100.1, 99.9],
      ]),
    )
    expect(visitsOf(ctx, line(100)).v).toEqual([
      [1, 1, 2, 2, 100, 100],
      [3, -1, -1, 0, 100, 100],
    ])
  })

  it('a band that widens during a visit leaves the visit edges alone; later visits use it', () => {
    // A ceiling [100, 100] that widens to [100, 104] from minute 3.
    const w = line(100, 1, { from: [0, 3], lo: [100, 100], hi: [100, 104], turns: [3, 4] })
    const ctx = ctxOf(
      barsOf([
        [99, 97],
        [100, 99],
        [101, 99],
        [102, 100],
        [102.5, 100],
        [100, 97],
        [100, 99],
      ]),
    )
    // Minute 4 breaks the visit's far edge 100 + 2.5 (the widened band would need 106.5).
    expect(visitsOf(ctx, w).v).toEqual([
      [1, 1, 4, 2, 100, 100],
      [6, 1, -1, 0, 100, 104],
    ])
    const turns: number[] = []
    watch(ctx, { ...w, lifeEnd: ctx.n }, (t) => turns.push(t.turns))
    expect(turns).toEqual([3, 4])
  })

  it('a two-turn zone armed while its visit is open: the visit runs on; the armed zone starts afresh', () => {
    const ctx = ctxOf(
      barsOf([
        [99, 97], // 0: away below
        [100.2, 99], // 1: the two-turn zone [100, 101] is touched
        [101, 99],
        [101.4, 99], // 3: armed from here ([100, 101.5]); the two-turn watch ends
        [101, 98],
        [104, 100], // 5: the two-turn visit breaks (>= 101 + 2.5); the armed zone is away above
        [99, 97.4], // 6: away below
        [100, 99], // 7: the armed zone's first visit
      ]),
    )
    const two = visitsOf(ctx, line(100, 1, { hi: [101], lifeEnd: 3 }))
    expect(two.v).toEqual([[1, 1, 5, 2, 100, 101]])
    expect(two.end.lastLive).toBe(2)
    const armed = visitsOf(ctx, line(100, 1, { hi: [101.5], first: 3 }))
    expect(armed.v).toEqual([[7, 1, -1, 0, 100, 101.5]])
  })

  it('a level life only decides when a visit may start', () => {
    // Life minutes 0 to 2; touched at 2; the visit ends at 4, after the life.
    const ctx = ctxOf(
      barsOf([
        [99, 97],
        [99, 98],
        [100, 99],
        [101, 99],
        [100, 97.5],
        [100, 99],
      ]),
    )
    expect(visitsOf(ctx, line(100, 3, { lifeEnd: 3 })).v).toEqual([[2, 1, 4, 1, 100, 100]])
  })

  it('a Fibonacci level or twin ends its life at the end of its own first visit', () => {
    const ctx = ctxOf(
      barsOf([
        [103, 102],
        [101, 100],
        [102.5, 101],
        [103, 102],
        [101, 100],
        [103, 100],
      ]),
    )
    const r = visitsOf(ctx, line(100, 2, { once: true }))
    expect(r.v).toEqual([[1, -1, 2, 1, 100, 100]])
    expect(r.end.lastLive).toBe(2)
    // The same line without the rule visits again at minute 4.
    expect(visitsOf(ctx, line(100, 2)).v.length).toBe(2)
  })

  it('Known from: the program stops if a level is watched before the time it became known', () => {
    const ctx = ctxOf(
      barsOf([
        [99, 97],
        [100, 99],
      ]),
    )
    expect(() => visitsOf(ctx, line(100, 3, { knownFrom: T + 1 }))).toThrow(/Known from/)
  })

  it('tolerance: a price within 1e-9 of a line is at the line', () => {
    const ctx = ctxOf(
      barsOf([
        [99, 97.5 + 5e-10],
        [100 - 5e-10, 99],
      ]),
    )
    expect(visitsOf(ctx, line(100)).v).toEqual([[1, 1, -1, 0, 100, 100]])
  })
})

const touchAt = (ctx: LevelsCtx, over: Partial<Touch>): Touch => ({
  touch: 0,
  dir: 1,
  near: 100,
  far: 100,
  atr: 10,
  g: 2.5,
  end: -1,
  endKind: 0,
  turns: 0,
  seq: 1,
  ...over,
})

describe('after a touch (ATR 10: d = 1, 2.5, 5, 10; P = far + 1)', () => {
  it('the race and its window bounds: stamped after t and earlier than t + 24 or 120 hours', () => {
    const b = barsOf(
      [
        [100, 100, 100], // t
        [100.5, 99.5, 100.25], // t + 60
        [100, 99, 99.5], // t + 24 h - 60: a turn at 0.10 (99 <= 100 - 1)
        [100, 97, 98], // t + 24 h: outside the 24-hour window (a turn at 0.25 otherwise)
        [110, 100, 105], // t + 120 h - 60: a break at 0.50 and at 1.00 (110 >= 100 + 10)
        [100, 100, 100], // t + 120 h
      ],
      [T, T + 60, T + 24 * H - 60, T + 24 * H, T + 120 * H - 60, T + 120 * H],
    )
    const ctx = ctxOf(b)
    const m = measureVisit(ctx, touchAt(ctx, {}))
    expect(m.race).toEqual([1, 0, 2, 2])
    expect(m.raceAt).toEqual([2, -1, 4, 4])
    // 15 and 60 minutes later: the close of t + 60 (100.25), above the far edge.
    expect([m.m15, m60(m)]).toEqual([2, 2])
    // How far: no break at 0.25 inside 24 hours; the lowest low after t inside it is 99.
    expect(m.howFar).toBe(1)
    expect(m.brk).toBe(-1)
    expect(m.run).toEqual([-1, -1, -1, -1])
  })

  it('a minute that both turns and breaks is a break; turn and break are tested on the near and far edges', () => {
    // A band [100, 102] from below: a turn at 0.10 is a low <= 99, a break a high >= 103.
    const ctx = ctxOf(
      barsOf([
        [100.5, 100],
        [103, 99],
        [100, 95],
      ]),
    )
    const m = measureVisit(ctx, touchAt(ctx, { far: 102 }))
    expect([m.race[0], m.raceAt[0]]).toEqual([2, 1])
    // At 0.25 (turn <= 97.5, break >= 104.5): the turn at minute 2.
    expect([m.race[1], m.raceAt[1]]).toEqual([1, 2])
  })

  it('fifteen and sixty minutes later: the close of the last candle stamped earlier; exactly at an edge is at', () => {
    const b = barsOf(
      [
        [100, 100, 100],
        [100, 99, 99],
        [104, 103, 103],
      ],
      [T, T + 840, T + 900],
    )
    const ctx = ctxOf(b)
    const m = measureVisit(ctx, touchAt(ctx, { far: 102 }))
    expect([m.m15, m.m60]).toEqual([1, 2])
    const at = (close: number, dir: 1 | -1) => {
      const c = ctxOf(
        barsOf([
          [100, 100, 100],
          [Math.max(close, 100), Math.min(close, 99), close],
        ]),
      )
      const v = dir === 1 ? { far: 102 } : { dir, near: 102, far: 100 }
      return measureVisit(c, touchAt(c, v as Partial<Touch>)).m15
    }
    // From below on [100, 102]: below the near edge back, above the far edge through, else at.
    expect([at(100, 1), at(99.5, 1), at(102, 1), at(102.5, 1), at(100 - 5e-10, 1)]).toEqual([
      0, 1, 0, 2, 0,
    ])
    // From above: near 102, far 100.
    expect([at(102.5, -1), at(99.5, -1), at(102, -1), at(100, -1)]).toEqual([1, 2, 0, 0])
  })

  it('how far: down to the lowest low before the minute of a break at 0.25 x ATR, not below zero', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 100],
        [100.5, 99.7],
        [102.5, 99],
        [100, 95],
      ]),
    )
    expect(measureVisit(ctx, touchAt(ctx, {})).howFar).toBeCloseTo(0.3, 12)
    const up = ctxOf(
      barsOf([
        [100, 100],
        [101, 100.5],
        [101, 100.2],
      ]),
    )
    expect(measureVisit(up, touchAt(up, {})).howFar).toBe(0)
    // From above (near 100 = the high edge): the highest high minus the near edge.
    const fromAbove = ctxOf(
      barsOf([
        [100, 100],
        [101.25, 100],
        [100, 97.5],
        [104, 100],
      ]),
    )
    expect(measureVisit(fromAbove, touchAt(fromAbove, { dir: -1 })).howFar).toBe(1.25)
  })

  it('the break minute (from t itself, through the visit end, inside 24 hours) and the run after it', () => {
    const ctx = ctxOf(
      barsOf([
        [101, 100], // t: high >= P = 101, the break minute
        [102, 100.5], // run at 0.10 (>= 102)
        [101, 98.5], // fail at 0.25 (<= 98.5)
        [106, 100], // run at 0.50 (>= 106)
        [100, 91], // fail at 1.00 (<= 91)
      ]),
    )
    const m = measureVisit(ctx, touchAt(ctx, { end: 1 }))
    expect(m.brk).toBe(0)
    expect(m.run).toEqual([1, 2, 1, 2])
    expect(m.runAt).toEqual([1, 2, 3, 4])
  })

  it('after a break: both in one minute is a fail; no break minute after the visit end or past 24 hours', () => {
    const both = ctxOf(
      barsOf([
        [101, 100],
        [102, 100],
      ]),
    )
    expect(measureVisit(both, touchAt(both, { end: 1 })).run[0]).toBe(2)
    const late = ctxOf(
      barsOf([
        [100, 100],
        [100, 98],
        [101, 100],
      ]),
    )
    expect(measureVisit(late, touchAt(late, { end: 1 })).brk).toBe(-1)
    expect(measureVisit(late, touchAt(late, { end: 2 })).brk).toBe(2)
    const day = ctxOf(
      barsOf(
        [
          [100, 100],
          [101, 100],
        ],
        [T, T + 24 * H],
      ),
    )
    expect(measureVisit(day, touchAt(day, { end: 1 })).brk).toBe(-1)
    // From above, P = far - 1.
    const dn = ctxOf(
      barsOf([
        [100, 100],
        [100, 99],
        [97, 96.5],
      ]),
    )
    const m = measureVisit(dn, touchAt(dn, { dir: -1, end: 2 }))
    expect([m.brk, m.run[0], m.run[1]]).toEqual([1, 1, 1])
  })
})

const m60 = (m: VisitMeasure) => m.m60

// ---------------------------------------------------------------- a literal reference

/** The watch read word for word, one minute at a time, for comparison with the fast watch. */
function literalWatch(ctx: LevelsCtx, w: Watcher): number[][] {
  const { high, low } = ctx.bars
  const out: number[][] = []
  let mem = 0
  let open: { dir: number; near: number; far: number; g: number; touch: number } | null = null
  let over = false
  for (let m = w.first; m < ctx.n && !over; m++) {
    let s = 0
    while (s + 1 < w.from.length && w.from[s + 1] <= m) s++
    const lo = w.lo[s] + w.shift
    const hi = w.hi[s] + w.shift
    const g = 0.25 * ctx.inForce[ctx.days.ofMinute[m]]
    if (open) {
      const o = open
      const brk = o.dir === 1 ? high[m] >= o.far + o.g - TOL : low[m] <= o.far - o.g + TOL
      const turn = o.dir === 1 ? low[m] <= o.near - o.g + TOL : high[m] >= o.near + o.g - TOL
      if (brk || turn) {
        out.push([o.touch, o.dir, m, brk ? 2 : 1])
        mem = brk === (o.dir === 1) ? 2 : 1
        open = null
        if (w.once) over = true
      }
      continue
    }
    if (m >= w.lifeEnd) break
    if (mem === 1 && w.sides & 1 && high[m] >= lo - TOL) {
      open = { dir: 1, near: lo, far: hi, g, touch: m }
      continue
    }
    if (mem === 2 && w.sides & 2 && low[m] <= hi + TOL) {
      open = { dir: -1, near: hi, far: lo, g, touch: m }
      continue
    }
    const b = low[m] <= lo - g + TOL
    const a = high[m] >= hi + g - TOL
    if (b && a) mem = 0
    else if (b) mem = 1
    else if (a) mem = 2
  }
  if (open) out.push([open.touch, open.dir, -1, 0])
  return out
}

/** The race, the 15-minute answer, how far and the break minute, read word for word. */
function literalMeasure(ctx: LevelsCtx, v: Touch) {
  const { high, low, close, time } = ctx.bars
  const t = time[v.touch]
  const s = v.dir
  const race: number[] = []
  for (const [d, hrs] of [
    [0.1, 24],
    [0.25, 24],
    [0.5, 120],
    [1, 120],
  ]) {
    let r = 0
    for (let m = v.touch + 1; m < ctx.n && time[m] < t + hrs * H; m++) {
      const brk = s === 1 ? high[m] >= v.far + d * v.atr - TOL : low[m] <= v.far - d * v.atr + TOL
      const turn =
        s === 1 ? low[m] <= v.near - d * v.atr + TOL : high[m] >= v.near + d * v.atr - TOL
      if (brk || turn) {
        r = brk ? 2 : 1
        break
      }
    }
    race.push(r)
  }
  let k = v.touch
  while (k + 1 < ctx.n && time[k + 1] < t + 900) k++
  const c = close[k]
  const m15 =
    s === 1
      ? c < v.near - TOL
        ? 1
        : c > v.far + TOL
          ? 2
          : 0
      : c > v.near + TOL
        ? 1
        : c < v.far - TOL
          ? 2
          : 0
  let ext = s === 1 ? Infinity : -Infinity
  for (let m = v.touch + 1; m < ctx.n && time[m] < t + 24 * H; m++) {
    const b25 =
      s === 1 ? high[m] >= v.far + 0.25 * v.atr - TOL : low[m] <= v.far - 0.25 * v.atr + TOL
    if (b25) break
    ext = s === 1 ? Math.min(ext, low[m]) : Math.max(ext, high[m])
  }
  const hf = s === 1 ? v.near - ext : ext - v.near
  let brk = -1
  const P = v.far + s * 0.1 * v.atr
  for (let m = v.touch; m < ctx.n && time[m] < t + 24 * H && (v.end < 0 || m <= v.end); m++)
    if (s === 1 ? high[m] >= P - TOL : low[m] <= P + TOL) {
      brk = m
      break
    }
  return { race, m15, howFar: hf > 0 ? hf : 0, brk }
}

describe('the fast watch against the plan read word for word', () => {
  it('finds the same visits and measures on random walks with gaps, bands that widen and daily ATRs', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let trial = 0; trial < 6; trial++) {
      const rows: Row[] = []
      const times: number[] = []
      let p = 100
      let t = T
      for (let i = 0; i < 4000; i++) {
        t += rnd() < 0.02 ? 3600 * Math.floor(1 + rnd() * 30) : 60
        p += (Math.floor(rnd() * 9) - 4) / 8
        const h = p + Math.floor(rnd() * 4) / 8
        const l = p - Math.floor(rnd() * 4) / 8
        rows.push([p, h, l, p])
        times.push(t)
      }
      const b = barsOf(rows, times)
      const base = levelsContext(b, 'EURUSD')
      const ctx: LevelsCtx = {
        ...base,
        inForce: Float64Array.from({ length: base.days.n }, () => 2 + Math.floor(rnd() * 16) / 2),
        f15: 0,
      }
      for (let k = 0; k < 25; k++) {
        const x = 100 + (Math.floor(rnd() * 64) - 32) / 4
        const w: Watcher = line(x, 1 + Math.floor(rnd() * 3), {
          first: Math.floor(rnd() * 500),
          lifeEnd: 1000 + Math.floor(rnd() * 3000),
          once: rnd() < 0.3,
          from: [0, 1500, 2500],
          lo: [x, x - 0.5, x - 0.5],
          hi: [x, x, x + 1],
          turns: [2, 3, 4],
          shift: rnd() < 0.5 ? 0 : 0.375,
        })
        const fast: Touch[] = []
        watch(ctx, w, (v) => fast.push(v))
        expect(fast.map((v) => [v.touch, v.dir, v.end, v.endKind])).toEqual(literalWatch(ctx, w))
        for (const v of fast) {
          const a = measureVisit(ctx, v)
          const r = literalMeasure(ctx, v)
          expect([a.race, a.m15, a.brk]).toEqual([r.race, r.m15, r.brk])
          expect(a.howFar).toBeCloseTo(r.howFar, 12)
        }
      }
    }
  })
})
