/**
 * Levels study runner (docs/levels-study.md). Offline, play money only: reads
 * local 1-minute files, nothing else.
 *
 *   ./node_modules/.bin/tsx scripts/lab/levels-study.ts choose --data <dir> --out <dir> [--jobs N]
 *   ./node_modules/.bin/tsx scripts/lab/levels-study.ts check --data <dir> --choose <dir>/choose.json --out <dir> --commit <sha> [--jobs N]
 *   ./node_modules/.bin/tsx scripts/lab/levels-study.ts rehearse --data <dir> --out <dir> [--jobs N] [--seeds N]
 *   ./node_modules/.bin/tsx scripts/lab/levels-study.ts cut --data <dir> [--jobs N] [--detail]
 *
 * cut: the cut test ("How the numbers are checked") on the choosing years:
 * one line per cut minute, exit 1 on any difference (scripts/lab/levels-cut-worker.ts).
 * choose and check also run the placebos (Placebo 1 on the engine's placebo
 * cells, Placebo 2 on the shuffled days, src/lib/lab/levelsShuffle.ts) and read
 * a rule whose Placebo 2 lift lies outside 2.5 standard errors on the rest (the
 * plan's reading, "as written"). Amendment 1: they also run ten shuffled-days
 * and ten mirrored-minutes series (src/lib/lab/levelsMirror.ts), one at a time,
 * and read every rule on the rest against both (src/lib/lab/levelsBaseline.ts);
 * that reading decides, and a rule chosen under either reading goes to the
 * check. rehearse takes --seeds N (2 to 10) series of each kind; choose and
 * check refuse it.
 *
 * choose: the summary, Parts 1, 2, 3 and 5 and Part 4's choosing on 2005 to
 * 2018; refuses a file with any bar from 2019 on. check: "The check, once, on
 * 2019 to 2025"; refuses unless choose.json names a chosen rule or a pair
 * candidate, the tree is clean, HEAD is <sha> and on a remote branch,
 * choose.json was made by HEAD, the market files are the ones used for
 * choosing and the fixed marker does not exist; writes the marker before any
 * bar is read; stops before anything of 2019 on is saved if the visits and
 * trades settled by a minute of 2018 differ from the choosing run's. rehearse:
 * both inside the development years (choose 2005 to 2011, check 2012 to 2018),
 * through the same functions, with its own marker and no git test.
 * One worker per market (scripts/lab/levels-study-worker.ts), N at a time.
 */
import { execFileSync, fork } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createGunzip, createGzip } from 'node:zlib'
import { MARKET_COSTS, type HarmonicMarket } from '../../src/lib/lab/harmonicFind'
import { firstStampAtOrAfter } from '../../src/lib/lab/harmonicLoad'
import { gitTest, openCheck } from '../../src/lib/lab/harmonicCheckGate'
import {
  BOOT_DRAWS,
  BOOT_GENERATOR,
  DISTANCES,
  EXITS,
  lift,
  nyClockBucket,
  TRADE_NAMES,
  TT,
  TV,
  TWIN_SET_LABELS,
  type LevelRec,
  type TwinCell,
  type VisitRec,
} from '../../src/lib/lab/levels'
import {
  aheadOfSets,
  allOk,
  breakEvenRate,
  chooseBar,
  changeCorrelation,
  dayNameTime,
  inSpan,
  keepHalf,
  keepSpan,
  levelCells,
  levelLines,
  levelPoolOf,
  median,
  neitherMeasure,
  NOTHING_CHOSEN,
  ON_ROUND,
  p2Bar,
  pairBar,
  pctChanges,
  PLAN_KINDS,
  PLAN_MARKETS,
  rankByT,
  REAL_PERIODS,
  REHEARSAL_PERIODS,
  REPORT_KINDS,
  RULE_READINGS,
  ruleMeasure,
  RULES,
  ruleStats,
  runMeasure,
  runNote,
  shareMeasure,
  shownRates,
  spearman,
  tradeFacts,
  tradeLines,
  turnMeasure,
  twinCellsOf,
  twinPoolOf,
  unitsOf,
  verdict,
  VERDICTS,
  settledCellDiffs,
  settledVisitDiffs,
  halvesOf,
  type Cell,
  type Keep,
  type LevelPeriods,
  type Line,
  type Measure,
  type Rule,
  type RuleStats,
  type Span,
} from '../../src/lib/lab/levelsStudy'
import {
  ONLY_WIDE_TEXT,
  P1_POOLS,
  P2_CAUTIOUS,
  P2_CAUTIOUS_TEXT,
  P2_MEASURES,
  onlyWideDays,
  p2Outside,
  placebo1,
  restOf,
  type PlaceboRow,
  type RestStats,
} from '../../src/lib/lab/levelsPlacebo'
import { SHUFFLE_GENERATOR, SHUFFLE_SEED } from '../../src/lib/lab/levelsShuffle'
import {
  againstBoth,
  BASELINE_NAMES,
  BASELINE_SEEDS,
  baselineOf,
  baselineSeries,
  liftsOf,
  meanOutside,
  notSeenBeside,
  pairBarOnRest,
  rankBySmallerT,
  runNoteOnRest,
  smallestOnRest,
  spreadOf,
  SHUFFLES_GENERATOR,
  zoneSplitsLine,
  type BaselineKind,
  type BothReading,
  type Lifts,
  type RestReading,
  type Spread,
} from '../../src/lib/lab/levelsBaseline'
import { MIRROR_GENERATOR } from '../../src/lib/lab/levelsMirror'
import { CUT_GENERATOR, CUT_KINDS, pickCuts } from '../../src/lib/lab/levelsCut'
import type { LevelsJob, MarketRun, SeriesName, WorkerReply } from './levels-study-worker'
import type { CutJob, CutReply, CutResult } from './levels-cut-worker'

const REPO = resolve(__dirname, '../..')
/** The real check's one marker. No option moves it, so the check cannot run twice. */
export const LEVELS_MARKER = join(homedir(), '.local/share/trade-hub/levels-check/CHECK-RAN.json')

// ---------------------------------------------------------------- small helpers

const iso = (t: number) => new Date(t * 1000).toISOString()
const dayText = (t: number) => iso(t).slice(0, 10)
const spanText = ([a, b]: Span) => `${dayText(a)} to ${dayText(b - 86_400)}`

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
function need(name: string): string {
  const v = arg(name)
  if (!v) fail(`missing --${name}`)
  return v
}
function fail(msg: string): never {
  console.error(`levels-study: ${msg}`)
  process.exit(1)
}

const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function gitState() {
  const status = git('status', '--porcelain')
  return { clean: status === '', head: git('rev-parse', 'HEAD') }
}

/** Markets whose file is in `data`, in the plan's order; the others are named. */
function marketsIn(data: string) {
  const file = (m: HarmonicMarket) => join(data, `${m}_1m.csv.gz`)
  return {
    used: PLAN_MARKETS.filter((m) => existsSync(file(m))),
    missing: PLAN_MARKETS.filter((m) => !existsSync(file(m))),
    file,
  }
}

const fx = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? '-' : (x > 0 ? '+' : '') + x.toFixed(d)
const fn = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d)
const pc = (x: number) => (Number.isNaN(x) ? '-' : `${(100 * x).toFixed(1)}%`)
const yes = (b: boolean) => (b ? 'yes' : 'no')
function table(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}
const json = (x: unknown) =>
  JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))

// ---------------------------------------------------------------- workers

/** Run one worker per market, `jobs` at a time; fail the whole run if any fails. */
async function runWorkers(jobs: LevelsJob[], concurrency: number): Promise<MarketRun[]> {
  const results: MarketRun[] = []
  const errors: string[] = []
  let next = 0
  const one = (job: LevelsJob) =>
    new Promise<void>((ok) => {
      const p = fork(join(__dirname, 'levels-study-worker.ts'), [], {
        execArgv: ['--import', 'tsx'],
        serialization: 'advanced',
      })
      let settled = false
      p.on('message', (r: WorkerReply | { kind: 'ready' }) => {
        if (r.kind === 'ready') return void p.send(job)
        settled = true
        if (r.kind === 'done') results.push(r.result)
        else errors.push(`${job.market}: ${r.error}`)
        p.disconnect()
        ok()
      })
      p.on('exit', (code) => {
        if (!settled) {
          errors.push(`${job.market}: worker exited (${code})`)
          ok()
        }
      })
    })
  const lanes = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) await one(jobs[next++])
  })
  await Promise.all(lanes)
  if (errors.length) fail(`worker failed:\n${errors.join('\n')}`)
  return PLAN_MARKETS.flatMap((m) => results.filter((r) => r.market === m))
}

/** Refuse the run, before any worker starts, if a file holds a bar stamped at or after `from`. */
async function refuseLate(
  markets: HarmonicMarket[],
  file: (m: HarmonicMarket) => string,
  from: number,
) {
  const hits = await Promise.all(markets.map((m) => firstStampAtOrAfter(file(m), from)))
  const bad = markets
    .map((m, i) =>
      hits[i] === null
        ? ''
        : `${file(m)} holds a bar stamped ${iso(hits[i]!)}, at or after ${iso(from)}`,
    )
    .filter(Boolean)
  if (bad.length) fail(`refused:\n${bad.join('\n')}`)
}

// ---------------------------------------------------------------- the study's input

/** A level visit with its market. */
type MV = VisitRec & { market: HarmonicMarket }

/**
 * Everything the tables are counted from. `lv` and `lt` are the levels'
 * visit and trade cells (by pool, UTC year, side and counting week); `tv`,
 * `tt` the twins' by week, `tvSet`, `ttSet` by twin set. The real choice of
 * "what is the level" builds the level side from the level records; a
 * placebo builds another (Placebo 1: twin set 0.60 as the level against the
 * far sets) and runs the same tables.
 */
export interface Sides {
  lv: Cell[]
  lt: Cell[]
  tv: Cell[]
  tt: Cell[]
  tvSet: Cell[]
  ttSet: Cell[]
}

export interface StudyInput {
  markets: HarmonicMarket[]
  runs: MarketRun[]
  visits: MV[]
  sides: Sides
}

/** The choices of what is the level: 'real' is the plan's levels against their twins. */
export const LEVEL_CHOICES = {
  real: (runs: MarketRun[]): Sides => {
    const s: Sides = { lv: [], lt: [], tv: [], tt: [], tvSet: [], ttSet: [] }
    for (const r of runs) {
      const c = levelCells(r.market, r.run.visits)
      s.lv.push(...c.visits)
      s.lt.push(...c.trades)
      s.tv.push(...twinCellsOf(r.market, r.run.twins.visitsByWeek))
      s.tt.push(...twinCellsOf(r.market, r.run.twins.tradesByWeek))
      s.tvSet.push(...twinCellsOf(r.market, r.run.twins.visitsBySet))
      s.ttSet.push(...twinCellsOf(r.market, r.run.twins.tradesBySet))
    }
    return s
  },
}
export type LevelChoice = keyof typeof LEVEL_CHOICES

function studyInput(runs: MarketRun[], choice: LevelChoice = 'real'): StudyInput {
  return {
    markets: runs.map((r) => r.market),
    runs,
    visits: runs.flatMap((r) => r.run.visits.map((v) => ({ ...v, market: r.market }))),
    sides: LEVEL_CHOICES[choice](runs),
  }
}

const byPool = (cells: Cell[], pool: string) => cells.filter((c) => c.pool === pool)
const pipOf = (m: string) => MARKET_COSTS[m as HarmonicMarket].pip
const keepAnd =
  (a: Keep, b: Keep): Keep =>
  (m, y) =>
    a(m, y) && b(m, y)
const keepMarket =
  (market: string): Keep =>
  (m) =>
    m === market

// ---------------------------------------------------------------- Part 1

interface Part1Row {
  market: string
  kind: string
  year: number
  levels: number
  visits: number
  /** The race at 0.25 x ATR (24 hours). */
  turn: number
  break: number
  neither: number
  /** The visit's own end (turn, break, or still open at the end of the data). */
  endTurn: number
  endBreak: number
  endOpen: number
}

const PART1_KINDS = [
  ...REPORT_KINDS,
  ...PLAN_KINDS.filter((k) => k !== 'R00' && k !== 'R50').map((k) => k + ON_ROUND),
]

function part1(input: StudyInput, span: Span): Part1Row[] {
  const rows = new Map<string, Part1Row>()
  const row = (market: string, kind: string, year: number) => {
    const key = `${market}|${kind}|${year}`
    let r = rows.get(key)
    if (!r)
      rows.set(
        key,
        (r = {
          market,
          kind,
          year,
          levels: 0,
          visits: 0,
          turn: 0,
          break: 0,
          neither: 0,
          endTurn: 0,
          endBreak: 0,
          endOpen: 0,
        }),
      )
    return r
  }
  const keep = keepSpan(span)
  for (const r of input.runs)
    for (const l of r.run.levels as LevelRec[]) {
      if (!keep(r.market, l.year)) continue
      const pool = levelPoolOf({ twin: 'level', kind: l.kind, leftOut: l.leftOut })!
      row(r.market, pool, l.year).levels++
    }
  const lines = new Map<string, Set<number>>()
  for (const v of input.visits) {
    if (!keep(v.market, v.year)) continue
    const pool = levelPoolOf(v)!
    const r = row(v.market, pool, v.year)
    r.visits++
    if (v.race[1] === 'turn') r.turn++
    else if (v.race[1] === 'break') r.break++
    else r.neither++
    if (v.end === 'turn') r.endTurn++
    else if (v.end === 'break') r.endBreak++
    else r.endOpen++
    if (v.kind === 'R00' || v.kind === 'R50') {
      const key = `${v.market}|${v.kind}|${v.year}`
      if (!lines.has(key)) lines.set(key, new Set())
      lines.get(key)!.add(v.near)
    }
  }
  for (const [key, s] of lines) {
    const [m, k, y] = key.split('|')
    row(m, k, Number(y)).levels = s.size
  }
  const ko = (k: string) => PART1_KINDS.indexOf(k)
  return [...rows.values()].sort(
    (a, b) =>
      ko(a.kind) - ko(b.kind) ||
      PLAN_MARKETS.indexOf(a.market as HarmonicMarket) -
        PLAN_MARKETS.indexOf(b.market as HarmonicMarket) ||
      a.year - b.year,
  )
}

function part1Md(rows: Part1Row[], markets: string[]): string {
  const out: string[] = [
    'Levels (round numbers: lines visited that year), visits by touch year, and the race at 0.25 x ATR: turn / break / neither. Levels by the UTC year of their first watched minute.',
  ]
  for (const kind of PART1_KINDS) {
    const mine = rows.filter((r) => r.kind === kind)
    if (!mine.length) continue
    const ys = [...new Set(mine.map((r) => r.year))].sort((a, b) => a - b)
    out.push('', `**${kind.replace(ON_ROUND, ' on a round number (left out of its kind)')}**`, '')
    out.push(
      table(
        ['Year', ...markets],
        ys.map((y) => [
          y,
          ...markets.map((m) => {
            const r = mine.find((x) => x.market === m && x.year === y)
            return r ? `${r.levels} / ${r.visits}: ${r.turn}-${r.break}-${r.neither}` : '-'
          }),
        ]),
      ),
    )
  }
  return out.join('\n')
}

