/**
 * Levels study, the cut test's worker (docs/levels-study.md, "How the numbers
 * are checked"): started by `scripts/lab/levels-study.ts cut`, one per market
 * and phase. Phase 'count' sends back how many minutes of the choosing years
 * each kind of cut may fall on. Phase 'run' runs the engine on the whole file
 * and, for each cut minute, on the file cut to the minutes stamped at or
 * before it, and compares the two: the levels first watched by then, the ATR
 * in force, every watcher's band, memory and open visit after that minute,
 * and every visit of the levels, round numbers, twins and grid lines with its
 * races and trades as far as a minute at or before the cut decided them.
 * Offline, play money only; refuses a file with a bar from 2019 on.
 */
import type { Bars, HarmonicMarket } from '../../src/lib/lab/harmonicFind'
import { readMarket } from '../../src/lib/lab/harmonicLoad'
import { atrInForce, buildDays, runLevels, type VisitRec } from '../../src/lib/lab/levels'
import {
  canon,
  cutCandidates,
  diffMaps,
  keyed,
  levelKey,
  linesMayLack,
  levelView,
  SetPrint,
  snapKey,
  snapView,
  visitKey,
  visitView,
} from '../../src/lib/lab/levelsCut'

export interface CutJob {
  phase: 'count' | 'run'
  market: HarmonicMarket
  file: string
  /** The choosing years: [from, to) in UTC seconds; the file is refused if it holds a bar at or after `to`. */
  from: number
  to: number
  /** run: the picks of this market (kind and position among its candidates), with their order in the draw. */
  picks?: { order: number; kind: number; pos: number }[]
  /** run: keep every twin visit's view, to name differences one by one (heavy). */
  detail?: boolean
}

export interface CutResult {
  order: number
  kind: number
  market: HarmonicMarket
  at: number
  atr: [number, number]
  levels: number
  watchers: number
  linesOnlyWhole: number
  levelVisits: number
  twinVisits: number
  diffs: string[]
  nDiffs: number
}

export type CutReply =
  | { kind: 'count'; market: HarmonicMarket; counts: number[] }
  | { kind: 'run'; market: HarmonicMarket; results: CutResult[] }
  | { kind: 'error'; error: string }

const prefix = (b: Bars, n: number): Bars => ({
  n,
  time: b.time.slice(0, n),
  open: b.open.slice(0, n),
  high: b.high.slice(0, n),
  low: b.low.slice(0, n),
  close: b.close.slice(0, n),
})

const atrAtMinute = (b: Bars, i: number) => {
  const days = buildDays(b)
  return atrInForce(days)[days.ofMinute[i]]
}

async function load(job: CutJob): Promise<Bars> {
  const read = await readMarket(job.file, job.to, null)
  if (!('bars' in read))
    throw new Error(`${job.file} holds a bar stamped ${read.refusedAt}, at or after ${job.to}`)
  return read.bars
}

/** The whole-file run's views at each cut (levels, level visits, watchers, the ATR in force); twin visits go to `prints`. */
function wholeViews(
  bars: Bars,
  job: CutJob,
  picks: { i: number }[],
  Ts: number[],
  prints: SetPrint[],
  details: Map<string, string>[],
) {
  const view = (v: VisitRec, T: number) => canon(visitView(v, T))
  const whole = runLevels(bars, job.market, {
    snapshots: Ts,
    onTwinVisit: (v) =>
      Ts.forEach((T, k) => {
        if (v.touch > T) return
        const key = visitKey(v)
        const s = view(v, T)
        prints[k].add(key + s)
        if (job.detail) details[k].set(key + '|' + v.set, s)
      }),
  })
  const wholeAt = Ts.map((T, k) => {
    const snaps = whole.snaps.filter((s) => s.at === T)
    return {
      levels: keyed(
        whole.levels.filter((l) => l.firstWatched <= T),
        levelKey,
        levelView,
      ),
      visits: keyed(
        whole.visits.filter((v) => v.touch <= T),
        visitKey,
        (v) => view(v, T),
      ),
      snaps: keyed(snaps, snapKey, snapView),
      linesMayLack: linesMayLack(snaps),
      atr: atrAtMinute(bars, picks[k].i),
    }
  })
  return wholeAt
}

async function work(job: CutJob): Promise<CutReply> {
  const bars = await load(job)
  const cand = cutCandidates(bars, job.from, job.to)
  if (job.phase === 'count')
    return { kind: 'count', market: job.market, counts: cand.map((c) => c.length) }

  const picks = (job.picks ?? []).map((p) => ({ ...p, i: cand[p.kind][p.pos] }))
  const Ts = picks.map((p) => bars.time[p.i])
  const view = (v: VisitRec, T: number) => canon(visitView(v, T))

  // The whole file, once (its records are let go before the cut runs).
  const prints = Ts.map(() => new SetPrint())
  const details = Ts.map(() => new Map<string, string>())
  const wholeAt = wholeViews(bars, job, picks, Ts, prints, details)

  const results: CutResult[] = []
  picks.forEach((p, k) => {
    const T = Ts[k]
    const cutBars = prefix(bars, p.i + 1)
    const print = new SetPrint()
    const detail = new Map<string, string>()
    const run = runLevels(cutBars, job.market, {
      snapshots: [T],
      onTwinVisit: (v) => {
        const key = visitKey(v)
        const s = view(v, T)
        print.add(key + s)
        if (job.detail) detail.set(key + '|' + v.set, s)
      },
    })
    const w = wholeAt[k]
    const diffs: string[] = []
    const atr = atrAtMinute(cutBars, p.i)
    if (!(atr === w.atr || (Number.isNaN(atr) && Number.isNaN(w.atr))))
      diffs.push(`ATR in force: whole ${w.atr} / cut ${atr}`)
    const lv = diffMaps('level', w.levels, keyed(run.levels, levelKey, levelView), diffs)
    const sn = diffMaps('watcher', w.snaps, keyed(run.snaps, snapKey, snapView), diffs, (key) =>
      w.linesMayLack.has(key),
    )
    const vs = diffMaps(
      'visit',
      w.visits,
      keyed(run.visits, visitKey, (v) => view(v, T)),
      diffs,
    )
    if (!print.same(prints[k])) {
      diffs.push(
        `twin and grid-line visits: whole ${prints[k].n} (sums ${prints[k].a}, ${prints[k].b}) / cut ${print.n} (sums ${print.a}, ${print.b})`,
      )
      if (job.detail) diffMaps('twin visit', details[k], detail, diffs)
    }
    results.push({
      order: p.order,
      kind: p.kind,
      market: job.market,
      at: T,
      atr: [w.atr, atr],
      levels: lv.compared,
      watchers: sn.compared,
      linesOnlyWhole: sn.excused,
      levelVisits: vs.compared,
      twinVisits: print.n,
      diffs: diffs.slice(0, 25),
      nDiffs: diffs.length,
    })
  })
  return { kind: 'run', market: job.market, results }
}

process.on('message', (job: CutJob) => {
  work(job)
    .then((r) => process.send?.(r satisfies CutReply))
    .catch((e) =>
      process.send?.({
        kind: 'error',
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      } satisfies CutReply),
    )
})
process.on('disconnect', () => process.exit(0))
process.send?.({ kind: 'ready' })
