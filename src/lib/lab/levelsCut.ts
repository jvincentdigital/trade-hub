// Levels study (docs/levels-study.md, "How the numbers are checked", the cut
// test): which minutes are cut at, and what of a run is compared with the run
// on the whole file. For 40 minutes picked by a seeded generator over the
// choosing years and the markets (10 in the first hour of a day, 10 the first
// minute after a 4-hour close, one in the last two hours of 2018, the rest
// anywhere), the file is cut to the minutes stamped at or before the minute;
// the levels with their bands, each twin's price, the ATR in force, what each
// level and twin remembers, every open visit, and every visit, race and trade
// already decided ("settled by a minute at or before the cut, not by the end
// of the data") must equal the run on the whole file. Pure.

import type { Bars } from './harmonicFind'
import { mulberry32 } from './harmonicStudy'
import { nySecondOfDay } from './harmonicTrade'
import { buildFourHours } from './levelsClock'
import type { LevelRec, TradeRec, VisitRec } from './levelsRecord'
import type { SnapRec } from './levelsRun'
import { WINDOW_HOURS } from './levelsWatch'

const HOUR = 3600

/** The kinds of cut minute, with how many of each are drawn, in the order they are drawn. */
export const CUT_KINDS = [
  { name: 'first hour of a day', n: 10 },
  { name: 'first minute after a 4-hour close', n: 10 },
  { name: 'last two hours of 2018', n: 1 },
  { name: 'any minute', n: 19 },
] as const
export const CUT_SEED = 1
export const CUT_GENERATOR =
  'mulberry32 (src/lib/lab/harmonicStudy.ts) seeded with 1: for each kind in turn, each draw u picks minute floor(u x N) of the N such minutes of all markets (markets in the plan order, each in time order); a minute already picked for that kind is drawn again'

/**
 * The minutes (bar indices) of one market's file that each kind of cut may
 * fall on, inside [from, to): a New York clock time of 17:00 to 17:59 (the
 * first hour of a day, which starts at 17:00); the first minute of a 4-hour
 * candle after the file's first (the first minute stamped at or after a
 * 4-hour close); the minutes stamped less than two hours before the last
 * minute before `to` (the last two hours of 2018 that hold minutes); any.
 */
export function cutCandidates(bars: Bars, from: number, to: number): Int32Array[] {
  const inside = (i: number) => bars.time[i] >= from && bars.time[i] < to
  const a: number[] = []
  const all: number[] = []
  let last = -1
  for (let i = 0; i < bars.n; i++) {
    if (!inside(i)) continue
    all.push(i)
    last = i
    const s = nySecondOfDay(bars.time[i])
    if (s >= 17 * HOUR && s < 18 * HOUR) a.push(i)
  }
  const four = buildFourHours(bars)
  const b: number[] = []
  for (let c = 1; c < four.n; c++) if (inside(four.first[c])) b.push(four.first[c])
  const c: number[] = []
  if (last >= 0) for (const i of all) if (bars.time[i] > bars.time[last] - 2 * HOUR) c.push(i)
  return [a, b, c, all].map((x) => Int32Array.from(x))
}

export interface CutPick {
  /** Index into CUT_KINDS. */
  kind: number
  /** Index into the markets given. */
  market: number
  /** Position among that market's minutes of that kind. */
  pos: number
}

/** Draw the cut minutes from the counts of candidate minutes per market and kind ([market][kind]). */
export function pickCuts(
  counts: number[][],
  seed = CUT_SEED,
  gen: (seed: number) => () => number = mulberry32,
): CutPick[] {
  const rng = gen(seed)
  const out: CutPick[] = []
  const taken = new Set<string>()
  CUT_KINDS.forEach((k, kind) => {
    const total = counts.reduce((s, c) => s + c[kind], 0)
    if (total < k.n) throw new Error(`fewer than ${k.n} minutes for the cut kind "${k.name}"`)
    for (let n = 0; n < k.n; ) {
      let x = Math.floor(rng() * total)
      let market = 0
      while (x >= counts[market][kind]) x -= counts[market++][kind]
      const pick = { kind, market, pos: x }
      const key = `${market}|${kind}|${x}`
      if (taken.has(key)) continue
      taken.add(key)
      out.push(pick)
      n++
    }
  })
  return out
}

// ---------------------------------------------------------------- what is compared

/** The fields of a visit fixed at its touch (everything but the level's id and the day's range). */
const fixed = (v: VisitRec) => [
  v.kind,
  v.twin,
  v.set,
  v.what,
  v.knownFrom,
  v.side,
  v.touch,
  v.year,
  v.week,
  v.near,
  v.far,
  v.atr,
  v.turns,
  v.seq,
  v.leftOut,
]

/** Which visit a record is (its edges as numbers, exactly; both runs compute them the same way). */
export const visitKey = (v: VisitRec) =>
  [v.kind, v.twin, v.what, v.knownFrom, v.side, v.touch, v.near].join('|')

const U = '?'

/** A trade as far as it is decided by the cut T. */
function tradeView(x: TradeRec, T: number): unknown {
  if (x.done !== null && x.done <= T) return x
  if (x.status !== 'trade' || x.fill === null || x.fill > T) return U
  return {
    name: x.name,
    dir: x.dir,
    fill: x.fill,
    year: x.year,
    week: x.week,
    entry: x.entry,
    stop: x.stop,
    R: x.R,
    spread: x.spread,
    exits: x.exits.map((e) => (e.how !== 'end' && e.at <= T ? e : U)),
  }
}