// ---------------------------------------------------------------- Part 2

interface Compare {
  n: number
  level: number
  twins: number
  lift: number
}

/** Level against twins on one measure (rates by cell, no weeks): the rates shown and the lift. */
function compare(
  level: Cell[],
  twin: Cell[],
  m: Measure,
  keep: Keep,
): Compare & { markets: Record<string, Compare> } {
  const s = shownRates(unitsOf(level, twin, m, keep, { byWeek: false }))
  const markets: Record<string, Compare> = {}
  for (const [k, v] of Object.entries(s.markets))
    markets[k] = { n: v.n, level: v.rate, twins: v.twinRate, lift: v.lift }
  return { n: s.n, level: s.rate, twins: s.twinRate, lift: s.lift, markets }
}

interface Part2Row {
  scope: string
  visits: number
  turn: Compare[]
  /** Average size of each distance in pips (d x ATR). */
  sizePips: number[]
  neither: Compare[]
  back15: Compare
  back60: Compare
  howFarPips: { median: number; mean: number; twinsMean: number }
  howFarAtr: { median: number; mean: number; twinsMean: number }
  run: Compare[]
}

const MEASURES = {
  turn: [0, 1, 2, 3].map(turnMeasure),
  neither: [0, 1, 2, 3].map(neitherMeasure),
  run: [0, 1, 2, 3].map(runMeasure),
  back15: shareMeasure(TV.back15),
  back60: shareMeasure(TV.back60),
  t0Fill: shareMeasure(TV.t0Fill),
}

const meanOf = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN)
const plainMean = (v: number[]) => meanOf(v.filter((x) => !Number.isNaN(x)))

function part2Row(
  scope: string,
  markets: string[],
  level: Cell[],
  twin: Cell[],
  recs: MV[],
  keep: Keep,
): Part2Row {
  const pick = (c: Compare & { markets: Record<string, Compare> }): Compare => ({
    n: c.n,
    level: c.level,
    twins: c.twins,
    lift: c.lift,
  })
  const cmp = (m: Measure) => pick(compare(level, twin, m, keep))
  const perMarket = (f: (m: string) => number) => plainMean(markets.map(f))
  const lvIn = level.filter((c) => keep(c.market, c.year))
  const twIn = twin.filter((c) => keep(c.market, c.year))
  const sum = (cells: Cell[], m: string, field: number) =>
    cells.filter((c) => c.market === m).reduce((s, c) => s + c.v[field], 0)
  const visits = lvIn.reduce((s, c) => s + c.v[TV.n], 0)
  const sizePips = DISTANCES.map((d) =>
    perMarket((m) => {
      const n = sum(lvIn, m, TV.n)
      return n ? (d * sum(lvIn, m, TV.atr)) / n / pipOf(m) : NaN
    }),
  )
  const recIn = recs.filter((v) => keep(v.market, v.year))
  const hf = (atr: boolean) => {
    const byM = (m: string) =>
      recIn.filter((v) => v.market === m).map((v) => (atr ? v.howFar / v.atr : v.howFar / pipOf(m)))
    return {
      median: perMarket((m) => median(byM(m))),
      mean: perMarket((m) => meanOf(byM(m))),
      twinsMean: perMarket((m) => {
        const n = sum(twIn, m, TV.n)
        return n ? sum(twIn, m, atr ? TV.howFarAtr : TV.howFar) / n / (atr ? 1 : pipOf(m)) : NaN
      }),
    }
  }
  return {
    scope,
    visits,
    turn: MEASURES.turn.map(cmp),
    sizePips,
    neither: MEASURES.neither.map(cmp),
    back15: cmp(MEASURES.back15),
    back60: cmp(MEASURES.back60),
    howFarPips: hf(false),
    howFarAtr: hf(true),
    run: MEASURES.run.map(cmp),
  }
}

/** A split's level cells: the visits of `pool` that `pred` keeps. */
function splitCells(input: StudyInput, pool: string, pred: (v: MV) => boolean): Cell[] {
  const out: Cell[] = []
  for (const m of input.markets) {
    const recs = input.visits.filter((v) => v.market === m && levelPoolOf(v) === pool && pred(v))
    out.push(...levelCells(m, recs).visits)
  }
  return out
}

interface SplitRow {
  split: string
  value: string
  visits: number
  turn: Compare[]
  run: Compare[]
  back15: Compare
}

function part2(input: StudyInput, span: Span) {
  const keep = keepSpan(span)
  const { lv, tv, tvSet } = input.sides
  const kinds: Record<string, { all: Part2Row; markets: Part2Row[]; splits: SplitRow[] }> = {}
  for (const kind of REPORT_KINDS) {
    const level = byPool(lv, kind)
    const twin = byPool(tv, twinPoolOf(kind))
    const recs = input.visits.filter((v) => levelPoolOf(v) === kind)
    const all = part2Row('ALL', input.markets, level, twin, recs, keep)
    const markets = input.markets.map((m) =>
      part2Row(m, [m], level, twin, recs, keepAnd(keep, keepMarket(m))),
    )
    const splits: SplitRow[] = []
    const split = (name: string, value: string, cells: Cell[], twinCells = twin) => {
      const cmp = (m: Measure) => {
        const c = compare(cells, twinCells, m, keep)
        return { n: c.n, level: c.level, twins: c.twins, lift: c.lift }
      }
      splits.push({
        split: name,
        value,
        visits: cells.filter((c) => keep(c.market, c.year)).reduce((s, c) => s + c.v[TV.n], 0),
        turn: MEASURES.turn.map(cmp),
        run: MEASURES.run.map(cmp),
        back15: cmp(MEASURES.back15),
      })
    }
    const sub = (pred: (v: MV) => boolean) => splitCells(input, kind, pred)
    for (const side of ['below', 'above'] as const)
      split(
        'side',
        side,
        sub((v) => v.side === side),
      )
    split(
      'visit',
      'first',
      sub((v) => v.seq === 1),
    )
    split(
      'visit',
      'later',
      sub((v) => v.seq > 1),
    )
    const clocks = ['17:00 to 02:59', '03:00 to 07:59', '08:00 to 11:59', '12:00 to 16:59']
    clocks.forEach((c, i) =>
      split(
        'New York clock',
        c,
        sub((v) => nyClockBucket(v.touch) === i),
      ),
    )
    if (kind === 'Z4' || kind === 'ZD') {
      split(
        'turns',
        'three',
        sub((v) => v.turns === 3),
      )
      split(
        'turns',
        'four or more',
        sub((v) => v.turns >= 4),
      )
    }
    if (kind === 'F4C' || kind === 'FDC')
      for (const r of ['0.382', '0.5', '0.618'])
        split(
          'ratio',
          r,
          sub((v) => v.what.endsWith(':' + r)),
        )
    if (kind !== 'R00' && kind !== 'R50' && !kind.endsWith('x2'))
      split(
        'on a round number',
        'left out',
        splitCells(input, kind + ON_ROUND, () => true),
      )
    const twSet = byPool(tvSet, twinPoolOf(kind))
    const nSets = twinPoolOf(kind) === 'RTW' ? 41 : 46
    for (let s = 0; s < nSets; s++)
      split(
        twinPoolOf(kind) === 'RTW' ? 'twin grid (pips, gold $)' : 'twin set',
        twinPoolOf(kind) === 'RTW' ? `grid ${s}` : TWIN_SET_LABELS[s],
        level,
        twSet.filter((c) => c.set === s),
      )
    kinds[kind] = { all, markets, splits }
  }
  return kinds
}

const cmpText = (c: Compare) => (c.n ? `${fn(c.level)} / ${fn(c.twins)}` : '-')

function part2Md(p2: ReturnType<typeof part2>): string {
  const out: string[] = [
    "Rates in points out of 100, the level / the twins (the twins' rate is the average of the rates the level's visits were measured against, so the two differ by the lift). Turn: at each distance, with the distance's average size in pips and the share of visits that ended neither (level / twins). Back: the Bid close 15 and 60 minutes later below the near edge. How far: median / mean in pips (twins: mean only). Run: the run rate after a break. A kind's numbers are the plain averages of its markets'. The splits by side, first and later visits, New York clock, turns, Fibonacci ratio, levels on a round number and each twin set are in part2.json.",
  ]
  for (const kind of REPORT_KINDS) {
    const k = p2[kind]
    out.push('', `### ${kind}`, '')
    out.push(
      table(
        [
          'Market',
          'Visits',
          ...DISTANCES.map((d) => `Turn ${d.toFixed(2)}`),
          'Back 15 min',
          'Back 60 min',
          'How far (pips)',
          'Run 0.25',
          'Run 1.00',
        ],
        [k.all, ...k.markets].map((r) => [
          r.scope,
          r.visits,
          ...r.turn.map(
            (c, i) =>
              `${cmpText(c)} (${fn(r.sizePips[i])} p; neither ${fn(r.neither[i].level)} / ${fn(r.neither[i].twins)})`,
          ),
          cmpText(r.back15),
          cmpText(r.back60),
          `${fn(r.howFarPips.median)} / ${fn(r.howFarPips.mean)} (twins ${fn(r.howFarPips.twinsMean)})`,
          cmpText(r.run[1]),
          cmpText(r.run[3]),
        ]),
      ),
    )
  }
  return out.join('\n')
}

// ---------------------------------------------------------------- Part 3

interface Part3Cell {
  trade: string
  exit: string
  trades: number
  targetShare: number
  twinsTargetShare: number
  breakEven: number
  beforePips: number
  beforeR: number
  afterPips: number
  afterR: number
  weeklyT: number
  gap: number
  gapT: number
  ahead: number
  of: number
}

interface Part3Row {
  scope: string
  t0Fill: Compare
  cells: Part3Cell[]
}

function part3Row(
  scope: string,
  markets: string[],
  kind: string,
  input: StudyInput,
  keep: Keep,
  draws: number,
): Part3Row {
  const { lv, lt, tt, ttSet, tv } = input.sides
  const pool = twinPoolOf(kind)
  const level = byPool(lt, kind)
  const twin = byPool(tt, pool)
  const sets = byPool(ttSet, pool)
  const recs = input.visits.filter((v) => levelPoolOf(v) === kind && markets.includes(v.market))
  const fill = compare(byPool(lv, kind), byPool(tv, pool), MEASURES.t0Fill, keep)
  const cells: Part3Cell[] = []
  for (let k = 0; k < 3; k++)
    for (let e = 0; e < 2; e++) {
      const f = tradeFacts(level, twin, k, e, keep, [], markets, draws)
      const items = recs.flatMap((v) => {
        const x = v.trades[k]
        if (!x || x.status !== 'trade' || x.year === null || !keep(v.market, x.year)) return []
        return [{ target: x.exits[e].how === 'target', after: x.exits[e].after }]
      })
      let tn = 0
      let tg = 0
      for (const c of twin) {
        if (!keep(c.market, c.year)) continue
        const o = (k * 2 + e) * TT.size
        tn += c.v[o + TT.n]
        tg += c.v[o + TT.target]
      }
      const ah = aheadOfSets(f.meanAfter, sets, k, e, keep, pool === 'RTW' ? 41 : 46)
      cells.push({
        trade: TRADE_NAMES[k],
        exit: EXITS[e].name,
        trades: f.n,
        targetShare: f.n ? f.target / f.n : NaN,
        twinsTargetShare: tn ? tg / tn : NaN,
        breakEven: breakEvenRate(items),
        beforePips: f.meanPipsBefore,
        beforeR: f.meanBefore,
        afterPips: f.meanPips,
        afterR: f.meanAfter,
        weeklyT: f.weeklyT,
        gap: f.gap,
        gapT: f.gapT,
        ahead: ah.ahead,
        of: ah.of,
      })
    }
  return {
    scope,
    t0Fill: { n: fill.n, level: fill.level, twins: fill.twins, lift: fill.lift },
    cells,
  }
}

function part3(input: StudyInput, span: Span, draws: number) {
  const keep = keepSpan(span)
  const out: Record<string, { all: Part3Row; markets: Part3Row[] }> = {}
  for (const kind of REPORT_KINDS)
    out[kind] = {
      all: part3Row('ALL', input.markets, kind, input, keep, draws),
      markets: input.markets.map((m) =>
        part3Row(m, [m], kind, input, keepAnd(keep, keepMarket(m)), 0),
      ),
    }
  return out
}

function part3Md(p3: ReturnType<typeof part3>): string {
  const out: string[] = [
    "Per trade and exit: trades; how often the target came first, with the twins' share and the rate needed to break even (the share p with p W + (1 - p) L = 0, W and L the average results after costs of the trades whose target came first and of the others); average result before costs in pips and in R, then after costs; the weekly t after costs; the gap to the twins in R (its t on the all-markets row); how many twin sets (grids) it is ahead of. ALL pools every trade of the kind (pips of different markets added together). T0 fill: share of visits whose order filled, levels / twins.",
  ]
  for (const kind of REPORT_KINDS) {
    const k = p3[kind]
    out.push('', `### ${kind}`, '')
    out.push(
      `T0 fill share: ${[k.all, ...k.markets].map((r) => `${r.scope} ${fn(r.t0Fill.level)} / ${fn(r.t0Fill.twins)}`).join('; ')}.`,
      '',
    )
    const rows: (string | number)[][] = []
    for (const r of [k.all, ...k.markets])
      for (const c of r.cells)
        rows.push([
          r.scope,
          `${c.trade} ${c.exit}`,
          c.trades,
          `${pc(c.targetShare)} / ${pc(c.twinsTargetShare)} (need ${pc(c.breakEven)})`,
          `${fx(c.beforePips, 1)} p, ${fx(c.beforeR, 3)} R`,
          `${fx(c.afterPips, 1)} p, ${fx(c.afterR, 3)} R`,
          fn(c.weeklyT, 2),
          `${fx(c.gap, 3)}${r.scope === 'ALL' ? ` (t ${fn(c.gapT, 2)})` : ''}`,
          `${c.ahead} of ${c.of}`,
        ])
    out.push(
      table(
        [
          'Market',
          'Trade',
          'Trades',
          'Target first: level / twins (needed)',
          'Before costs',
          'After costs',
          'Weekly t',
          'Gap to twins (R)',
          'Ahead of sets',
        ],
        rows,
      ),
    )
  }
  return out.join('\n')
}

// ---------------------------------------------------------------- Part 4: the forty rules

interface RuleRow extends RuleStats {
  index: number
  key: string
  kind: string
  reading: string
  market: string
  bar: Line[]
  passes: boolean
  /** The rule's Placebo 2 lift on the same years (the forty rules on all markets). */
  p2?: { lift: number; se: number; t: number; outside: boolean } | null
  /** Read on the rest: the bar and the smallest lift seen are then the rest's; the lift's own are kept here. */
  onRest?: { rest: RestStats; plainBar: Line[]; plainSmallest: number } | null
  /**
   * Amendment 1, D and E: the bar (the choosing bar, or the pair candidate's
   * bar) on the rest against both baselines, which decides; `ok` is chosen
   * (qualifies) on the rest. bar, passes and smallest above stay the plan's
   * own reading, "as written" (F).
   */
  amended?: BothReading & { smallest: number }
}

