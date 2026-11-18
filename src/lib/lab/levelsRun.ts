// Levels study (docs/levels-study.md): one market, one walk. Builds every
// level, its twins and the round numbers with their twin grids, watches them,
// measures every visit and its three trades, and hands back full records for
// the levels' visits and trades and sums for the twins (by pool, UTC year,
// side, and counting week or twin set). Pure: bars in, records out.

import { weekOf } from './harmonicStats'
import type { Bars, HarmonicMarket } from './harmonicFind'
import { buildFourHours, buildWeeks, nearRound } from './levelsClock'
import {
  addTrade,
  addVisit,
  CellMap,
  PLACEBO_SET,
  placeboFar,
  placeTwins,
  roundKind,
  TT_SIZE,
  TV,
  TWIN_SET_LABELS,
  utcYear,
  visitRec,
  type LevelRec,
  type Pool,
  type TwinSums,
  type VisitRec,
} from './levelsRecord'
import {
  buildZones,
  closedCandles,
  dayLevels,
  fibLevels,
  findLevelSwings,
  segmentAt,
  weekLevels,
  zoneLevels,
  type Level,
} from './levelsBuild'
import { visitTrades } from './levelsTrade'
import {
  levelsContext,
  measureVisit,
  watch,
  type LevelsCtx,
  type Snaps,
  type Touch,
  type Watcher,
} from './levelsWatch'

// ---------------------------------------------------------------- run

/** Zone lives in chart candles. */
export const ZONE_LIFE = { Z4: 540, ZD: 250 } as const

export interface RunOptions {
  /** Keep full records of twin visits (and grid lines) whose touch is in this UTC year. */
  listYear?: number
  /** UTC seconds: record each watcher's state after the last minute stamped at or before each. */
  snapshots?: number[]
  /** Skip the twins (levels and round numbers only). */
  noTwins?: boolean
  /** Called with the full record (its trades included) of every twin and grid-line visit, as it is found. */
  onTwinVisit?: (rec: VisitRec) => void
  /** Tests: watch these levels in place of the ones built from the bars. */
  levels?: Level[]
}

export interface SnapRec {
  /** The snapshot's minute (UTC second). */
  at: number
  kind: Pool
  twin: string
  what: string
  knownFrom: number | null
  /** Twins: 'below' for a lower twin, 'above' for an upper twin; levels and lines: ''. */
  side: string
  lo: number
  hi: number
  /** 0 nothing, 1 away below, 2 away above. */
  mem: number
  /** Touch minute (UTC second) of an open visit, or null. */
  open: number | null
}

export interface LevelsRun {
  market: HarmonicMarket
  /** UTC seconds of the first and last minute, and of the first minute of the 15th day. */
  first: number
  last: number
  fifteenth: number
  levels: LevelRec[]
  /** Visits of levels (every kind, two-turn zones and left-out levels included) and of round numbers. */
  visits: VisitRec[]
  twins: TwinSums
  /** listYear only: twin and grid-line visits of that year (no trades). */
  twinVisits: VisitRec[]
  snaps: SnapRec[]
  /** Watchers and visits counted per pool (levels and twins). */
  counts: {
    pool: Pool
    levels: number
    levelVisits: number
    twins: number
    twinVisits: number
    twinsLeftOut: number
  }[]
}

/** Every level of one market's file (not round numbers), in order of building. */
export function buildLevels(ctx: LevelsCtx): Level[] {
  const { bars, days, ix, n } = ctx
  const four = buildFourHours(bars)
  const weeks = buildWeeks(days)
  const sw4 = findLevelSwings(four.high, four.low, four.atr, closedCandles(four))
  const swD = findLevelSwings(days.high, days.low, days.atr, closedCandles(days))
  const levels: Level[] = []
  const push = (l: Omit<Level, 'id'>) => levels.push({ id: levels.length, ...l })
  dayLevels(days, push)
  weekLevels(days, weeks, push)
  zoneLevels(four, buildZones(four, sw4, ZONE_LIFE.Z4), 'Z4', n, push)
  zoneLevels(days, buildZones(days, swD, ZONE_LIFE.ZD), 'ZD', n, push)
  fibLevels(four, sw4, '4', ix, n, push)
  fibLevels(days, swD, 'D', ix, n, push)
  return levels
}

const asWatcher = (l: Level, first: number, shift: number, sides: number): Watcher => ({
  sides,
  first,
  lifeEnd: l.lifeEnd,
  once: l.once,
  from: l.from,
  lo: l.lo,
  hi: l.hi,
  turns: l.turns,
  shift,
  knownFrom: l.knownFrom,
})

/**
 * One market: every level, twin, round number and grid line, watched over the
 * whole file, with every visit measured and traded.
 */