/**
 * A visit as far as it is decided by the cut T: what was fixed at its touch,
 * and each outcome that a minute at or before T settled (the whole record when
 * its every outcome was). An outcome not yet decided is '?'. The level's id
 * and the range of the touch minute's day (a day still running at the cut)
 * are not part of it.
 */
export function visitView(v: VisitRec, T: number): unknown {
  const settled = v.done !== null && v.done <= T
  const W = (k: number) => WINDOW_HOURS[k] * HOUR
  const race = v.race.map((r, k) => {
    const at = v.raceAt[k]
    if (at !== null) return at <= T ? [r, at] : U
    return T >= v.touch + W(k) ? r : U
  })
  const brkDecided =
    v.brkAt !== null ? v.brkAt <= T : T >= v.touch + 24 * HOUR || (v.endAt !== null && v.endAt <= T)
  const run = v.run.map((r, k) => {
    if (!brkDecided || v.brkAt === null) return brkDecided ? r : U
    const at = v.runAt[k]
    if (at !== null) return at <= T ? [r, at] : U
    return T >= v.brkAt + W(k) ? r : U
  })
  const howFarDecided =
    settled ||
    T >= v.touch + 24 * HOUR ||
    (v.race[1] === 'break' && v.raceAt[1] !== null && v.raceAt[1] <= T)
  return {
    fixed: fixed(v),
    end: v.endAt !== null && v.endAt <= T ? [v.end, v.endAt] : U,
    race,
    m15: T >= v.touch + 15 * 60 ? v.m15 : U,
    m60: T >= v.touch + 60 * 60 ? v.m60 : U,
    howFar: howFarDecided ? v.howFar : U,
    brkAt: brkDecided ? v.brkAt : U,
    run,
    done: settled ? v.done : U,
    trades: v.trades.map((x) => tradeView(x, T)),
  }
}

/** JSON with non-finite numbers as null (as the runner saves records). */
export const canon = (x: unknown) =>
  JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))

/** Two 32-bit string hashes (FNV-1a and a second multiplier), for an order-free sum over many records. */
export function hash2(s: string): [number, number] {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
    b ^= b >>> 15
  }
  return [a >>> 0, b >>> 0]
}

/** An order-free fingerprint of a set of records: their number and two sums of hashes (exact in doubles). */
export class SetPrint {
  n = 0
  a = 0
  b = 0
  add(s: string) {
    const [x, y] = hash2(s)
    this.n++
    this.a += x
    this.b += y
  }
  same = (o: SetPrint) => this.n === o.n && this.a === o.a && this.b === o.b
}

/** Level records compared at a cut: the levels first watched at or before T, by kind, what and known-from time. */
export const levelKey = (l: LevelRec) => `${l.kind}|${l.what}|${l.knownFrom}`
export const levelView = (l: LevelRec) =>
  canon([l.firstWatched, l.year, l.low, l.high, l.atr, l.leftOut, l.sides, l.turns, l.twins])

/** A watcher's state at a cut: which one it is (round lines and grid lines by their price) and its band, memory and open visit. */
export const snapKey = (s: SnapRec) =>
  [s.at, s.kind, s.twin, s.what, s.knownFrom, s.side, s.knownFrom === null ? s.lo : ''].join('|')
export const snapView = (s: SnapRec) => canon([s.lo, s.hi, s.mem, s.open])

/**
 * Watchers the cut run may lack: round-number and grid lines with no open
 * visit. The lines watched are those within the file's price range, so a cut
 * file watches fewer far lines; a line of the whole file visited by the cut
 * would show as a visit in the whole-file run only.
 */
export const linesMayLack = (snaps: SnapRec[]) =>
  new Set(snaps.filter((s) => s.knownFrom === null && s.open === null).map(snapKey))

/**
 * Compare two keyed maps of views. `onlyWhole` may excuse a key found only in
 * the whole-file run (returns a reason, or null to count it as a difference).
 */
export function diffMaps(
  what: string,
  whole: Map<string, string>,
  cut: Map<string, string>,
  out: string[],
  onlyWhole: (key: string) => boolean = () => false,
): { compared: number; excused: number } {
  let compared = 0
  let excused = 0
  for (const [k, v] of whole) {
    const c = cut.get(k)
    if (c === undefined) {
      if (onlyWhole(k)) excused++
      else out.push(`${what} ${k}: in the whole-file run only`)
      continue
    }
    compared++
    if (c !== v) out.push(`${what} ${k}: whole ${v} / cut ${c}`)
  }
  for (const k of cut.keys()) if (!whole.has(k)) out.push(`${what} ${k}: in the cut run only`)
  return { compared, excused }
}

/** Map records to keyed views, failing on a repeated key. */
export function keyed<T>(
  recs: Iterable<T>,
  key: (r: T) => string,
  view: (r: T) => string,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of recs) {
    const k = key(r)
    if (m.has(k)) throw new Error(`cut test: two records share the key ${k}`)
    m.set(k, view(r))
  }
  return m
}