function ruleRow(rule: Rule, market: string, s: RuleStats, bar: Line[]): RuleRow {
  return {
    ...s,
    index: rule.index,
    key: rule.key,
    kind: rule.kind,
    reading: rule.reading.name,
    market,
    bar,
    passes: allOk(bar),
  }
}

/** The forty rules on all markets over `span` (halves from the periods); draws 0: lifts only. */
function fortyRules(input: StudyInput, P: LevelPeriods, span: Span, draws: number): RuleRow[] {
  const keep = keepSpan(span)
  const { lv, tv } = input.sides
  return RULES.map((rule) => {
    const s = ruleStats(
      byPool(lv, rule.kind),
      byPool(tv, twinPoolOf(rule.kind)),
      ruleMeasure(rule.reading),
      keep,
      [keepHalf(P, 0), keepHalf(P, 1)],
      input.markets,
      draws,
    )
    return ruleRow(rule, 'ALL', s, chooseBar(s))
  })
}

/** The forty rules read on each market alone (the pair candidate's bar). */
function perMarketRules(input: StudyInput, P: LevelPeriods, span: Span, draws: number): RuleRow[] {
  const keep = keepSpan(span)
  const { lv, tv } = input.sides
  return input.markets.flatMap((m) =>
    RULES.map((rule) => {
      const k = keepAnd(keep, keepMarket(m))
      const s = ruleStats(
        byPool(lv, rule.kind).filter((c) => c.market === m),
        byPool(tv, twinPoolOf(rule.kind)).filter((c) => c.market === m),
        ruleMeasure(rule.reading),
        k,
        [keepHalf(P, 0), keepHalf(P, 1)],
        [m],
        draws,
      )
      return ruleRow(rule, m, s, pairBar(s))
    }),
  )
}

const turnLiftAtSameDistance = (rows: RuleRow[], r: RuleRow) => {
  const turn = r.reading === 'Run quick' ? 'Turn quick' : 'Turn hold'
  return (
    rows.find((x) => x.kind === r.kind && x.reading === turn && x.market === r.market)?.lift ?? NaN
  )
}

const marks = (lines: Line[]) => lines.map((l) => (l.ok ? 'Y' : 'n')).join(' ')

/** Amendment 1: one baseline's cell: baseline (spread, n); rest (SE), t; markets above zero; halves; the lines. */
const restCell = (x: RestReading) =>
  `${fx(x.baseline.all.mean)} (${fn(x.baseline.all.spread, 2)}, ${x.baseline.all.n}); ${fx(x.rest.lift)} (${fn(x.rest.se, 2)}), t ${fn(x.rest.t, 2)}; ${x.rest.marketsAbove} of ${x.rest.marketsUsed}; ${fx(x.rest.halves[0])} / ${fx(x.rest.halves[1])}; ${marks(x.lines)}`

/** The plain smallest lift seen (the plan's, before any reading on the rest). */
const plainSmallest = (r: RuleRow) => r.onRest?.plainSmallest ?? r.smallest

function ruleTable(rows: RuleRow[], withBar: boolean): string {
  const lines = withBar ? 'bar 1 2 3 4' : 'bar a b c d'
  return table(
    [
      'Rule',
      'Market',
      'Lift',
      'Level / twins',
      'SE',
      't',
      'Decided visits',
      `Against shuffled days: baseline (spread, n); rest (SE), t; markets above zero; halves; ${lines}`,
      'Against mirrored minutes: the same',
      withBar ? 'Chosen on the rest' : 'Qualifies on the rest',
      'Smallest lift seen: on the rest (E) / plain',
      ...(withBar
        ? [
            'As written: markets above zero, halves',
            'As written: Placebo 2 seed 1 lift (SE)',
            'As written: on the rest of seed 1: lift (SE), t, markets above zero, halves',
            'As written: bar 1 2 3 4',
            'As written: chosen',
          ]
        : ['As written: halves, bar a b c d', 'As written: qualifies']),
    ],
    rows.map((r) => [
      r.key,
      r.market,
      fx(r.lift),
      `${fn(r.rate)} / ${fn(r.twinRate)}`,
      fn(r.se, 2),
      fn(r.t, 2),
      r.decided,
      r.amended ? restCell(r.amended.shuffled) : '-',
      r.amended ? restCell(r.amended.mirrored) : '-',
      r.amended ? yes(r.amended.ok) : '-',
      `${fn(r.amended?.smallest, 1)} / ${fn(plainSmallest(r), 1)}`,
      ...(withBar
        ? [
            `${r.marketsAbove} of ${r.marketsUsed}; ${fx(r.halves[0])} / ${fx(r.halves[1])}`,
            r.p2 ? `${fx(r.p2.lift)} (${fn(r.p2.se, 2)})${r.p2.outside ? ' outside' : ''}` : '-',
            r.onRest
              ? `${fx(r.onRest.rest.lift)} (${fn(r.onRest.rest.se, 2)}), t ${fn(r.onRest.rest.t, 2)}, ${r.onRest.rest.marketsAbove} of ${r.onRest.rest.marketsUsed}, ${fx(r.onRest.rest.halves[0])} / ${fx(r.onRest.rest.halves[1])}`
              : 'not read on the rest',
            `${marks(r.bar)}${r.onRest ? ' (rest)' : ''}`,
            yes(r.passes),
          ]
        : [`${fx(r.halves[0])} / ${fx(r.halves[1])}; ${marks(r.bar)}`, yes(r.passes)]),
    ]),
  )
}

/** Amendment 1, F: a sentence wherever the two readings differ. */
function differText(rows: RuleRow[], word: string): string {
  const d = rows.filter((r) => r.amended && r.amended.ok !== r.passes)
  if (!d.length)
    return `The two readings agree on every row: ${word} on the rest exactly where ${word} as written.`
  return `The two readings differ for: ${d
    .map(
      (r) =>
        `${r.market === 'ALL' ? '' : r.market + ' '}${r.key} (${r.passes ? `${word} as written, not on the rest` : `${word} on the rest, not as written`})`,
    )
    .join('; ')}.`
}

// ---------------------------------------------------------------- placebos

interface P2Measure {
  name: string
  reading: string | null
  stats: RuleStats
  outside: boolean
  /** Outside only: the lift over the visits touched on days whose range is at most 1.5 x the ATR in force. */
  calm: RuleStats | null
  onlyWide: boolean
}

interface P2Row {
  kind: string
  cautious: boolean
  measures: P2Measure[]
}

/** Placebo 1 on the choosing years, from the engine's placebo cells of the real runs. */
function placebo1Rows(runs: MarketRun[], P: LevelPeriods, span: Span): PlaceboRow[] {
  const cells = runs.flatMap((r) => twinCellsOf(r.market, r.run.twins.placebo))
  return P1_POOLS.map((p) =>
    placebo1(
      cells,
      p,
      keepSpan(span),
      [keepHalf(P, 0), keepHalf(P, 1)],
      runs.map((r) => r.market),
    ),
  )
}

/** Placebo 2: each kind's lift on the shuffled days over `span`, for the measures asked. */
function placebo2Rows(
  p2runs: MarketRun[],
  P: LevelPeriods,
  span: Span,
  kinds: string[],
  readings: (string | null)[] | null = null,
): P2Row[] {
  const lv = p2runs.flatMap((r) => r.placebo2!.lv)
  const lvCalm = p2runs.flatMap((r) => r.placebo2!.lvCalm)
  const tv = p2runs.flatMap((r) => twinCellsOf(r.market, r.run.twins.visitsByWeek))
  const tvCalm = p2runs.flatMap((r) => r.placebo2!.tvCalm)
  const markets = p2runs.map((r) => r.market)
  const keep = keepSpan(span)
  const halves: [Keep, Keep] = [keepHalf(P, 0), keepHalf(P, 1)]
  return kinds.map((kind) => ({
    kind,
    cautious: P2_CAUTIOUS.includes(kind),
    measures: P2_MEASURES.filter((x) => !readings || readings.includes(x.reading)).map((x) => {
      const pool = twinPoolOf(kind)
      const stats = ruleStats(byPool(lv, kind), byPool(tv, pool), x.m, keep, halves, markets)
      const outside = p2Outside(stats)
      const calm = outside
        ? ruleStats(byPool(lvCalm, kind), byPool(tvCalm, pool), x.m, keep, halves, markets)
        : null
      return {
        name: x.name,
        reading: x.reading,
        stats,
        outside,
        calm,
        onlyWide: calm ? onlyWideDays(stats, calm) : false,
      }
    }),
  }))
}

/** Give each of the forty rules its Placebo 2 lift, and read on the rest those whose Placebo 2 lift lies outside 2.5 standard errors. */
function readOnRest(forty: RuleRow[], p2: P2Row[]): void {
  for (const r of forty) {
    const m = p2.find((x) => x.kind === r.kind)?.measures.find((x) => x.reading === r.reading)
    r.p2 = m ? { lift: m.stats.lift, se: m.stats.se, t: m.stats.t, outside: m.outside } : null
    r.onRest = null
    if (!m || !m.outside) continue
    const rest = restOf(r, m.stats)
    r.onRest = { rest, plainBar: r.bar, plainSmallest: r.smallest }
    r.bar = chooseBar(rest)
    r.passes = allOk(r.bar)
    r.smallest = rest.smallest
  }
}

const shuffleInfo = (p2runs: MarketRun[]) =>
  p2runs.map((r) => ({ market: r.market, ...r.placebo2!.shuffle }))

// ---------------------------------------------------------------- Amendment 1: every rule against prices with no memory

/** One series' lifts (Amendment 1, B), each worked out like the lift itself (no draws). */
interface SeriesLifts {
  kind: BaselineKind
  seed: number
  /** Its runs: seconds from the first worker started to the last one done, and the largest worker's peak memory. */
  seconds: number
  peakMB: number
  /** The forty rules on all markets, by rule index. */
  forty: Lifts[]
  /** The forty rules on each market alone: market, then rule index. */
  perMarket: Record<string, Lifts[]>
  /** Every Placebo 2 cell on all markets: kind, then measure, its lift. */
  cells: Record<string, Record<string, number>>
}

const poolsOf = (cells: Cell[]) => {
  const m = new Map<string, Cell[]>()
  for (const c of cells) {
    const a = m.get(c.pool)
    if (a) a.push(c)
    else m.set(c.pool, [c])
  }
  return (pool: string) => m.get(pool) ?? []
}

/**
 * Amendment 1, B: reduce one series' runs to lifts over `span`, so its runs
 * can be let go before the next series starts. perMarket: the markets whose
 * forty rules are read alone; cells: also every Placebo 2 cell.
 */
function seriesLifts(
  runs: MarketRun[],
  P: LevelPeriods,
  span: Span,
  s: { kind: BaselineKind; seed: number; seconds: number },
  opt: { perMarket: string[]; cells: boolean },
): SeriesLifts {
  const lv = poolsOf(runs.flatMap((r) => r.placebo2!.lv))
  const tv = poolsOf(runs.flatMap((r) => twinCellsOf(r.market, r.run.twins.visitsByWeek)))
  const markets = runs.map((r) => r.market)
  const keep = keepSpan(span)
  const halves: [Keep, Keep] = [keepHalf(P, 0), keepHalf(P, 1)]
  // As fortyRules (m null) and perMarketRules (one market) read the real series.
  const one = (rule: Rule, m: string | null) =>
    liftsOf(
      ruleStats(
        m === null ? lv(rule.kind) : lv(rule.kind).filter((c) => c.market === m),
        m === null
          ? tv(twinPoolOf(rule.kind))
          : tv(twinPoolOf(rule.kind)).filter((c) => c.market === m),
        ruleMeasure(rule.reading),
        m === null ? keep : keepAnd(keep, keepMarket(m)),
        halves,
        m === null ? markets : [m],
        0,
      ),
    )
  const perMarket: Record<string, Lifts[]> = {}
  for (const m of opt.perMarket) perMarket[m] = RULES.map((rule) => one(rule, m))
  const cells: Record<string, Record<string, number>> = {}
  if (opt.cells)
    for (const kind of REPORT_KINDS)
      cells[kind] = Object.fromEntries(
        P2_MEASURES.map((x) => [x.name, lift(unitsOf(lv(kind), tv(twinPoolOf(kind)), x.m, keep))]),
      )
  return {
    kind: s.kind,
    seed: s.seed,
    seconds: s.seconds,
    peakMB: Math.round(Math.max(...runs.map((r) => r.rssMB))),
    forty: RULES.map((rule) => one(rule, null)),
    perMarket,
    cells,
  }
}

/**
 * Amendment 1, A and B: the series, one at a time: each one's workers, then
 * its lifts, before the next starts, so memory stays flat. One progress line
 * per series.
 */
async function runSeries(
  list: { kind: BaselineKind; seed: number }[],
  job: (m: HarmonicMarket, kind: BaselineKind, seed: number) => LevelsJob,
  markets: HarmonicMarket[],
  jobs: number,
  reduce: (
    runs: MarketRun[],
    s: { kind: BaselineKind; seed: number; seconds: number },
  ) => SeriesLifts,
): Promise<SeriesLifts[]> {
  const out: SeriesLifts[] = []
  for (const s of list) {
    const t = Date.now()
    const runs = await runWorkers(
      markets.map((m) => job(m, s.kind, s.seed)),
      jobs,
    )
    out.push(reduce(runs, { ...s, seconds: (Date.now() - t) / 1000 }))
    const x = out[out.length - 1]
    console.error(
      `series ${BASELINE_NAMES[s.kind]} seed ${s.seed}: ${markets.length} markets, ${x.seconds.toFixed(1)} s, largest worker ${x.peakMB} MB`,
    )
  }
  return out
}

/** A rule's two baselines (Amendment 1, B) from the lifts `pick` takes from each series. */
const basesOf = (series: SeriesLifts[], pick: (s: SeriesLifts) => Lifts, markets: string[]) => ({
  shuffled: baselineOf(series.filter((s) => s.kind === 'shuffled').map(pick), markets),
  mirrored: baselineOf(series.filter((s) => s.kind === 'mirrored').map(pick), markets),
})

/** Amendment 1, D and E: the choosing bar and the pair candidate's bar on the rest against both baselines. */
function readOnBaselines(forty: RuleRow[], perMarket: RuleRow[], series: SeriesLifts[]): void {
  const put = (r: RuleRow, b: BothReading) => (r.amended = { ...b, smallest: smallestOnRest(b) })
  for (const r of forty)
    put(
      r,
      againstBoth(
        r,
        basesOf(series, (s) => s.forty[r.index], Object.keys(r.marketLift)),
        chooseBar,
      ),
    )
  for (const r of perMarket)
    put(
      r,
      againstBoth(
        r,
        basesOf(series, (s) => s.perMarket[r.market][r.index], [r.market]),
        pairBarOnRest(r.decided),
      ),
    )
}