export function runLevels(bars: Bars, market: HarmonicMarket, opt: RunOptions = {}): LevelsRun {
  const ctx = levelsContext(bars, market)
  const { n, f15, grid } = ctx
  const time = bars.time
  const pip = ctx.costs.pip
  const listYear = opt.listYear
  const snapAt = Int32Array.from(
    (opt.snapshots ?? [])
      .map((t) => {
        let lo = 0
        let hi = n
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (time[mid] <= t) lo = mid + 1
          else hi = mid
        }
        return lo - 1
      })
      .filter((i) => i >= 0)
      .sort((a, b) => a - b),
  )
  const snaps: SnapRec[] = []
  const snapHook = (id: Omit<SnapRec, 'at' | 'lo' | 'hi' | 'mem' | 'open'>): Snaps | undefined =>
    snapAt.length === 0
      ? undefined
      : {
          at: snapAt,
          put: (m, lo, hi, mem, open) =>
            snaps.push({ ...id, at: time[m], lo, hi, mem, open: open >= 0 ? time[open] : null }),
        }

  const levelRecs: LevelRec[] = []
  const visits: VisitRec[] = []
  const twinVisits: VisitRec[] = []
  const cv = { week: new CellMap(TV.size), set: new CellMap(TV.size), plc: new CellMap(TV.size) }
  const ct = { week: new CellMap(TT_SIZE), set: new CellMap(TT_SIZE) }
  const counts = new Map<
    Pool,
    {
      pool: Pool
      levels: number
      levelVisits: number
      twins: number
      twinVisits: number
      twinsLeftOut: number
    }
  >()
  const count = (p: Pool) => {
    let c = counts.get(p)
    if (!c) {
      c = { pool: p, levels: 0, levelVisits: 0, twins: 0, twinVisits: 0, twinsLeftOut: 0 }
      counts.set(p, c)
    }
    return c
  }

  // A twin visit: measured, traded and summed (and kept in full when in the list year).
  const twinVisit = (
    pool: Pool,
    set: number,
    v: Touch,
    id: Parameters<typeof visitRec>[4] | null,
  ) => {
    const ms = measureVisit(ctx, v)
    const tr = visitTrades(ctx, v)
    const t = time[v.touch]
    const year = utcYear(t)
    const week = weekOf(t)
    const side = v.dir
    const filled = tr[0].status === 'trade'
    addVisit(cv.week.get(pool, year, side, week, -1), v, ms, filled)
    addVisit(cv.set.get(pool, year, side, -1, set), v, ms, filled)
    if (set === PLACEBO_SET) addVisit(cv.plc.get(pool, year, side, week, 0), v, ms, filled)
    else if (placeboFar(set)) addVisit(cv.plc.get(pool, year, side, week, 1), v, ms, filled)
    for (let k = 0; k < 3; k++) {
      const x = tr[k]
      if (x.status !== 'trade') continue
      const ft = time[x.fill]
      const fy = utcYear(ft)
      addTrade(ct.week.get(pool, fy, side, weekOf(ft), -1), k, x, pip)
      addTrade(ct.set.get(pool, fy, side, -1, set), k, x, pip)
    }
    count(pool).twinVisits++
    if (id && opt.onTwinVisit) opt.onTwinVisit(visitRec(ctx, v, ms, tr, id))
    if (id && listYear !== undefined && year === listYear)
      twinVisits.push(visitRec(ctx, v, ms, null, id))
  }

  // ---- levels
  const levels = opt.levels ?? buildLevels(ctx)
  const watched: { l: Level; first: number; lastLive: number; atr: number }[] = []
  for (const l of levels) {
    const first = Math.max(l.start, f15)
    if (first >= l.lifeEnd || first >= n) continue
    if (time[first] < l.knownFrom)
      throw new Error('Known from: a level was built from a candle that closed after it')
    for (let k = 0; k < l.from.length; k++)
      if (l.built[k] > (k === 0 ? l.knownFrom : time[l.from[k]]))
        throw new Error(
          'Known from: a level was built from a candle that closed after the time it became known',
        )
    const s = segmentAt(l, first)
    const atr = ctx.inForce[ctx.days.ofMinute[first]]
    const leftOut = nearRound(grid, l.lo[s], l.hi[s], atr)
    const id = {
      kind: l.kind,
      twin: 'level',
      set: -1,
      what: l.what,
      knownFrom: l.knownFrom,
      level: l.id,
      leftOut,
    }
    const w = watch(
      ctx,
      asWatcher(l, first, 0, l.sides),
      (v) => visits.push(visitRec(ctx, v, measureVisit(ctx, v), visitTrades(ctx, v), id)),
      snapHook({ kind: l.kind, twin: 'level', what: l.what, knownFrom: l.knownFrom, side: '' }),
    )
    const c = count(l.kind)
    c.levels++
    c.levelVisits += w.visits
    watched.push({ l, first, lastLive: w.lastLive, atr })
    levelRecs.push({
      id: l.id,
      kind: l.kind,
      what: l.what,
      knownFrom: l.knownFrom,
      firstWatched: time[first],
      year: utcYear(time[first]),
      low: l.lo[s],
      high: l.hi[s],
      atr,
      leftOut,
      sides: l.sides,
      turns: l.turns[s],
      lastLive: time[w.lastLive],
      visits: w.visits,
      twins: 0,
    })
  }

  // ---- twins of the levels
  if (!opt.noTwins) {
    const byGroup = new Map<string, number[]>()
    watched.forEach((x, i) => {
      const g = byGroup.get(x.l.group)
      if (g) g.push(i)
      else byGroup.set(x.l.group, [i])
    })
    for (const idxs of byGroup.values()) {
      idxs.sort((a, b) => watched[a].first - watched[b].first || a - b)
      const active: number[] = []
      let next = 0
      for (const i of idxs) {
        const { l, first: f, atr } = watched[i]
        while (next < idxs.length && watched[idxs[next]].first <= f) active.push(idxs[next++])
        for (let k = active.length - 1; k >= 0; k--)
          if (watched[active[k]].lastLive < f) active.splice(k, 1)
        const others: [number, number][] = []
        for (const j of active) {
          if (j === i) continue
          const o = watched[j].l
          const s = segmentAt(o, f)
          others.push([o.lo[s], o.hi[s]])
        }
        const s = segmentAt(l, f)
        const c = count(l.kind)
        for (const t of placeTwins(grid, l.lo[s], l.hi[s], l.sides, atr, others)) {
          if (t.leftOut) {
            c.twinsLeftOut++
            continue
          }
          c.twins++
          levelRecs[i].twins++
          const { set, side, shift } = t
          const label = TWIN_SET_LABELS[set]
          const id = {
            kind: l.kind,
            twin: label,
            set,
            what: l.what,
            knownFrom: l.knownFrom,
            level: l.id,
            leftOut: levelRecs[i].leftOut,
          }
          watch(
            ctx,
            asWatcher(l, f, shift, side === 1 ? 1 : 2),
            (v) => twinVisit(l.kind, set, v, id),
            snapHook({
              kind: l.kind,
              twin: label,
              what: l.what,
              knownFrom: l.knownFrom,
              side: side === 1 ? 'below' : 'above',
            }),
          )
        }
      }
    }
  }

  // ---- round numbers and the twin grids
  if (f15 < n) {
    const lo = ctx.ix.minLow(f15, n)
    const hi = ctx.ix.maxHigh(f15, n)
    const k0 = Math.floor((lo * grid.unit) / grid.half) - 1
    const k1 = Math.ceil((hi * grid.unit) / grid.half) + 1
    const line = (x: number): Watcher => ({
      sides: 3,
      first: f15,
      lifeEnd: n,
      once: false,
      from: [f15],
      lo: [x],
      hi: [x],
      turns: [0],
      shift: 0,
      knownFrom: NaN,
    })
    for (let k = k0; k <= k1; k++) {
      const units = k * grid.half
      const x = units / grid.unit
      const kind = roundKind(grid, units)
      const id = {
        kind,
        twin: 'level',
        set: -1,
        what: '',
        knownFrom: null,
        level: -1,
        leftOut: false,
      }
      const w = watch(
        ctx,
        line(x),
        (v) => visits.push(visitRec(ctx, v, measureVisit(ctx, v), visitTrades(ctx, v), id)),
        snapHook({ kind, twin: 'level', what: '', knownFrom: null, side: '' }),
      )
      const c = count(kind)
      c.levels++
      c.levelVisits += w.visits
      if (opt.noTwins) continue
      for (let g = 0; g < grid.offsets.length; g++) {
        const y = (units + grid.offsets[g]) / grid.unit
        const label = grid.labels[g]
        const gid = {
          kind: 'RTW' as const,
          twin: label,
          set: g,
          what: '',
          knownFrom: null,
          level: -1,
          leftOut: false,
        }
        watch(
          ctx,
          line(y),
          (v) => twinVisit('RTW', g, v, gid),
          snapHook({ kind: 'RTW', twin: label, what: '', knownFrom: null, side: '' }),
        )
        count('RTW').twins++
      }
    }
  }

  return {
    market,
    first: time[0],
    last: time[n - 1],
    fifteenth: f15 < n ? time[f15] : NaN,
    levels: levelRecs,
    visits,
    twins: {
      visitsByWeek: cv.week.list(),
      visitsBySet: cv.set.list(),
      placebo: cv.plc.list(),
      tradesByWeek: ct.week.list(),
      tradesBySet: ct.set.list(),
    },
    twinVisits,
    snaps,
    counts: [...counts.values()],
  }
}