/** The rests of the Turn reading at the same distance as a Run rule, against shuffled days and mirrored minutes. */
const turnRestsAtSameDistance = (rows: RuleRow[], r: RuleRow): [number, number] => {
  const turn = r.reading === 'Run quick' ? 'Turn quick' : 'Turn hold'
  const x = rows.find((y) => y.kind === r.kind && y.reading === turn && y.market === r.market)
  return x?.amended ? [x.amended.shuffled.rest.lift, x.amended.mirrored.rest.lift] : [NaN, NaN]
}

/** Amendment 1, H: a Placebo 2 cell's mean and spread over the series of each kind. */
const cellSpreads = (series: SeriesLifts[], kind: string, measure: string) => ({
  shuffled: spreadOf(
    series.filter((s) => s.kind === 'shuffled').map((s) => s.cells[kind]?.[measure]),
  ),
  mirrored: spreadOf(
    series.filter((s) => s.kind === 'mirrored').map((s) => s.cells[kind]?.[measure]),
  ),
})

const spreadText = (s: Spread) =>
  `${fx(s.mean)} (${fn(s.spread, 2)})${meanOutside(s) ? ' **off zero**' : ''}`

/** Which reading took a rule or a pair candidate to the check (Amendment 1, F); null for a rehearsal fallback. */
type ChosenBy = 'rest' | 'as written' | 'both' | null
const chosenBy = (rest: boolean, written: boolean): ChosenBy =>
  rest && written ? 'both' : rest ? 'rest' : written ? 'as written' : null

const statText = (s: { lift: number; se: number; t: number }) =>
  `${fx(s.lift)} (SE ${fn(s.se, 2)}, t ${fn(s.t, 2)})`

function placeboMd(
  p1: PlaceboRow[],
  p2: P2Row[],
  shuffles: ReturnType<typeof shuffleInfo>,
  P: LevelPeriods,
  span: Span,
  series: SeriesLifts[],
): string {
  const nOf = (k: BaselineKind) => series.filter((s) => s.kind === k).length
  const out: string[] = [
    '## Placebos (a placebo outside its limits is explained before any real result is read)',
    '',
    `**Placebo 1, a twin as the level** (${spanText(span)}): twin set 0.60 (round numbers: the grid at 25.0 pips, $5.00) is treated as the level and measured against the sets at least 0.10 away from it (round numbers: the grids at least 5 pips, $1, away), by market, UTC year and side as always. Its lift at 0.25 x ATR must be inside plus or minus 1.5 points or 2.5 standard errors, whichever is wider. R00 and R50 share the 41 grids, so they have one row.`,
    '',
    table(
      ['Kind', 'Decided visits', 'Lift', 'SE', 't', 'Limit', 'Inside'],
      p1.map((r) => [
        r.label,
        r.stats.decided,
        fx(r.stats.lift),
        fn(r.stats.se, 2),
        fn(r.stats.t, 2),
        `+/- ${fn(r.limit, 2)}`,
        r.inside === null ? 'no visit' : yes(r.inside),
      ]),
    ),
    '',
  ]
  const p1Out = p1.filter((r) => r.inside === false)
  out.push(
    p1Out.length
      ? `**Placebo 1 falls outside for ${p1Out.map((r) => r.label).join(', ')}. The cause is to be found and written down in the results before any real result below is read.**`
      : 'Placebo 1 is inside its limits for every kind.',
    '',
    `**Placebo 2, shuffled days** (${spanText(span)}): each market's days put in a random order, each day changing places only with days of the same name in the same block of years (${P.halves.map(spanText).join(' and ')}; gold ${P.goldHalves.map(spanText).join(' and ')}${span === P.check ? `; ${spanText(P.check)}` : ''}); ${SHUFFLE_GENERATOR}. A day keeps its own 1-minute candles; in time order every price of a moved day is multiplied by the close of the day now before it over the close of the day that was really before it (a day left in its own place keeps its prices; the first day of a file keeps its place and its prices); each minute keeps its New York clock time counted from its day's 17:00 start; a minute whose clock time has no stamp in its new day, or whose stamp is taken, is dropped. All ten kinds, their twins, visits and races are built on this series as on the real one. Each lift should lie within 2.5 standard errors of zero.`,
    '',
    `Shuffle per market (days, days moved, minutes dropped for their clock time, for a taken stamp): ${shuffles.map((s) => `${s.market} ${s.days}, ${s.moved}, ${s.outside}, ${s.taken}`).join('; ')}.`,
    '',
    `**Prices with no memory (Amendment 1, A and H).** Beside each cell of seed 1: the mean (spread) of the lift over the ${nOf('shuffled')} shuffles (seeds 1 to ${nOf('shuffled')}, seed 1 the one before it) and over the ${nOf('mirrored')} mirrored-minutes series (seeds 1 to ${nOf('mirrored')}): the real 1-minute candles in their real order and at their real stamps, each minute kept or turned upside down (every move mirrored in ratio, the two wicks changing places), by ${MIRROR_GENERATOR}. **off zero** marks a mean more than 2.5 x spread / sqrt(n) from zero. Anything here that the causes written in Amendment 1 do not cover is looked into before the real tables are read. Seconds per series and the largest worker's peak memory: ${series.map((s) => `${s.kind} ${s.seed} ${s.seconds.toFixed(0)} s ${s.peakMB} MB`).join('; ')}.`,
    '',
    table(
      [
        'Kind',
        ...P2_MEASURES.map(
          (m) =>
            `${m.name[0].toUpperCase()}${m.name.slice(1)}: seed 1 lift (SE, t); ${nOf('shuffled')} shuffles mean (spread); ${nOf('mirrored')} mirrored mean (spread)`,
        ),
        'Note',
      ],
      p2.map((r) => [
        r.kind,
        ...P2_MEASURES.map((m) => {
          const x = r.measures.find((y) => y.name === m.name)
          if (!x) return '-'
          const sp = cellSpreads(series, r.kind, m.name)
          return `${statText(x.stats)}${x.outside ? ' **outside**' : ''}${x.onlyWide ? `, ${ONLY_WIDE_TEXT}` : ''}; ${spreadText(sp.shuffled)}; ${spreadText(sp.mirrored)}`
        }),
        r.cautious ? P2_CAUTIOUS_TEXT : '',
      ]),
    ),
    '',
  )
  const outs = p2.flatMap((r) =>
    r.measures.filter((m) => m.outside).map((m) => ({ kind: r.kind, m })),
  )
  if (!outs.length) out.push('Placebo 2 lies within 2.5 standard errors of zero everywhere.')
  else {
    out.push(
      `Placebo 2 lies outside 2.5 standard errors of zero for: ${outs.map(({ kind, m }) => `${kind} ${m.name}${m.onlyWide ? ` (${ONLY_WIDE_TEXT})` : m.calm ? ` (on days of at most 1.5 x ATR: ${statText(m.calm)})` : ''}`).join('; ')}.`,
      '',
      `Rules read on the rest (their lift minus their Placebo 2 lift; the choosing bar and the level lines L1 to L3 apply to the rest): ${
        outs
          .filter(({ kind, m }) => m.reading && (PLAN_KINDS as readonly string[]).includes(kind))
          .map(({ kind, m }) => `${kind} ${m.reading}`)
          .join(', ') || 'none (no rule reading is outside)'
      } (the plan's reading, "as written"; under Amendment 1 every rule is read on the rest against both kinds of prices with no memory, Part 4). **The cause is to be looked for and written down in the results before any real result below is read.**`,
    )
  }
  return out.join('\n')
}

/** Placebo 2 beside the real lift, per kind (the real lifts are real results: this table comes after the placebo section). */
function besideMd(input: StudyInput, p2: P2Row[], span: Span): string {
  const keep = keepSpan(span)
  const { lv, tv } = input.sides
  const rows = p2.map((r) => [
    r.kind,
    ...r.measures.map((m) => {
      const real = lift(
        unitsOf(
          byPool(lv, r.kind),
          byPool(tv, twinPoolOf(r.kind)),
          P2_MEASURES.find((x) => x.name === m.name)!.m,
          keep,
        ),
      )
      return `${fx(real)} / ${fx(m.stats.lift)}${m.outside ? ' (outside)' : ''}`
    }),
  ])
  return [
    `Each kind's lift on the real series beside its lift on the shuffled days (Placebo 2), in points: real / shuffled.`,
    '',
    table(['Kind', ...P2_MEASURES.map((m) => m.name)], rows),
  ].join('\n')
}

// ---------------------------------------------------------------- Part 5

function part5(input: StudyInput, spans: Span[]) {
  const out = []
  const ms = input.runs
  for (const span of spans) {
    for (const chart of ['days', '4-hour'] as const) {
      const ch = ms.map((r) =>
        chart === 'days'
          ? pctChanges(r.days.name, r.days.close)
          : pctChanges(r.four.start, r.four.close),
      )
      const keep = (name: number) => inSpan(chart === 'days' ? dayNameTime(name) : name, span)
      const pairs = []
      for (let i = 0; i < ms.length; i++)
        for (let j = i + 1; j < ms.length; j++) {
          const c = changeCorrelation(ch[i], ch[j], keep)
          pairs.push({ a: ms[i].market, b: ms[j].market, r: c.r, n: c.n, oneBet: c.r > 0.7 })
        }
      out.push({ span: spanText(span), chart, pairs })
    }
  }
  return out
}

function part5Md(p5: ReturnType<typeof part5>, markets: string[]): string {
  const out: string[] = [
    'Correlation of changes in percent, close to close of candles with the same name (days named by their date; 4-hour candles by their clock start), candles missing in either market left out. Pairs above 0.7 are named as close to one bet.',
  ]
  for (const b of p5) {
    out.push('', `**${b.chart}, ${b.span}**`, '')
    out.push(
      table(
        ['', ...markets],
        markets.map((a) => [
          a,
          ...markets.map((c) => {
            if (a === c) return '1'
            const p = b.pairs.find((x) => (x.a === a && x.b === c) || (x.a === c && x.b === a))
            return p ? fn(p.r, 2) : '-'
          }),
        ]),
      ),
    )
    const close = b.pairs.filter((p) => p.oneBet)
    out.push(
      '',
      `Close to one bet (above 0.7): ${close.length ? close.map((p) => `${p.a} and ${p.b} (${fn(p.r, 2)})`).join(', ') : 'none'}.`,
    )
  }
  return out.join('\n')
}

// ---------------------------------------------------------------- files

async function writeGz(file: string, lines: Iterable<string>) {
  const gz = createGzip()
  const done = new Promise<void>((ok, bad) => {
    const out = createWriteStream(file)
    out.on('finish', ok)
    out.on('error', bad)
    gz.pipe(out)
  })
  for (const l of lines)
    if (!gz.write(l + '\n')) await new Promise<void>((ok) => gz.once('drain', () => ok()))
  gz.end()
  await done
}

async function readGzLines(file: string): Promise<string[]> {
  const out: string[] = []
  let rest = ''
  const s = createReadStream(file).pipe(createGunzip())
  s.setEncoding('utf8')
  for await (const chunk of s as AsyncIterable<string>) {
    const t = rest + chunk
    const parts = t.split('\n')
    rest = parts.pop() ?? ''
    out.push(...parts)
  }
  if (rest) out.push(rest)
  return out
}

const csvNum = (x: number | null) => (x === null || Number.isNaN(x) ? '' : String(x))

const TRADES_HEADER =
  'market,kind,what,known_from,left_out,side,touch,near,far,atr,visit_end,visit_end_t,trade,exit,dir,fill,entry,stop,target,R,spread,round_trip_cost,market_fills,fill_cost,how,exit_t,exit_price,r_after,r_before,r_double,pips_after,pips_before,trade_done'

/** One row per filled trade and exit; market fills: the entry (T1, B0) and any exit but the target. */
function* tradeRows(visits: MV[]) {
  yield TRADES_HEADER
  for (const v of visits)
    for (const x of v.trades) {
      if (x.status !== 'trade') continue
      const c = MARKET_COSTS[v.market]
      for (let j = 0; j < x.exits.length; j++) {
        const e = x.exits[j]
        const fills = (x.name === 'T0' ? 0 : 1) + (e.how === 'target' ? 0 : 1)
        yield [
          v.market,
          v.kind,
          v.what,
          csvNum(v.knownFrom),
          v.leftOut ? 1 : 0,
          v.side,
          v.touch,
          v.near,
          v.far,
          v.atr,
          v.end,
          csvNum(v.endAt),
          x.name,
          EXITS[j].name,
          x.dir,
          csvNum(x.fill),
          x.entry,
          x.stop,
          x.entry + x.dir * EXITS[j].target * v.atr,
          x.R,
          x.spread,
          x.spread + c.comm,
          fills,
          fills * c.slip,
          e.how,
          e.at,
          e.price,
          e.after,
          e.before,
          e.double,
          e.pips,
          e.pipsBefore,
          csvNum(x.done),
        ].join(',')
      }
    }
}

const LEVELS_HEADER =
  'market,id,kind,what,known_from,first_watched,year,low,high,atr,left_out,sides,turns,last_live,visits,twins'
function* levelRows(runs: MarketRun[]) {
  yield LEVELS_HEADER
  for (const r of runs)
    for (const l of r.run.levels)
      yield [
        r.market,
        l.id,
        l.kind,
        l.what,
        l.knownFrom,
        l.firstWatched,
        l.year,
        l.low,
        l.high,
        l.atr,
        l.leftOut ? 1 : 0,
        l.sides,
        l.turns,
        l.lastLive,
        l.visits,
        l.twins,
      ].join(',')
}

const TV_FIELDS = Object.entries(TV)
  .filter(([k]) => k !== 'size')
  .sort((a, b) => a[1] - b[1])
const TV_NAMES = (() => {
  const names: string[] = []
  for (let i = 0; i < TV.size; i++) {
    const f = [...TV_FIELDS].reverse().find(([, o]) => o <= i)!
    const k = i - f[1]
    names.push(
      ['turn', 'brk', 'run', 'fail'].includes(f[0])
        ? `${f[0]}${['010', '025', '050', '100'][k]}`
        : f[0],
    )
  }
  return names
})()
const TT_NAMES = TRADE_NAMES.flatMap((t) =>
  EXITS.flatMap((e) =>
    Object.entries(TT)
      .filter(([k]) => k !== 'size')
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => `${t}_${e.name}_${k}`),
  ),
)

function* cellRows(cells: Cell[], names: string[]) {
  yield ['market', 'pool', 'year', 'side', 'week', 'set', ...names].join(',')
  for (const c of cells)
    yield [
      c.market,
      c.pool,
      c.year,
      c.side,
      c.week,
      c.set,
      ...Array.from(c.v, (x) => String(x)),
    ].join(',')
}

async function readCells(file: string): Promise<Cell[]> {
  const lines = await readGzLines(file)
  return lines.slice(1).map((l) => {
    const f = l.split(',')
    return {
      market: f[0],
      pool: f[1],
      year: Number(f[2]),
      side: Number(f[3]) as 1 | -1,
      week: Number(f[4]),
      set: Number(f[5]),
      v: Float64Array.from(f.slice(6), Number),
    }
  })
}

const OUT_FILES = {
  visits: 'visits.jsonl.gz',
  trades: 'trades.csv.gz',
  levels: 'levels.csv.gz',
  twinVisitsByWeek: 'twins_visits_by_week.csv.gz',
  twinVisitsBySet: 'twins_visits_by_set.csv.gz',
  twinPlacebo: 'twins_placebo.csv.gz',
  twinTradesByWeek: 'twins_trades_by_week.csv.gz',
  twinTradesBySet: 'twins_trades_by_set.csv.gz',
}

/** The compact files the tables and the check can be rebuilt from. */
async function writeData(out: string, input: StudyInput) {
  const twin = (get: (r: MarketRun) => TwinCell[]) =>
    input.runs.flatMap((r) => twinCellsOf(r.market, get(r)))
  await writeGz(
    join(out, OUT_FILES.visits),
    (function* () {
      for (const v of input.visits) yield json(v)
    })(),
  )
  await writeGz(join(out, OUT_FILES.trades), tradeRows(input.visits))
  await writeGz(join(out, OUT_FILES.levels), levelRows(input.runs))
  await writeGz(
    join(out, OUT_FILES.twinVisitsByWeek),
    cellRows(
      twin((r) => r.run.twins.visitsByWeek),
      TV_NAMES,
    ),
  )
  await writeGz(
    join(out, OUT_FILES.twinVisitsBySet),
    cellRows(
      twin((r) => r.run.twins.visitsBySet),
      TV_NAMES,
    ),
  )
  await writeGz(
    join(out, OUT_FILES.twinPlacebo),
    cellRows(
      twin((r) => r.run.twins.placebo),
      TV_NAMES,
    ),
  )
  await writeGz(
    join(out, OUT_FILES.twinTradesByWeek),
    cellRows(
      twin((r) => r.run.twins.tradesByWeek),
      TT_NAMES,
    ),
  )
  await writeGz(
    join(out, OUT_FILES.twinTradesBySet),
    cellRows(
      twin((r) => r.run.twins.tradesBySet),
      TT_NAMES,
    ),
  )
}

const filesInfo = (runs: MarketRun[]) =>
  runs.map((r) => ({
    market: r.market,
    file: r.file,
    sha256: r.fileSha256,
    bars: r.bars,
    first: iso(r.first),
    last: iso(r.last),
    barsHash: r.barsHash,
    barsHashed: r.barsHashed,
    fifteenthDay: iso(r.run.fifteenth),
    seconds: r.ms / 1000,
    peakMB: Math.round(r.rssMB),
  }))

// ---------------------------------------------------------------- the summary

function summaryMd(
  input: StudyInput,
  span: Span,
  p2: ReturnType<typeof part2>,
  p3: ReturnType<typeof part3>,
  rows: RuleRow[],
  ruleText: (r: RuleRow) => string,
  pairText: string,
): string {
  const keep = keepSpan(span)
  const out: string[] = []
  const kindRows = PLAN_KINDS.map((kind) => {
    const a = p2[kind].all
    const turns = input.visits.filter(
      (v) => levelPoolOf(v) === kind && keep(v.market, v.year) && v.race[1] === 'turn',
    )
    const med = median(turns.map((v) => v.howFar / pipOf(v.market)))
    const t0 = p3[kind].all.cells.find((c) => c.trade === 'T0' && c.exit === 'quick')!
    const t1 = p3[kind].all.cells.find((c) => c.trade === 'T1' && c.exit === 'quick')!
    // Amendment 1, H: the two baselines of the turn rate at 0.25 x ATR beside the lift.
    const tq = rows.find((r) => r.kind === kind && r.reading === 'Turn quick')!
    return [
      kind,
      `${fn(a.turn[1].level, 0)} / ${fn(a.turn[1].twins, 0)}`,
      tq.amended
        ? `${fx(tq.lift, 1)}; ${fx(tq.amended.shuffled.baseline.all.mean, 1)} (${fn(tq.amended.shuffled.baseline.all.spread, 1)}); ${fx(tq.amended.mirrored.baseline.all.mean, 1)} (${fn(tq.amended.mirrored.baseline.all.spread, 1)})`
        : fx(tq.lift, 1),
      fn(med, 1),
      `${fx(t0.beforePips, 1)} / ${fx(t0.afterPips, 1)}`,
      `${fx(t1.beforePips, 1)} / ${fx(t1.afterPips, 1)}`,
      rows
        .filter((r) => r.kind === kind)
        .map((r) => `${r.reading}: ${ruleText(r)}`)
        .join('; '),
    ]
  })
  out.push(
    table(
      [
        'Kind',
        'Out of 100 visits that turned or broke at 0.25 x ATR: turned at the level / at the nearby prices',
        'Lift; baseline on shuffled days (spread); on mirrored minutes (spread)',
        'Median pips a turn went',
        'T0 quick, pips a trade before / after costs',
        'T1 quick, before / after',
        'Its rules',
      ],
      kindRows,
    ),
  )
  const zoneLift = (pool: string, pred: (v: MV) => boolean) => {
    const cells = splitCells(input, pool, pred)
    const c = compare(cells, byPool(input.sides.tv, pool), MEASURES.turn[1], keep)
    return `${fx(c.lift, 1)} (${c.n})`
  }
  const zones = (['Z4', 'ZD'] as const)
    .map(
      (z) =>
        `${z}: two turns ${zoneLift(`${z}x2`, () => true)}, three ${zoneLift(z, (v) => v.turns === 3)}, four or more ${zoneLift(z, (v) => v.turns >= 4)}`,
    )
    .join('; ')
  const tq = (kind: string, trade: string, exit: string) => {
    const c = p3[kind].all.cells.find((x) => x.trade === trade && x.exit === exit)!
    return `${fx(c.afterR, 3)} R`
  }
  const pooled = (trade: number, exit: number) => {
    const f = tradeFacts(
      PLAN_KINDS.flatMap((k) => byPool(input.sides.lt, k)),
      [],
      trade,
      exit,
      keep,
      [],
      input.markets,
      0,
    )
    return `${fx(f.meanAfter, 3)} R (${f.n})`
  }
  const fib = (['F4C', 'FDC', 'F4J', 'FDJ'] as const)
    .map((k) => {
      const r = rows.find((x) => x.kind === k && x.reading === 'Turn quick')!
      return `${k} ${fx(r.lift, 1)} (t ${fn(r.t, 2)})`
    })
    .join(', ')
  out.push(
    '',
    zoneSplitsLine(zones),
    `- **What waiting for the close back out adds** (T1 beside T0, quick, after costs): ${PLAN_KINDS.map((k) => `${k} T0 ${tq(k, 'T0', 'quick')}, T1 ${tq(k, 'T1', 'quick')}`).join('; ')}.`,
    `- **Quick against hold** (the ten kinds together, average after costs, trades): T0 quick ${pooled(0, 0)}, hold ${pooled(0, 1)}; T1 quick ${pooled(1, 0)}, hold ${pooled(1, 1)}; B0 quick ${pooled(2, 0)}, hold ${pooled(2, 1)}.`,
    `- **Fibonacci** (Turn quick lift): ${fib}.`,
    `- **The best pair**: ${pairText}.`,
  )
  return out.join('\n')
}

// ---------------------------------------------------------------- choosing

interface Pick {
  role: 'rule' | 'pair candidate'
  index: number
  key: string
  market: string
  /** Amendment 1, F: the reading that chose it (null: a rehearsal fallback). */
  by: ChosenBy
  fallback: boolean
  row: RuleRow
}

const pickOf = (r: RuleRow, role: Pick['role'], by: ChosenBy, fallback = false): Pick => ({
  role,
  index: r.index,
  key: r.key,
  market: r.market,
  by,
  fallback,
  row: r,
})
const pickJson = ({ row, ...p }: Pick) => ({ ...p, lift: row.lift, t: row.t })

/** A rest reading in a few words: the two rests and their t's. */
const restsText = (b: BothReading) =>
  `rests ${fx(b.shuffled.rest.lift, 1)} / ${fx(b.mirrored.rest.lift, 1)}, t ${fn(b.shuffled.rest.t, 2)} / ${fn(b.mirrored.rest.t, 2)}`

async function runChoose(
  data: string,
  out: string,
  P: LevelPeriods,
  jobs: number,
  seeds: number,
): Promise<string> {
  const t0 = Date.now()
  const { used, missing, file } = marketsIn(data)
  if (!used.length) fail(`no market file in ${data}`)
  await refuseLate(used, file, P.refuseFrom)
  const series: SeriesName = 'real'
  const runs = await runWorkers(
    used.map((m) => ({
      market: m,
      file: file(m),
      readBefore: P.boundary,
      hashBefore: P.boundary,
      series,
    })),
    jobs,
  )
  for (const r of runs) if (r.last >= P.boundary) fail(`${r.market}: a bar at ${iso(r.last)}`)
  // Placebo 2: the same markets on the shuffled days (each day moving inside its half).
  const job = (m: HarmonicMarket, kind: BaselineKind, seed: number): LevelsJob => ({
    market: m,
    file: file(m),
    readBefore: P.boundary,
    hashBefore: P.boundary,
    series: kind,
    seed,
    blocks: kind === 'shuffled' ? halvesOf(P, m) : undefined,
  })
  const tP2 = Date.now()
  const p2runs = await runWorkers(
    used.map((m) => ({
      market: m,
      file: file(m),
      readBefore: P.boundary,
      hashBefore: P.boundary,
      series: 'shuffled' as const,
      blocks: halvesOf(P, m),
    })),
    jobs,
  )
  const p2seconds = (Date.now() - tP2) / 1000
  const p2rows = placebo2Rows(p2runs, P, P.choose, REPORT_KINDS)
  // Amendment 1, A and B: the plan's Placebo 2 is shuffled seed 1; its lifts must be the ones above.
  const reduce = (rs: MarketRun[], s: { kind: BaselineKind; seed: number; seconds: number }) =>
    seriesLifts(rs, P, P.choose, s, { perMarket: used, cells: true })
  const seed1 = reduce(p2runs, { kind: 'shuffled', seed: SHUFFLE_SEED, seconds: p2seconds })
  console.error(
    `series shuffled days seed 1: ${used.length} markets, ${p2seconds.toFixed(1)} s, largest worker ${seed1.peakMB} MB`,
  )
  const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b))
  for (const r of p2rows)
    for (const m of r.measures)
      if (!same(seed1.cells[r.kind][m.name], m.stats.lift))
        fail(`shuffled seed 1: ${r.kind} ${m.name} is not the plan's Placebo 2 lift`)
  for (const rule of RULES) {
    const m = p2rows
      .find((x) => x.kind === rule.kind)!
      .measures.find((x) => x.reading === rule.reading.name)!
    if (!same(seed1.forty[rule.index].lift, m.stats.lift))
      fail(`shuffled seed 1: ${rule.key} is not the plan's Placebo 2 lift`)
  }
  const shuffles = shuffleInfo(p2runs)
  const others = await runSeries(
    baselineSeries(seeds).filter((s) => !(s.kind === 'shuffled' && s.seed === SHUFFLE_SEED)),
    job,
    used,
    jobs,
    reduce,
  )
  const allSeries = [seed1, ...others]
  const tRun = Date.now()
  const input = studyInput(runs)
  const label = P.rehearsal ? 'REHEARSAL: ' : ''
  mkdirSync(out, { recursive: true })

  const p1 = part1(input, P.choose)
  const p2 = part2(input, P.choose)
  const p3 = part3(input, P.choose, BOOT_DRAWS)
  const p5 = part5(input, P.part5Choose)
  const p1rows = placebo1Rows(runs, P, P.choose)
  const forty = fortyRules(input, P, P.choose, BOOT_DRAWS)
  readOnRest(forty, p2rows)
  const perMarket = perMarketRules(input, P, P.choose, BOOT_DRAWS)
  readOnBaselines(forty, perMarket, allSeries)
  const tCount = Date.now()
  const placebo = {
    label: P.label,
    span: spanText(P.choose),
    placebo1: p1rows,
    placebo2: p2rows,
    shuffle: shuffles,
    shuffleGenerator: SHUFFLE_GENERATOR,
    bootstrap: { draws: BOOT_DRAWS, generator: BOOT_GENERATOR },
  }
  writeFileSync(join(out, 'placebo.json'), json(placebo))

  // Amendment 1, D and F: chosen on the rest (which decides) or as written; either goes to the check.
  const chosenRest = forty.filter((r) => r.amended!.ok)
  const chosenWritten = forty.filter((r) => r.passes)
  let picks: Pick[] = forty
    .filter((r) => r.amended!.ok || r.passes)
    .map((r) => pickOf(r, 'rule', chosenBy(r.amended!.ok, r.passes)))
  const pairWritten = rankByT(perMarket.filter((r) => r.passes))
  const pairRest = rankBySmallerT(
    perMarket.filter((r) => r.amended!.ok),
    (r) => r.amended!,
  )
  const pw = pairWritten[0] ?? null
  const pr = pairRest[0] ?? null
  let pairs: Pick[] =
    pr && pr === pw
      ? [pickOf(pr, 'pair candidate', 'both')]
      : [
          ...(pr ? [pickOf(pr, 'pair candidate', 'rest')] : []),
          ...(pw ? [pickOf(pw, 'pair candidate', 'as written')] : []),
        ]
  const fallbackNote: string[] = []
  if (P.rehearsal && !picks.length) {
    picks = rankByT(forty)
      .filter((r) => !Number.isNaN(r.t))
      .slice(0, 3)
      .map((r) => pickOf(r, 'rule', null, true))
    fallbackNote.push(
      'REHEARSAL ONLY: no rule was chosen under either reading; the three rules with the highest t are taken so the check path, the trade lines and the readings all run.',
    )
  }
  if (P.rehearsal && !pairs.length) {
    const top = rankByT(perMarket).find((r) => !Number.isNaN(r.t))
    if (top) {
      pairs = [pickOf(top, 'pair candidate', null, true)]
      fallbackNote.push(
        'REHEARSAL ONLY: no rule on one market qualified under either reading; the one with the highest t is taken as the pair candidate.',
      )
    }
  }
  const nothing =
    !chosenRest.length && !chosenWritten.length && !pairRest.length && !pairWritten.length
  const ruleText = (r: RuleRow) => {
    const a = r.amended!
    const main = a.ok
      ? `chosen on the rest (${restsText(a)})`
      : notSeenBeside(a.smallest, plainSmallest(r))
    if (a.ok === r.passes) return main
    return `${main}; as written: ${r.passes ? `chosen (lift ${fx(r.lift, 1)}, t ${fn(r.t, 2)})` : 'not chosen'}`
  }
  const pairDesc = (x: Pick) =>
    `${x.fallback ? 'REHEARSAL fallback: ' : ''}${x.market} ${x.key} (lift ${fx(x.row.lift, 1)}, t ${fn(x.row.t, 2)}; ${restsText(x.row.amended!)})`
  const pairText = `on the rest: ${pr ? pairDesc(pickOf(pr, 'pair candidate', 'rest')) : 'none'}; as written: ${pw ? (pw === pr ? 'the same' : pairDesc(pickOf(pw, 'pair candidate', 'as written'))) : 'none'}${pairs.some((x) => x.fallback) ? `; ${pairDesc(pairs[0])}` : ''}`
  const readingOf = (r: RuleRow) => RULE_READINGS.find((x) => x.name === r.reading)!
  const runNotes = {
    onRest: forty
      .map((r) => ({
        key: r.key,
        note: runNoteOnRest(readingOf(r), turnRestsAtSameDistance(forty, r)),
      }))
      .filter((x) => x.note),
    asWritten: forty
      .map((r) => ({ key: r.key, note: runNote(readingOf(r), turnLiftAtSameDistance(forty, r)) }))
      .filter((x) => x.note),
  }

  const g = gitState()
  const counts = countsByKind(input, P.choose)
  const choose = {
    rehearsal: P.rehearsal,
    label: P.label,
    generated: new Date().toISOString(),
    commit: g.clean ? g.head : null,
    tree: g.clean ? 'clean' : `not clean (HEAD ${g.head})`,
    data,
    marketsUsed: used,
    marketsMissing: missing,
    files: filesInfo(runs),
    periods: P,
    span: spanText(P.choose),
    halves: P.halves.map(spanText),
    goldHalves: P.goldHalves.map(spanText),
    bootstrap: { draws: BOOT_DRAWS, generator: BOOT_GENERATOR },
    seeds,
    counts,
    rules: forty,
    chosen: { onRest: chosenRest.map((r) => r.key), asWritten: chosenWritten.map((r) => r.key) },
    picks: picks.map(pickJson),
    pairRanking: {
      onRest: pairRest.map((r) => ({
        market: r.market,
        key: r.key,
        index: r.index,
        smallerT: Math.min(r.amended!.shuffled.rest.t, r.amended!.mirrored.rest.t),
        lift: r.lift,
        decided: r.decided,
      })),
      asWritten: pairWritten.map((r) => ({
        market: r.market,
        key: r.key,
        index: r.index,
        t: r.t,
        lift: r.lift,
        decided: r.decided,
      })),
    },
    pairTieOrder: `highest t (on the rest: the smaller t of the two); a tie goes to the first kind in ${PLAN_KINDS.join(', ')}, then the readings ${RULE_READINGS.map((r) => r.name).join(', ')}, then the markets ${PLAN_MARKETS.join(', ')}`,
    pairCandidates: pairs.map(pickJson),
    fallback: fallbackNote,
    verdict: nothing ? NOTHING_CHOSEN : null,
    placebo1Outside: p1rows.filter((r) => r.inside === false).map((r) => r.label),
    placebo2Outside: p2rows.flatMap((r) =>
      r.measures.filter((m) => m.outside).map((m) => `${r.kind} ${m.name}`),
    ),
    readOnRest: forty
      .filter((r) => r.onRest)
      .map((r) => ({
        key: r.key,
        index: r.index,
        placebo2: r.p2,
        rest: r.onRest!.rest,
      })),
    runNotes,
    perMarket,
    // Amendment 1, A and B: each series' lifts, so any rest can be worked out again from this file.
    baselines: {
      seeds,
      shuffleGenerator: SHUFFLES_GENERATOR,
      mirrorGenerator: MIRROR_GENERATOR,
      series: allSeries,
    },
    outputs: OUT_FILES,
    seconds: {
      workers: (tRun - t0) / 1000,
      counting: (tCount - tRun) / 1000,
      total: NaN as number,
    },
    peakMB: {
      main: 0,
      workers: Math.max(...runs.map((r) => r.rssMB), ...allSeries.map((s) => s.peakMB)),
      concurrency: jobs,
    },
  }

  writeFileSync(
    join(out, 'part1.json'),
    json({ label: P.label, span: spanText(P.choose), rows: p1 }),
  )
  writeFileSync(
    join(out, 'part2.json'),
    json({ label: P.label, span: spanText(P.choose), kinds: p2 }),
  )
  writeFileSync(
    join(out, 'part3.json'),
    json({ label: P.label, span: spanText(P.choose), kinds: p3 }),
  )
  writeFileSync(join(out, 'part5.json'), json({ label: P.label, blocks: p5 }))
  await writeData(out, input)
  choose.seconds.total = (Date.now() - t0) / 1000
  choose.peakMB.main = Math.round(process.resourceUsage().maxRSS / 1024)
  writeFileSync(join(out, 'choose.json'), json(choose))

  const keys = (rows: RuleRow[]) => (rows.length ? rows.map((r) => r.key).join(', ') : 'none')
  const pairKey = (r: RuleRow | null) => (r ? `${r.market} ${r.key}` : 'none')
  const pairRows = [...new Set([...pairRest, ...pairWritten])]
  const md: string[] = [`# ${label}Levels study: choosing run`, '']
  if (P.rehearsal)
    md.push(
      `**REHEARSAL inside the development years: choosing on ${spanText(P.choose)}, not the plan's choosing years. Nothing here is a result of the study.**`,
      '',
    )
  md.push(
    `Generated ${choose.generated}. Code: ${choose.commit ?? choose.tree}. Data: ${data}.`,
    `Markets used: ${used.join(', ')}.${missing.length ? ` Left out (file missing): ${missing.join(', ')}.` : ''}`,
    `Choosing span: ${spanText(P.choose)}; halves ${P.halves.map(spanText).join(' and ')} (gold ${P.goldHalves.map(spanText).join(' and ')}). Visits by touch minute, trades by fill minute (UTC). The run reads no price at or after ${dayText(P.boundary)}.`,
    `Bootstrap: ${BOOT_DRAWS} draws, ${BOOT_GENERATOR}.`,
    `Prices with no memory (Amendment 1): ${seeds} shuffled-days series and ${seeds} mirrored-minutes series.${seeds !== BASELINE_SEEDS ? ` **Fewer than the amendment's ${BASELINE_SEEDS} of each: a test run.**` : ''}`,
    '',
    `## ${label}Summary`,
    '',
    summaryMd(input, P.choose, p2, p3, forty, ruleText, pairText),
    '',
    nothing
      ? `**${NOTHING_CHOSEN}.** The checking years stay closed.`
      : `Rules chosen on the rest: ${keys(chosenRest)}; as written: ${keys(chosenWritten)}. Pair candidate on the rest: ${pairKey(pr)}; as written: ${pairKey(pw)}. Under Amendment 1 the rest decides; a rule or pair candidate chosen under either reading goes to the check.`,
    ...fallbackNote.map((x) => `\n**${x}**`),
    '',
    placeboMd(p1rows, p2rows, shuffles, P, P.choose, allSeries),
    '',
    `## Part 1: how often (${spanText(P.choose)})`,
    '',
    part1Md(p1, used),
    '',
    `## Part 2: do the levels hold? (${spanText(P.choose)})`,
    '',
    besideMd(input, p2rows, P.choose),
    '',
    "The splits (by side, first and later visits, New York clock, number of turns, Fibonacci ratio, round numbers, twin set; in part2.json) have no baseline of their own (Amendment 1, H): they are read with the kind's baselines in mind, which are in the summary and in Part 4.",
    '',
    part2Md(p2),
    '',
    `## Part 3: the plain trades (${spanText(P.choose)})`,
    '',
    part3Md(p3),
    '',
    '## Part 4: choosing',
    '',
    'A rule is chosen when, on the choosing years, all hold: 1. its lift is 2 points or more; 2. the lift is above zero in at least 5 of the 7 markets (with fewer markets: in more than two thirds of those used); 3. the lift is above zero in each half; 4. its t is 3.0 or more. Lifts in points out of 100; "Level / twins" are the rates shown (plain averages of the markets).',
    '',
    `**On the rest (Amendment 1, B to E; this reading decides).** Against each kind of prices with no memory (${seeds} shuffled-days series, ${seeds} mirrored-minutes series) a rule's baseline is the mean of its lifts there (for all markets, each market and each half; a series with no lift left out), its spread their standard deviation (n - 1), and the rest is the lift minus the baseline. The rest's standard error is the square root of S x S + spread x spread / n, S the larger of the lift's own standard error and the spread; its t is the rest over that, and needs two series with a lift. The four lines are put on the rest against each baseline and must hold against both. The smallest lift seen (E) is the larger of 2 points and 3.0 times the larger of the two standard errors of the rest; the plain figure (2 points or 3.0 times the lift's own standard error) is beside it.`,
    '',
    "**As written (the plan's own reading, Amendment 1, F).** The lines on the plain lift, or, for a rule whose Placebo 2 lift (shuffled days, seed 1) lies outside 2.5 standard errors of zero, on its lift minus that Placebo 2 lift, for all markets, each market and each half, with the standard error the square root of the sum of the two squared standard errors.",
    '',
    ruleTable(forty, true),
    '',
    `Rules chosen on the rest: ${keys(chosenRest)}. As written: ${keys(chosenWritten)}.`,
    '',
    differText(forty, 'chosen'),
    '',
    ...(forty.filter((r) => !r.amended!.ok).length
      ? [
          `Not chosen on the rest: ${forty
            .filter((r) => !r.amended!.ok)
            .map((r) => `${r.key} ${notSeenBeside(r.amended!.smallest, plainSmallest(r))}`)
            .join('; ')}.`,
          '',
        ]
      : []),
    `Run rules read as "price moves at this level" (the Turn reading at the same distance has a rest of 2 points or more against both baselines): ${runNotes.onRest.map((x) => x.key).join(', ') || 'none'}. As written (its plain Turn lift 2 points or more): ${runNotes.asWritten.map((x) => x.key).join(', ') || 'none'}.`,
    '',
    `### The pair candidate`,
    '',
    `A rule on one market qualifies with at least 150 visits that ended in a turn or a break (a run or a fail), counted on the real series, a lift of 4 points or more, a lift above zero in each half, and a t of 3.5 or more. On the rest the last three are put on the rest against that market's own two baselines and must hold against both, and the pair candidate is the qualifying rule whose smaller t of the two is the highest; as written, the lines are on the plain lift and the highest t wins. Tie order: ${choose.pairTieOrder}.`,
    '',
    `Qualifying on the rest: ${pairRest.length} of ${perMarket.length}; as written: ${pairWritten.length} of ${perMarket.length}.`,
    '',
    pairRows.length
      ? ruleTable(
          rankBySmallerT(pairRows, (r) => r.amended!),
          false,
        )
      : '**No rule on one market qualified under either reading.**',
    '',
    `Pair candidate: ${pairText}.`,
    '',
    differText(perMarket, 'qualifies'),
    '',
    `The ten rules on one market with the highest smaller t on the rest (all ${perMarket.length} are in choose.json):`,
    '',
    ruleTable(rankBySmallerT(perMarket, (r) => r.amended!).slice(0, 10), false),
    '',
    nothing ? `**${NOTHING_CHOSEN}.**` : '',
    '',
    `## Part 5: pairs that move alike`,
    '',
    part5Md(p5, used),
    '',
    `Run time ${choose.seconds.total.toFixed(1)} s (workers ${choose.seconds.workers.toFixed(1)} s, counting ${choose.seconds.counting.toFixed(1)} s); peak memory: main ${choose.peakMB.main} MB, largest worker ${Math.round(choose.peakMB.workers)} MB, ${jobs} workers at a time.`,
    '',
  )
  writeFileSync(join(out, 'choose.md'), md.join('\n'))
  // Counts only: no rule's name and no number of a real result.
  console.log(
    `${label}choose: ${used.length} markets, ${input.visits.length} level and round-number visits, ${allSeries.length} series with no memory; rules chosen on the rest ${chosenRest.length}, as written ${chosenWritten.length}; pair candidate on the rest ${pr ? 'yes' : 'none'}, as written ${pw ? 'yes' : 'none'}${fallbackNote.length ? ' (rehearsal fallbacks taken)' : ''}; ${choose.seconds.total.toFixed(1)} s, peak main ${choose.peakMB.main} MB, worker ${Math.round(choose.peakMB.workers)} MB`,
  )
  return join(out, 'choose.json')
}

/** Visits and filled trades per kind (the counts for the report). */
function countsByKind(input: StudyInput, span: Span) {
  const keep = keepSpan(span)
  const out: Record<string, { visits: number; trades: Record<string, number> }> = {}
  for (const v of input.visits) {
    if (!keep(v.market, v.year)) continue
    const pool = levelPoolOf(v)!
    const o = (out[pool] ??= { visits: 0, trades: { T0: 0, T1: 0, B0: 0 } })
    o.visits++
    for (const x of v.trades)
      if (x.status === 'trade' && x.year !== null && keep(v.market, x.year)) o.trades[x.name]++
  }
  return out
}

// ---------------------------------------------------------------- checking

interface CheckOpts {
  data: string
  choosePath: string
  out: string
  marker: string
  commit: string | null
  gitTest: boolean
  jobs: number
  /** Series of each kind with no memory (Amendment 1, A): 10, fewer only in a rehearsal. */
  seeds: number
}

/** Order of work point 5: the visits, trades and twin sums settled before the boundary must equal the choosing run's. */
async function settledCompare(
  chooseDir: string,
  input: StudyInput,
  boundary: number,
): Promise<string[]> {
  const chosenVisits = (await readGzLines(join(chooseDir, OUT_FILES.visits))).map(
    (l) => JSON.parse(l) as MV,
  )
  // Both sides as saved (non-finite numbers are written as null).
  const now = input.visits.map((v) => JSON.parse(json(v)) as MV)
  const visits = settledVisitDiffs(chosenVisits, now, boundary)
  const skipTV = [TV.t0Fill, TV.endTurn, TV.endBreak]
  const cells = async (file: string, cur: Cell[], skip: number[], what: string) =>
    settledCellDiffs(await readCells(join(chooseDir, file)), cur, boundary, skip, what)
  const tv = await cells(OUT_FILES.twinVisitsByWeek, input.sides.tv, skipTV, 'twin visits')
  const tp = await cells(
    OUT_FILES.twinPlacebo,
    input.runs.flatMap((r) => twinCellsOf(r.market, r.run.twins.placebo)),
    skipTV,
    'placebo cells',
  )
  const tt = await cells(OUT_FILES.twinTradesByWeek, input.sides.tt, [], 'twin trades')
  const diffs = [...visits.diffs, ...tv.diffs, ...tp.diffs, ...tt.diffs]
  console.log(
    `settled before ${dayText(boundary)}: ${visits.compared} visits with their trades, ${tv.compared} twin visit cells, ${tp.compared} placebo cells, ${tt.compared} twin trade cells compared; ${diffs.length} differences`,
  )
  return diffs
}

interface CandidateResult {
  role: Pick['role']
  key: string
  market: string
  /** Amendment 1, F: the reading that took it to the check (null: a rehearsal fallback). */
  by: ChosenBy
  fallback: boolean
  chosenOn: { lift: number; t: number }
  level: RuleStats
  /** The plain level lines, printed beside the ones on the rest. */
  levelLines: Line[]
  /** Amendment 1, D: the level lines on the rest against both baselines on the checking years; they decide the reading. */
  amended: BothReading
  trades: {
    name: string
    facts: ReturnType<typeof tradeFacts>
    lines: Line[]
    pass: boolean
  }[]
  /** The reading from the level lines on the rest (Amendment 1, F). */
  reading: string
  beside: string | null
  positive: string[]
  /** The note on a Run rule, on the rest (Amendment 1, D). */
  runNote: string | null
  /** The plan's own reading (F): from the plain level lines, or from the rest of seed 1 where the rule was read on it; with the plain note on a Run rule. */
  asWritten: { reading: string; beside: string | null; positive: string[]; runNote: string | null }
  /** As written, a rule read on the rest: Placebo 2 on the checking years, the rest, and the level lines applied to it. */
  rest: {
    choosing: unknown
    placebo2: RuleStats
    outside: boolean
    calm: RuleStats | null
    onlyWide: boolean
    rest: RestStats
    lines: Line[]
  } | null
}

async function runCheck(o: CheckOpts, P: LevelPeriods) {
  const t0 = Date.now()
  if (!existsSync(o.choosePath)) fail(`no ${o.choosePath}`)
  const choose = JSON.parse(readFileSync(o.choosePath, 'utf8'))
  if (choose.rehearsal !== P.rehearsal)
    fail(`${o.choosePath} is ${choose.rehearsal ? 'a rehearsal' : 'a real choosing run'}`)
  if (choose.seeds !== o.seeds)
    fail(`${o.choosePath} used ${choose.seeds} series of each kind, the check ${o.seeds}`)
  const picks: (Omit<Pick, 'row'> & { lift: number; t: number })[] = [
    ...(choose.picks ?? []),
    ...(choose.pairCandidates ?? []),
  ]
  if (!picks.length) fail('choose.json names neither a chosen rule nor a pair candidate')
  for (const p of picks)
    if (RULES[p.index]?.key !== p.key)
      fail(`rule ${p.index} is ${RULES[p.index]?.key}, not ${p.key}`)
  const gitInfo = o.gitTest
    ? (() => {
        const g = gitTest(o.commit ?? fail('missing --commit'), git)
        if ('refuse' in g) fail(g.refuse)
        return g
      })()
    : null
  // Which files exist (nothing is read): a wrong --data must not use up the check.
  const { used, missing, file } = marketsIn(o.data)
  if (!used.length) fail(`no market file in ${o.data}`)
  const refusal = openCheck({
    rehearsal: P.rehearsal,
    marker: o.marker,
    head: gitInfo?.head ?? null,
    chooseCommit: choose.commit,
    chooseMarkets: choose.marketsUsed,
    used,
    content: {
      label: P.label,
      time: new Date().toISOString(),
      commit: gitInfo?.head ?? null,
      remote: gitInfo?.remote ?? null,
      choose: resolve(o.choosePath),
      marketsUsed: used,
      marketsMissing: missing,
      picks: picks.map((p) => ({ role: p.role, market: p.market, key: p.key, by: p.by })),
    },
  })
  if (refusal) fail(refusal)
  // The marker is written. Only now is any bar read.
  if (P.rehearsal) await refuseLate(used, file, P.refuseFrom)
  mkdirSync(o.out, { recursive: true })
  const runs = await runWorkers(
    used.map((m) => ({
      market: m,
      file: file(m),
      readBefore: null,
      hashBefore: P.boundary,
      series: 'real' as const,
    })),
    o.jobs,
  )
  // The market files must hold the bars the choosing run used.
  for (const r of runs) {
    const f = (choose.files as { market: string; barsHash: string; barsHashed: number }[]).find(
      (x) => x.market === r.market,
    )
    if (!f || f.barsHash !== r.barsHash || f.barsHashed !== r.barsHashed)
      fail(
        `${r.market}: the bars before ${dayText(P.boundary)} differ from those of the choosing run (nothing from ${dayText(P.boundary)} on was printed or saved)`,
      )
  }
  const input = studyInput(runs)
  const diffs = await settledCompare(dirname(o.choosePath), input, P.boundary)
  if (diffs.length)
    fail(
      `Order of work point 5: ${diffs.length} visits, trades or twin sums settled before ${dayText(P.boundary)} differ from the choosing run. Nothing from ${dayText(P.boundary)} on was printed or saved. First ones:\n${diffs.slice(0, 20).join('\n')}`,
    )

  // Nothing of the checking years is printed or saved before this line.
  const checkYears = P.checkYears
  const forty = fortyRules(input, P, P.check, 0)
  // Amendment 1, F: P2's bar counts every rule and trade pair taken, by either reading.
  const pairsToCheck = picks.reduce((s, p) => s + RULES[p.index].reading.trades.length, 0)
  // As written, rules read on the rest use Placebo 2 (shuffled seed 1) with 2019 to 2025 as a block of its own.
  const restOn = new Map(
    ((choose.readOnRest ?? []) as { key: string }[]).map((x) => [x.key, x as unknown]),
  )
  const onRest = picks.filter((p) => p.role === 'rule' && restOn.has(p.key))
  let p2check: P2Row[] = []
  let p2shuffle: ReturnType<typeof shuffleInfo> = []
  // Amendment 1, D: the twenty series, built again on the whole files inside this single check
  // (the shuffle with the checking years as their own block), reduced to lifts over the checking years.
  const pairMarkets = [
    ...new Set(picks.filter((p) => p.role === 'pair candidate').map((p) => p.market)),
  ]
  const series = await runSeries(
    baselineSeries(o.seeds),
    (m, kind, seed) => ({
      market: m,
      file: file(m),
      readBefore: null,
      hashBefore: P.boundary,
      series: kind,
      seed,
      blocks: kind === 'shuffled' ? [...halvesOf(P, m), P.check] : undefined,
    }),
    used,
    o.jobs,
    (rs, s) => {
      if (s.kind === 'shuffled' && s.seed === SHUFFLE_SEED) {
        p2shuffle = shuffleInfo(rs)
        if (onRest.length)
          p2check = placebo2Rows(
            rs,
            P,
            P.check,
            [...new Set(onRest.map((p) => RULES[p.index].kind as string))],
            [...new Set(onRest.map((p) => RULES[p.index].reading.name as string))],
          )
      }
      return seriesLifts(rs, P, P.check, s, { perMarket: pairMarkets, cells: false })
    },
  )
  const basesFor = (index: number, market: string) =>
    market === 'ALL'
      ? basesOf(series, (s) => s.forty[index], input.markets)
      : basesOf(series, (s) => s.perMarket[market][index], [market])
  const results: CandidateResult[] = []
  for (const p of picks) {
    const rule = RULES[p.index]
    const pair = p.role === 'pair candidate'
    const markets = pair ? [p.market] : input.markets
    const keep = pair ? keepAnd(keepSpan(P.check), keepMarket(p.market)) : keepSpan(P.check)
    const level = ruleStats(
      byPool(input.sides.lv, rule.kind),
      byPool(input.sides.tv, twinPoolOf(rule.kind)),
      ruleMeasure(rule.reading),
      keep,
      [keepHalf(P, 0), keepHalf(P, 1)],
      markets,
      BOOT_DRAWS,
    )
    const ll = levelLines(level, pair)
    const amended = againstBoth(level, basesFor(p.index, pair ? p.market : 'ALL'), (r) =>
      levelLines(r, pair),
    )
    let rest: CandidateResult['rest'] = null
    if (!pair && restOn.has(p.key)) {
      const m = p2check
        .find((x) => x.kind === rule.kind)!
        .measures.find((x) => x.reading === rule.reading.name)!
      const r = restOf(level, m.stats)
      rest = {
        choosing: restOn.get(p.key),
        placebo2: m.stats,
        outside: m.outside,
        calm: m.calm,
        onlyWide: m.onlyWide,
        rest: r,
        lines: levelLines(r, false),
      }
    }
    // Amendment 1, G: the trade lines and their arithmetic do not change.
    const trades = rule.reading.trades.map((tr) => {
      const facts = tradeFacts(
        byPool(input.sides.lt, rule.kind),
        byPool(input.sides.tt, twinPoolOf(rule.kind)),
        tr.trade,
        tr.exit,
        keep,
        checkYears,
        markets,
        BOOT_DRAWS,
      )
      const lines = tradeLines(facts, pair, pairsToCheck)
      return { name: tr.name, facts, lines, pass: allOk(lines) }
    })
    const tradeV = trades.map((t) => ({
      name: t.name,
      lines: t.lines,
      meanAfter: t.facts.meanAfter,
      weeklyT: t.facts.weeklyT,
      gapT: t.facts.gapT,
    }))
    // Amendment 1, F: the level lines on the rest against both baselines decide the words.
    const v = verdict([...amended.shuffled.lines, ...amended.mirrored.lines], tradeV)
    const w = verdict(rest ? rest.lines : ll, tradeV)
    const turn = RULES.find(
      (r) => r.kind === rule.kind && r.reading.measure === 'turn' && r.reading.k === rule.reading.k,
    )!
    const turnLift = pair
      ? ruleStats(
          byPool(input.sides.lv, turn.kind),
          byPool(input.sides.tv, twinPoolOf(turn.kind)),
          ruleMeasure(turn.reading),
          keep,
          [keepHalf(P, 0), keepHalf(P, 1)],
          markets,
          0,
        ).lift
      : turnLiftAtSameDistance(forty, forty[rule.index])
    const tb = basesFor(turn.index, pair ? p.market : 'ALL')
    results.push({
      role: p.role,
      key: p.key,
      market: p.market,
      by: p.by,
      fallback: p.fallback,
      chosenOn: { lift: p.lift, t: p.t },
      level,
      levelLines: ll,
      amended,
      trades,
      reading: v.reading,
      beside: v.beside,
      positive: v.positive,
      runNote: runNoteOnRest(rule.reading, [
        turnLift - tb.shuffled.all.mean,
        turnLift - tb.mirrored.all.mean,
      ]),
      asWritten: {
        reading: w.reading,
        beside: w.beside,
        positive: w.positive,
        runNote: runNote(rule.reading, turnLift),
      },
      rest,
    })
  }
  const num = (x: unknown) => (typeof x === 'number' ? x : NaN)
  const chosenLifts: number[] = (choose.rules as RuleRow[]).map((r) => num(r.lift))
  // The smaller of the two rests of each rule, on the choosing years (from choose.json) and here.
  const chosenRests: number[] = (choose.rules as RuleRow[]).map((r) =>
    Math.min(num(r.amended?.shuffled.rest.lift), num(r.amended?.mirrored.rest.lift)),
  )
  const checkRests = RULES.map((r) => {
    const b = basesFor(r.index, 'ALL')
    return {
      shuffled: forty[r.index].lift - b.shuffled.all.mean,
      mirrored: forty[r.index].lift - b.mirrored.all.mean,
    }
  })
  const smaller = checkRests.map((x) => Math.min(x.shuffled, x.mirrored))
  const rank = (a: number[], b: number[]) => {
    const both = RULES.filter((r) => Number.isFinite(a[r.index]) && Number.isFinite(b[r.index]))
    return {
      rho: spearman(
        both.map((r) => a[r.index]),
        both.map((r) => b[r.index]),
      ),
      n: both.length,
    }
  }
  const plainRank = rank(
    chosenLifts,
    forty.map((r) => r.lift),
  )
  const restRank = rank(chosenRests, smaller)
  const above = forty.filter((r) => r.lift > 0).length
  const restAbove = smaller.filter((x) => x > 0).length
  const p1 = part1(input, P.check)
  const p5 = part5(input, [P.check])
  const rulesTaken = picks.length

  const check = {
    rehearsal: P.rehearsal,
    label: P.label,
    generated: new Date().toISOString(),
    commit: gitInfo?.head ?? null,
    remote: gitInfo?.remote ?? null,
    marker: o.marker,
    data: o.data,
    choose: resolve(o.choosePath),
    chooseCommit: choose.commit,
    marketsUsed: used,
    marketsMissing: missing,
    files: filesInfo(runs),
    span: spanText(P.check),
    periods: P,
    seeds: o.seeds,
    taken: {
      rules: rulesTaken,
      byReading: {
        rest: picks.filter((p) => p.by === 'rest').length,
        asWritten: picks.filter((p) => p.by === 'as written').length,
        both: picks.filter((p) => p.by === 'both').length,
        fallback: picks.filter((p) => p.by === null).length,
      },
      ruleTradePairs: pairsToCheck,
      p2Bar: p2Bar(pairsToCheck),
    },
    results,
    placebo2: { shuffle: p2shuffle, shuffleGenerator: SHUFFLE_GENERATOR, rows: p2check },
    baselines: {
      seeds: o.seeds,
      shuffleGenerator: SHUFFLES_GENERATOR,
      mirrorGenerator: MIRROR_GENERATOR,
      series,
    },
    forty: {
      aboveZero: above,
      of: RULES.length,
      spearman: plainRank.rho,
      spearmanPairs: plainRank.n,
      restAboveZero: restAbove,
      restSpearman: restRank.rho,
      restSpearmanPairs: restRank.n,
      rows: RULES.map((r) => ({
        key: r.key,
        choosing: chosenLifts[r.index],
        checking: forty[r.index].lift,
        marketsAbove: forty[r.index].marketsAbove,
        restShuffled: checkRests[r.index].shuffled,
        restMirrored: checkRests[r.index].mirrored,
        smallerRestChoosing: chosenRests[r.index],
        smallerRestChecking: smaller[r.index],
      })),
    },
    part1: p1,
    part5: p5,
    seconds: NaN as number,
  }
  await writeData(o.out, input)
  check.seconds = (Date.now() - t0) / 1000
  writeFileSync(join(o.out, 'check.json'), json(check))
  writeFileSync(join(o.out, 'check.md'), checkMd(check, P, used))
  // Counts only: no rule's name and no number of a real result.
  const t = check.taken.byReading
  console.log(
    `${P.rehearsal ? 'REHEARSAL: ' : ''}check: ${rulesTaken} taken (${picks.filter((p) => p.role === 'rule').length} rules, ${picks.filter((p) => p.role === 'pair candidate').length} pair candidates; by the rest ${t.rest}, as written ${t.asWritten}, both ${t.both}${t.fallback ? `, rehearsal fallbacks ${t.fallback}` : ''}), ${pairsToCheck} rule and trade pairs, ${series.length} series with no memory; written to ${o.out}; ${check.seconds.toFixed(1)} s`,
  )
}

function lineRows(lines: Line[], d = 2): (string | number)[][] {
  return lines.map((l) => [
    l.line,
    l.rule,
    fn(l.value, Number.isInteger(l.value) ? 0 : d),
    l.ok ? 'holds' : 'fails',
  ])
}

/** Amendment 1, D: one baseline's rest on the checking years, in a sentence. */
const restSentence = (name: string, x: RestReading) =>
  `Against ${name}: baseline ${fx(x.baseline.all.mean)} (spread ${fn(x.baseline.all.spread, 2)}, ${x.baseline.all.n} series); rest ${fx(x.rest.lift)} (SE ${fn(x.rest.se, 2)}, t ${fn(x.rest.t, 2)}), above zero in ${x.rest.marketsAbove} of ${x.rest.marketsUsed} markets (${Object.entries(
    x.rest.marketLift,
  )
    .map(([m, v]) => `${m} ${fx(v)}`)
    .join(', ')}).`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkMd(c: any, P: LevelPeriods, markets: string[]): string {
  const label = P.rehearsal ? 'REHEARSAL: ' : ''
  const out: string[] = [`# ${label}Levels study: the check`, '']
  if (P.rehearsal)
    out.push(
      `**REHEARSAL inside the development years: checking on ${c.span}, not 2019 to 2025. Nothing here is a result of the study.**`,
      '',
    )
  const bySeries = (c.baselines.series as SeriesLifts[])
    .map((s) => `${s.kind} ${s.seed} ${s.seconds.toFixed(0)} s ${s.peakMB} MB`)
    .join('; ')
  out.push(
    `Generated ${c.generated}. Code: ${c.commit ?? 'rehearsal (no git test)'}. Choosing run: ${c.choose} (code ${c.chooseCommit ?? 'uncommitted tree'}). Marker: ${c.marker}.`,
    `Markets used: ${markets.join(', ')}.${c.marketsMissing.length ? ` Left out (file missing): ${c.marketsMissing.join(', ')}.` : ''}`,
    `Checking span: ${c.span}; visits by touch minute, trades by fill minute; levels built over each whole file.`,
    `Prices with no memory (Amendment 1, D): ${c.seeds} shuffled-days series (the checking years a block of their own) and ${c.seeds} mirrored-minutes series, built again on the whole files inside this check; baselines over the checking years. Seconds per series and the largest worker's peak memory: ${bySeries}.`,
    '',
    `## ${label}Verdict`,
    '',
    `Taken to the check: ${c.taken.rules} rules (the pair candidates included; by the rest ${c.taken.byReading.rest}, as written ${c.taken.byReading.asWritten}, both ${c.taken.byReading.both}${c.taken.byReading.fallback ? `, rehearsal fallbacks ${c.taken.byReading.fallback}` : ''}) and ${c.taken.ruleTradePairs} rule and trade pairs; P2's bar is a weekly t of ${c.taken.p2Bar.toFixed(1)}.`,
    '',
    `Readings, tried in this order: ${VERDICTS.map((v) => `"${v}"`).join(', ')}. The words use the level lines on the rest against both baselines (Amendment 1, F); the plan's own reading, as written, is printed beside them.`,
    '',
  )
  for (const r of c.results as CandidateResult[]) {
    out.push(
      `### ${r.role === 'pair candidate' ? `Pair candidate ${r.market}` : 'Rule'} ${r.key}${r.fallback ? ' (REHEARSAL fallback, not chosen)' : ` (chosen ${r.by === 'both' ? 'on the rest and as written' : r.by === 'rest' ? 'on the rest only' : 'as written only'})`}: **${r.reading}**`,
      '',
      `As written: ${r.asWritten.reading}.${r.asWritten.reading !== r.reading ? ' **The two readings differ.**' : ''}`,
      '',
      `Chosen on: lift ${fx(r.chosenOn.lift)}, t ${fn(r.chosenOn.t, 2)}. On the checking years: lift ${fx(r.level.lift)} (level ${fn(r.level.rate)} / twins ${fn(r.level.twinRate)}), t ${fn(r.level.t, 2)}, above zero in ${r.level.marketsAbove} of ${r.level.marketsUsed} markets.`,
      '',
      restSentence('shuffled days', r.amended.shuffled),
      '',
      restSentence('mirrored minutes', r.amended.mirrored),
      '',
      table(
        ['Line', 'Rule (on the rest)', 'Against shuffled days', '', 'Against mirrored minutes', ''],
        r.amended.shuffled.lines.map((l, i) => {
          const m = r.amended.mirrored.lines[i]
          const v = (x: Line) => fn(x.value, Number.isInteger(x.value) ? 0 : 2)
          return [l.line, l.rule, v(l), l.ok ? 'holds' : 'fails', v(m), m.ok ? 'holds' : 'fails']
        }),
      ),
      '',
      'The plain level lines, beside them:',
      '',
      table(['Line', 'Rule (plain)', 'Value', ''], lineRows(r.levelLines)),
      '',
    )
    if (r.rest) {
      const x = r.rest
      out.push(
        `**As written, read on the rest of seed 1** (its Placebo 2 lift lay outside 2.5 standard errors of zero on the choosing years). Placebo 2 on the checking years: lift ${fx(x.placebo2.lift)} (SE ${fn(x.placebo2.se, 2)}, t ${fn(x.placebo2.t, 2)})${x.outside ? ', outside 2.5 standard errors' : ''}${x.onlyWide ? `, ${ONLY_WIDE_TEXT}` : x.calm ? `; on days of at most 1.5 x ATR: ${fx(x.calm.lift)} (SE ${fn(x.calm.se, 2)})` : ''}. The rest: lift ${fx(x.rest.lift)} (SE ${fn(x.rest.se, 2)}, t ${fn(x.rest.t, 2)}), above zero in ${x.rest.marketsAbove} of ${x.rest.marketsUsed} markets (${Object.entries(
          x.rest.marketLift,
        )
          .map(([m, v]) => `${m} ${fx(v)}`)
          .join(', ')}).`,
        '',
        table(['Line', 'Rule (on the rest of seed 1)', 'Value', ''], lineRows(x.lines)),
        '',
      )
    }
    for (const t of r.trades) {
      const f = t.facts
      out.push(
        `**${t.name}**: ${f.n} trades, average after costs ${fx(f.meanAfter, 3)} R (before ${fx(f.meanBefore, 3)} R, double cost ${fx(f.meanDouble, 3)} R; ${fx(f.meanPips, 1)} pips after costs), weekly t ${fn(f.weeklyT, 2)}, gap to its twins ${fx(f.gap, 3)} R (t ${fn(f.gapT, 2)}). By year: ${
          Object.entries(f.byYear)
            .map(([y, s]) => `${y} ${fx(s, 1)}`)
            .join(', ') || '-'
        }. By market: ${
          Object.entries(f.byMarket)
            .map(([m, s]) => `${m} ${fx(s, 1)}`)
            .join(', ') || '-'
        }.${t.pass ? ' **Passes every trade line.**' : ''}`,
        '',
        table(['Line', 'Rule', 'Value', ''], lineRows(t.lines)),
        '',
      )
    }
    if (r.beside) out.push(`Beside it: ${r.beside}.`, '')
    if (r.runNote) out.push(`This Run rule is ${r.runNote} (on the rest).`, '')
    if (r.asWritten.runNote && !r.runNote)
      out.push(`As written (its plain Turn lift), this Run rule is ${r.asWritten.runNote}.`, '')
  }
  out.push(
    '## The forty rules on the checking years (description; no trade results for rules that were not chosen)',
    '',
    `Plain lifts: ${c.forty.aboveZero} of ${c.forty.of} above zero; Spearman rank correlation of the forty lifts between the choosing and the checking years: ${fn(c.forty.spearman, 3)} (${c.forty.spearmanPairs} rules).`,
    '',
    `The smaller of the two rests: ${c.forty.restAboveZero} of ${c.forty.of} above zero; Spearman between the choosing and the checking years: ${fn(c.forty.restSpearman, 3)} (${c.forty.restSpearmanPairs} rules).`,
    '',
    table(
      [
        'Rule',
        'Lift, choosing',
        'Lift, checking',
        'Markets above zero',
        'Rest, checking: shuffled days / mirrored minutes',
        'Smaller rest: choosing / checking',
      ],
      c.forty.rows.map(
        (r: {
          key: string
          choosing: number
          checking: number
          marketsAbove: number
          restShuffled: number
          restMirrored: number
          smallerRestChoosing: number
          smallerRestChecking: number
        }) => [
          r.key,
          fx(r.choosing),
          fx(r.checking),
          r.marketsAbove,
          `${fx(r.restShuffled)} / ${fx(r.restMirrored)}`,
          `${fx(r.smallerRestChoosing)} / ${fx(r.smallerRestChecking)}`,
        ],
      ),
    ),
    '',
    `## Part 1: how often (${c.span})`,
    '',
    part1Md(c.part1, markets),
    '',
    `## Part 5: pairs that move alike (${c.span})`,
    '',
    part5Md(c.part5, markets),
    '',
    `Run time ${c.seconds.toFixed(1)} s.`,
    '',
  )
  return out.join('\n')
}

// ---------------------------------------------------------------- the cut test

/** Fork one cut worker per job, `concurrency` at a time; each answers once. */
async function forkCut(jobs: CutJob[], concurrency: number): Promise<CutReply[]> {
  const out: CutReply[] = []
  const errors: string[] = []
  let next = 0
  const one = (job: CutJob) =>
    new Promise<void>((ok) => {
      const p = fork(join(__dirname, 'levels-cut-worker.ts'), [], {
        execArgv: ['--import', 'tsx'],
        serialization: 'advanced',
      })
      let settled = false
      p.on('message', (r: CutReply | { kind: 'ready' }) => {
        if (r.kind === 'ready') return void p.send(job)
        settled = true
        if (r.kind === 'error') errors.push(`${job.market}: ${r.error}`)
        else out.push(r)
        p.disconnect()
        ok()
      })
      p.on('exit', (code) => {
        if (!settled) {
          errors.push(`${job.market}: worker exited (${code})`)
          ok()
        }
      })
    })
  const lanes = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) await one(jobs[next++])
  })
  await Promise.all(lanes)
  if (errors.length) fail(`cut worker failed:\n${errors.join('\n')}`)
  return out
}

/**
 * The cut test on the choosing years: 40 minutes drawn over the markets
 * (CUT_KINDS), each file cut to the minutes stamped at or before its minute
 * and run again; one line per cut minute; exit 1 on any difference.
 */
async function runCut(data: string, jobs: number, detail: boolean) {
  const t0 = Date.now()
  const P = REAL_PERIODS
  const { used, missing, file } = marketsIn(data)
  if (!used.length) fail(`no market file in ${data}`)
  await refuseLate(used, file, P.refuseFrom)
  const base = (m: HarmonicMarket) => ({
    market: m,
    file: file(m),
    from: P.choose[0],
    to: P.choose[1],
  })
  const counted = await forkCut(
    used.map((m) => ({ phase: 'count', ...base(m) })),
    jobs,
  )
  const counts = used.map((m) => {
    const r = counted.find((x) => x.kind === 'count' && x.market === m)
    if (!r || r.kind !== 'count') fail(`${m}: no count`)
    return r.counts
  })
  const picks = pickCuts(counts).map((p, order) => ({ ...p, order }))
  console.log(
    `cut test: ${picks.length} minutes over ${used.join(', ')}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}, ${spanText(P.choose)}; ${CUT_GENERATOR}`,
  )
  const runJobs: CutJob[] = used
    .map((m, mi) => ({
      phase: 'run' as const,
      ...base(m),
      detail,
      picks: picks
        .filter((p) => p.market === mi)
        .map(({ order, kind, pos }) => ({ order, kind, pos })),
    }))
    .filter((j) => j.picks.length)
    .sort((a, b) => b.picks.length - a.picks.length)
  const ran = await forkCut(runJobs, jobs)
  const results: CutResult[] = ran
    .flatMap((r) => (r.kind === 'run' ? r.results : []))
    .sort((a, b) => a.order - b.order)
  let bad = 0
  for (const r of results) {
    const head = `cut ${String(r.order + 1).padStart(2, '0')}/${picks.length} ${r.market} ${iso(r.at)} (${CUT_KINDS[r.kind].name}):`
    const what = `${r.levels} levels, ${r.watchers} watchers (${r.linesOnlyWhole} far lines only in the whole run), ${r.levelVisits} level and round-number visits, ${r.twinVisits} twin and grid-line visits; ATR in force ${r.atr[0]}`
    if (!r.nDiffs) console.log(`${head} same; ${what}`)
    else {
      bad++
      console.log(`${head} DIFFERENT, ${r.nDiffs} differences; ${what}`)
      for (const d of r.diffs.slice(0, 8)) console.log(`    ${d}`)
    }
  }
  if (results.length !== picks.length) fail(`${picks.length - results.length} cut minutes missing`)
  console.log(
    `cut test: ${bad ? `${bad} of ${results.length} cut minutes DIFFER` : `all ${results.length} cut minutes equal the whole-file run`}; ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  )
  if (bad) process.exit(1)
}

// ---------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2]
  const jobs = Number(arg('jobs') ?? 4)
  if (!(jobs >= 1)) fail('--jobs must be 1 or more')
  // Amendment 1, A: choose and check always use ten series of each kind; only a rehearsal takes fewer.
  if (cmd !== 'rehearse' && process.argv.includes('--seeds'))
    fail('--seeds is for rehearse only: choose and check use ten series of each kind')
  const seeds = Number(arg('seeds') ?? BASELINE_SEEDS)
  if (!(Number.isInteger(seeds) && seeds >= 2 && seeds <= BASELINE_SEEDS))
    fail(`--seeds must be a whole number from 2 to ${BASELINE_SEEDS}`)
  if (cmd === 'choose') {
    await runChoose(need('data'), need('out'), REAL_PERIODS, jobs, BASELINE_SEEDS)
  } else if (cmd === 'check') {
    await runCheck(
      {
        data: need('data'),
        choosePath: need('choose'),
        out: need('out'),
        commit: need('commit'),
        marker: LEVELS_MARKER,
        gitTest: true,
        jobs,
        seeds: BASELINE_SEEDS,
      },
      REAL_PERIODS,
    )
  } else if (cmd === 'cut') {
    await runCut(need('data'), jobs, process.argv.includes('--detail'))
  } else if (cmd === 'rehearse') {
    const out = need('out')
    const data = need('data')
    const choosePath = await runChoose(data, join(out, 'choose'), REHEARSAL_PERIODS, jobs, seeds)
    await runCheck(
      {
        data,
        choosePath,
        out: join(out, 'check'),
        commit: null,
        marker: join(out, 'CHECK-RAN.json'),
        gitTest: false,
        jobs,
        seeds,
      },
      REHEARSAL_PERIODS,
    )
  } else {
    console.error(
      'usage: levels-study.ts choose --data <dir> --out <dir> [--jobs N]\n' +
        '       levels-study.ts check --data <dir> --choose <choose.json> --out <dir> --commit <sha> [--jobs N]\n' +
        '       levels-study.ts rehearse --data <dir> --out <dir> [--jobs N] [--seeds N]\n' +
        '       levels-study.ts cut --data <dir> [--jobs N] [--detail]',
    )
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
