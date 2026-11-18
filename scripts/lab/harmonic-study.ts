/**
 * Harmonic study runner (docs/harmonic-study.md, with Amendments 1 to 3).
 * Offline, play money only: reads local 1-minute files, nothing else.
 *
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-study.ts choose --data <dir> --out <dir>
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-study.ts check --data <dir> --choose <choose.json> --out <dir> --commit <sha>
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-study.ts rehearse --data <dir> --out <dir>
 *
 * choose: Parts 1 to 3 and Part 4's choosing on 2010 to 2018; refuses a file
 * with any bar from 2019 on. check: Part 4's single check on 2019 to 2025 for
 * the candidate and the pair candidate; refuses unless the tree is clean, HEAD
 * is <sha> and on a remote branch, choose.json was made by HEAD, the market
 * files are the ones the choosing run used, and the fixed marker does not
 * exist; writes the marker before any bar is read. rehearse: both, inside the development years
 * (choose 2010 to 2014, check 2015 to 2018, 20 twins), through the same code.
 * One worker per market (scripts/lab/harmonic-study-worker.ts).
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createGzip } from 'node:zlib'
import {
  EXIT_NAMES,
  HARMONIC_MARKETS,
  LOOK_HOURS,
  type HarmonicMarket,
} from '../../src/lib/lab/harmonic'
import { gitTest, markerPath, openCheck } from '../../src/lib/lab/harmonicCheckGate'
import {
  aboveZero,
  aheadOf,
  CHARTS,
  exitItems,
  inEntry,
  inSpan,
  inVersion,
  lookTable,
  PATTERN_NAMES,
  passLines,
  periodTime,
  qualifiedRanking,
  rankRows,
  reading,
  REAL_PERIODS,
  REHEARSAL_PERIODS,
  spearman,
  stats,
  SWING_SIZES,
  thirds,
  TWIN_GENERATOR,
  twinGroups,
  twinMoves,
  VERSION_ENTRIES,
  versionRows,
  VERSIONS,
  yearStart,
  type LookTable,
  type Part1Row,
  type Stats,
  type StudyPeriods,
  type TradeRec,
  type Version,
  type VersionEntry,
  type VersionRow,
} from '../../src/lib/lab/harmonicStudy'
import type { LoadJob, TwinJob, TwinSeed, WorkerReply } from './harmonic-study-worker'

const REPO = resolve(__dirname, '../..')
const NOT_EVEN_CHOOSING = 'it did not make money even in the years used for choosing'
const NO_PAIR = 'no version on any one market qualified'

// ---------------------------------------------------------------- small helpers

const iso = (t: number) => new Date(t * 1000).toISOString()
const day = (t: number) => iso(t).slice(0, 10)
const spanText = ([a, b]: [number, number]) => `${day(a)} to ${day(b - 86_400)}`

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
  console.error(`harmonic-study: ${msg}`)
  process.exit(1)
}

const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function gitState() {
  const status = git('status', '--porcelain')
  const head = git('rev-parse', 'HEAD')
  return { clean: status === '', head }
}

/** Markets whose development or full file is present; the others are named. */
function marketsIn(data: string) {
  const file = (m: HarmonicMarket) => join(data, `${m}_1m.csv.gz`)
  return {
    used: HARMONIC_MARKETS.filter((m) => existsSync(file(m))),
    missing: HARMONIC_MARKETS.filter((m) => !existsSync(file(m))),
    file,
  }
}

// ---------------------------------------------------------------- workers

type Loaded = Extract<WorkerReply, { kind: 'loaded' }>

class Pool {
  private procs = new Map<HarmonicMarket, ChildProcess>()
  private waiting = new Map<HarmonicMarket, (r: WorkerReply) => void>()

  async start(markets: HarmonicMarket[]) {
    await Promise.all(
      markets.map(
        (m) =>
          new Promise<void>((ok, bad) => {
            const p = fork(join(__dirname, 'harmonic-study-worker.ts'), [], {
              execArgv: ['--import', 'tsx'],
              serialization: 'advanced',
            })
            this.procs.set(m, p)
            p.on('message', (r: WorkerReply) => {
              if (r.kind === 'ready') return ok()
              const w = this.waiting.get(m)
              this.waiting.delete(m)
              w?.(r)
            })
            p.on('exit', (code) => {
              const w = this.waiting.get(m)
              this.waiting.delete(m)
              w?.({ kind: 'error', error: `worker ${m} exited (${code})` })
              bad(new Error(`worker ${m} exited (${code})`))
            })
          }),
      ),
    )
  }

  ask(m: HarmonicMarket, job: LoadJob | TwinJob): Promise<WorkerReply> {
    return new Promise((ok) => {
      this.waiting.set(m, ok)
      this.procs.get(m)!.send(job)
    })
  }

  stop() {
    for (const p of this.procs.values()) {
      p.removeAllListeners('exit')
      p.send({ kind: 'exit' })
    }
  }
}

/** Load every market in its worker; refuse the whole run if any file is refused or fails. */
async function loadAll(
  pool: Pool,
  markets: HarmonicMarket[],
  file: (m: HarmonicMarket) => string,
  job: Omit<LoadJob, 'kind' | 'market' | 'file'>,
): Promise<Loaded[]> {
  const replies = await Promise.all(
    markets.map((m) => pool.ask(m, { kind: 'load', market: m, file: file(m), ...job })),
  )
  const bad = replies.filter((r) => r.kind !== 'loaded')
  if (bad.length) {
    pool.stop()
    fail(
      'refused:\n' +
        bad
          .map((r) =>
            r.kind === 'refused' ? r.reason : r.kind === 'error' ? r.error : JSON.stringify(r),
          )
          .join('\n'),
    )
  }
  return replies as Loaded[]
}

// ---------------------------------------------------------------- markdown

const fx = (x: number | null | undefined, d = 3) =>
  x === null || x === undefined || Number.isNaN(x)
    ? '-'
    : (x > 0 && d > 0 ? '+' : '') + x.toFixed(d)
const fn = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d)
const pc = (x: number) => (Number.isNaN(x) ? '-' : `${(100 * x).toFixed(1)}%`)

function table(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

function lookMd(tables: { entry: VersionEntry; t: LookTable }[]): string {
  const out: string[] = []
  out.push(
    table(
      [
        'Entry',
        'Trades',
        'Stop came first',
        'Favour R (median / mean)',
        'Against R (median / mean)',
        'Favour pips (median / mean)',
        'Against pips (median / mean)',
        'Skips: R < 5 costs',
        'Entry beyond X1 or stop',
        'Cancelled',
        'No trigger',
      ],
      tables.map(({ entry, t }) => [
        entry,
        t.trades,
        `${t.stopFirst} (${pc(t.stopShare)})`,
        `${fn(t.favourR.median)} / ${fn(t.favourR.mean)}`,
        `${fn(t.againstR.median)} / ${fn(t.againstR.mean)}`,
        `${fn(t.favourPips.median, 1)} / ${fn(t.favourPips.mean, 1)}`,
        `${fn(t.againstPips.median, 1)} / ${fn(t.againstPips.mean, 1)}`,
        t.skips,
        t.skipEntry,
        t.cancelled,
        t.noTrigger,
      ]),
    ),
  )
  const note = (t: LookTable, sweet: 'sweetR' | 'sweetPips', i: number) =>
    t[sweet].index === i ? (t[sweet].made ? 'sweet spot' : 'least-losing') : ''
  out.push('', 'Targets in R (from the entry, with the stop and the time exit):', '')
  const rRows: (string | number)[][] = []
  tables[0].t.targetsR.forEach((row, i) => {
    for (const { entry, t } of tables) {
      const r = t.targetsR[i]
      rRows.push([
        row.label,
        entry,
        r.reached,
        pc(r.share),
        fx(r.meanBefore),
        fx(r.meanAfter),
        fn(r.t),
        note(t, 'sweetR', i),
      ])
    }
  })
  out.push(
    table(
      [
        'Target',
        'Entry',
        'Reached',
        'Share',
        'Avg R before costs',
        'Avg R after costs',
        't after',
        '',
      ],
      rRows,
    ),
  )
  for (const { entry, t } of tables) if (!t.sweetR.made) out.push('', `${entry}: ${t.sweetR.text}`)
  out.push('', 'Fixed targets in pips (gold in dollars), with the pattern stop:', '')
  const pRows: (string | number)[][] = []
  tables[0].t.targetsPips.forEach((row, i) => {
    for (const { entry, t } of tables) {
      const r = t.targetsPips[i]
      pRows.push([
        row.label,
        entry,
        r.reached,
        pc(r.share),
        fx(r.meanBeforePips, 1),
        fx(r.meanAfterPips, 1),
        fx(r.meanBefore),
        fx(r.meanAfter),
        fn(r.t),
        note(t, 'sweetPips', i),
      ])
    }
  })
  out.push(
    table(
      [
        'Target',
        'Entry',
        'Reached',
        'Share',
        'Avg pips before',
        'Avg pips after',
        'Avg R before',
        'Avg R after',
        't after',
        '',
      ],
      pRows,
    ),
  )
  for (const { entry, t } of tables)
    if (!t.sweetPips.made) out.push('', `${entry} (pip targets): ${t.sweetPips.text}`)
  out.push('', 'Worth at the first minute at or after N hours from the fill, stop in place:', '')
  const wRows: (string | number)[][] = []
  LOOK_HOURS.forEach((h, i) => {
    for (const { entry, t } of tables) {
      const w = t.worth[i]
      wRows.push([
        `${h} h`,
        entry,
        pc(w.wonBefore),
        fx(w.meanBefore),
        fx(w.meanAfter),
        fx(w.meanBeforePips, 1),
        fx(w.meanAfterPips, 1),
      ])
    }
  })
  out.push(
    table(
      [
        'After',
        'Entry',
        'Above zero before costs',
        'Avg R before',
        'Avg R after',
        'Avg pips before',
        'Avg pips after',
      ],
      wRows,
    ),
  )
  return out.join('\n')
}

const versionOf = (index: number) => VERSIONS[index]
const describeVersion = (v: Version) =>
  `${v.set === 'butterfly' ? 'Butterfly alone' : 'all four patterns'}, ${v.chart}-minute chart, swing size ${v.k}, entry ${v.entry}, exit ${EXIT_NAMES[v.exit]}`

function versionTable(rows: (VersionRow & { rank?: number })[], halves: string[]): string {
  return table(
    [
      'Rank',
      'Version',
      'Market',
      'Trades',
      'Won before costs',
      'Avg R before',
      'Avg R after',
      `Sum after ${halves[0]}`,
      `Sum after ${halves[1]}`,
      'Weekly t after',
      'Skips',
      'Qualifies',
    ],
    rows.map((r) => [
      r.rank ?? '',
      r.key,
      r.market,
      r.all.n,
      pc(r.all.wonBefore),
      fx(r.all.meanBefore),
      fx(r.all.mean),
      fx(r.halves[0].sum, 2),
      fx(r.halves[1].sum, 2),
      fn(r.all.t),
      r.skips,
      r.qualifies ? 'yes' : 'no',
    ]),
  )
}

// ---------------------------------------------------------------- choosing

interface Pick {
  market: HarmonicMarket | 'ALL'
  index: number
  key: string
  version: Version
  row: VersionRow
  /** Rehearsal only: taken although it does not qualify. */
  fallback: boolean
}

const pick = (r: VersionRow, fallback = false): Pick => ({
  market: r.market,
  index: r.index,
  key: r.key,
  version: versionOf(r.index),
  row: r,
  fallback,
})

function lookTables(recs: TradeRec[], span: [number, number], markets: HarmonicMarket[]) {
  const inside = recs.filter((r) => inSpan(periodTime(r), span))
  const groups: Record<string, Record<string, unknown>> = {}
  for (const g of ['ALL', ...markets] as const) {
    const gr = g === 'ALL' ? inside : inside.filter((r) => r.market === g)
    const perEntry: Record<string, unknown> = {}
    for (const e of VERSION_ENTRIES) {
      const er = gr.filter((r) => inEntry(r, e))
      const split = <K extends string | number>(keys: readonly K[], f: (r: TradeRec) => K) =>
        Object.fromEntries(
          keys.map((k) => [
            k,
            lookTable(
              er.filter((r) => f(r) === k),
              g,
            ),
          ]),
        )
      perEntry[e] = {
        pooled: lookTable(er, g),
        byChart: split(CHARTS, (r) => r.chart),
        bySwingSize: split(SWING_SIZES, (r) => r.k),
        byPattern: split(PATTERN_NAMES, (r) => r.pattern),
      }
    }
    groups[g] = perEntry
  }
  return groups as Record<string, Record<VersionEntry, { pooled: LookTable }>>
}

function part1Md(rows: Part1Row[]): string {
  const sum = (rs: Part1Row[]) =>
    rs.reduce(
      (a, r) => {
        for (const k of [
          'formed',
          'skipped',
          'completed',
          'cancelled_c',
          'cancelled_time',
          'cancelled_swing',
          'waiting',
          'fromTwoPatternC',
          'twoPatternCs',
        ] as const)
          a[k] += r[k]
        return a
      },
      {
        formed: 0,
        skipped: 0,
        completed: 0,
        cancelled_c: 0,
        cancelled_time: 0,
        cancelled_swing: 0,
        waiting: 0,
        fromTwoPatternC: 0,
        twoPatternCs: 0,
      },
    )
  const head = [
    'Formed',
    'Skipped (confirming candle)',
    'Completed',
    'Cancelled: beyond C',
    'Cancelled: 192 candles',
    'Cancelled: next swing',
    'Still waiting',
    'C with two patterns',
  ]
  const cells = (s: ReturnType<typeof sum>, pattern: string) => [
    s.formed,
    s.skipped,
    s.completed,
    s.cancelled_c,
    s.cancelled_time,
    s.cancelled_swing,
    s.waiting,
    pattern === 'all' ? s.twoPatternCs : s.fromTwoPatternC,
  ]
  const yearsSeen = [...new Set(rows.map((r) => r.year))].sort()
  const out: string[] = []
  out.push(
    `All years in the files (${yearsSeen[0]} to ${yearsSeen[yearsSeen.length - 1]}), by the year of the confirming candle's close. "C with two patterns" on a pattern row counts that pattern's C's that gave two; on the "all" row it counts the C's.`,
    '',
  )
  const keyRows: (string | number)[][] = []
  for (const m of HARMONIC_MARKETS)
    for (const chart of CHARTS)
      for (const k of SWING_SIZES)
        for (const p of [...PATTERN_NAMES, 'all'] as const) {
          const rs = rows.filter(
            (r) => r.market === m && r.chart === chart && r.k === k && r.pattern === p,
          )
          if (rs.length) keyRows.push([m, `${chart}m`, k, p, ...cells(sum(rs), p)])
        }
  out.push(table(['Market', 'Chart', 'Swing size', 'Pattern', ...head], keyRows))
  out.push('', 'By year, all markets, charts and swing sizes together:', '')
  const yRows: (string | number)[][] = []
  for (const y of yearsSeen)
    for (const p of [...PATTERN_NAMES, 'all'] as const) {
      const rs = rows.filter((r) => r.year === y && r.pattern === p)
      if (rs.length) yRows.push([y, p, ...cells(sum(rs), p)])
    }
  out.push(table(['Year', 'Pattern', ...head], yRows))
  return out.join('\n')
}

async function writeTrades(file: string, recs: TradeRec[]) {
  const gz = createGzip()
  const done = new Promise<void>((ok, bad) => {
    const out = createWriteStream(file)
    out.on('finish', ok)
    out.on('error', bad)
    gz.pipe(out)
  })
  for (const r of recs) {
    const { uid: _uid, ...rest } = r
    void _uid
    if (!gz.write(JSON.stringify(rest) + '\n'))
      await new Promise<void>((ok) => gz.once('drain', () => ok()))
  }
  gz.end()
  await done
}

/**
 * Rehearsal only, when nothing qualifies: the top-ranked version by weekly t
 * among those with enough trades (the halves test dropped), else among all
 * with a trade, so the check path runs on a real list of trades.
 */
function fallbackRanking(rows: VersionRow[], minTrades: number): VersionRow[] {
  const enough = rankRows(rows.filter((r) => r.all.n >= minTrades))
  return enough.length ? enough : rankRows(rows.filter((r) => r.all.n > 0))
}

async function runChoose(data: string, out: string, P: StudyPeriods) {
  const t0 = Date.now()
  const { used, missing, file } = marketsIn(data)
  if (!used.length) fail(`no market file in ${data}`)
  const pool = new Pool()
  await pool.start(used)
  const loaded = await loadAll(pool, used, file, {
    refuseFrom: P.refuseFrom,
    readBefore: P.readBefore,
    keepFrom: 0,
  })
  pool.stop()
  for (const l of loaded)
    if (l.bars && l.last >= P.refuseFrom) fail(`${l.market}: a bar at ${iso(l.last)}`)
  const tLoad = Date.now()
  const recs = loaded.flatMap((l) => l.recs)
  const part1 = loaded.flatMap((l) => l.part1)
  const label = P.rehearsal ? 'REHEARSAL: ' : ''
  mkdirSync(out, { recursive: true })

  // Parts 2 and 3.
  const looks = lookTables(recs, P.choose, used)
  const part2 = {
    rehearsal: P.rehearsal,
    label: P.label,
    span: spanText(P.choose),
    note: 'Entry E0; each table pools both charts, both swing sizes and all four patterns (Amendment 3 point 8). Results in R.',
    groups: Object.fromEntries(Object.entries(looks).map(([g, v]) => [g, v.E0])),
  }
  const part3 = {
    rehearsal: P.rehearsal,
    label: P.label,
    span: spanText(P.choose),
    note: 'C1 to C5 beside E0; C3 = E0 with the trend, C4 = E0 in London and New York hours, C5 = C1 with the trend.',
    groups: looks,
  }

  // Part 4.
  const pooledRows = versionRows(recs, 'ALL', P.choose, P.halves, P.minTradesAll)
  const ranked = qualifiedRanking(pooledRows)
  let candidate: Pick | null = ranked.length ? pick(ranked[0]) : null
  const nextFour = ranked.slice(1, 5).map((r) => pick(r))
  if (!candidate && P.rehearsal) {
    const any = fallbackRanking(pooledRows, P.minTradesAll)
    if (any.length) candidate = pick(any[0], true)
  }
  const perMarket: Record<string, VersionRow[]> = {}
  for (const m of used)
    perMarket[m] = versionRows(
      recs.filter((r) => r.market === m),
      m,
      P.choose,
      P.halves,
      P.minTradesMarket,
    )
  const allMarketRows = Object.values(perMarket).flat()
  const pairRanked = qualifiedRanking(allMarketRows)
  let pair: Pick | null = pairRanked.length ? pick(pairRanked[0]) : null
  if (!pair && P.rehearsal) {
    const any = fallbackRanking(allMarketRows, P.minTradesMarket)
    if (any.length) pair = pick(any[0], true)
  }

  const g = gitState()
  const tradesPerEntry = Object.fromEntries(
    VERSION_ENTRIES.map((e) => [
      e,
      recs.filter((r) => r.status === 'filled' && inEntry(r, e) && inSpan(r.fillTime, P.choose))
        .length,
    ]),
  )
  const halvesText = P.halves.map(spanText)
  const choose = {
    rehearsal: P.rehearsal,
    label: P.label,
    generated: new Date().toISOString(),
    commit: g.clean ? g.head : null,
    tree: g.clean ? 'clean' : `not clean (HEAD ${g.head})`,
    data,
    marketsUsed: used,
    marketsMissing: missing,
    files: loaded.map((l) => ({
      market: l.market,
      bars: l.bars,
      first: iso(l.first),
      last: iso(l.last),
    })),
    periods: P,
    span: spanText(P.choose),
    halves: halvesText,
    tradesPerEntry,
    qualifying: ranked.length,
    candidate,
    nextFour,
    candidateText: candidate
      ? candidate.fallback
        ? 'REHEARSAL ONLY: no version qualified; the top-ranked version is taken so the check path still runs'
        : `candidate: ${describeVersion(candidate.version)}`
      : NOT_EVEN_CHOOSING,
    pairQualifying: pairRanked.length,
    pairCandidate: pair,
    pairNextFour: pairRanked.slice(1, 5).map((r) => pick(r)),
    pairText: pair
      ? pair.fallback
        ? 'REHEARSAL ONLY: no version on one market qualified; the top-ranked one is taken'
        : `pair candidate: ${pair.market}, ${describeVersion(pair.version)}`
      : NO_PAIR,
    versions: pooledRows,
    perMarket,
    seconds: { load: (tLoad - t0) / 1000, total: NaN as number },
  }

  // Files.
  writeFileSync(join(out, 'part1.json'), JSON.stringify({ label: P.label, rows: part1 }))
  writeFileSync(join(out, 'part2.json'), JSON.stringify(part2))
  writeFileSync(join(out, 'part3.json'), JSON.stringify(part3))
  await writeTrades(join(out, 'trades.jsonl.gz'), recs)
  choose.seconds.total = (Date.now() - t0) / 1000
  writeFileSync(join(out, 'choose.json'), JSON.stringify(choose))

  const md: string[] = []
  md.push(
    `# ${label}Harmonic study: choosing run`,
    '',
    P.rehearsal
      ? `**REHEARSAL inside the development years: choosing on ${spanText(P.choose)}, not the plan's choosing years. Nothing here is a result of the study.**\n`
      : '',
    `Generated ${choose.generated}. Code: ${choose.commit ?? choose.tree}. Data: ${data}.`,
    `Markets used: ${used.join(', ')}.${missing.length ? ` Left out (file missing): ${missing.join(', ')}.` : ''}`,
    `Choosing span: ${spanText(P.choose)} (halves ${halvesText.join(' and ')}), by fill minute. The run reads no price at or after ${day(P.readBefore)}.`,
    '',
    'Filled trades in the choosing span per entry: ' +
      VERSION_ENTRIES.map((e) => `${e} ${tradesPerEntry[e]}`).join(', ') +
      '.',
    '',
    '## Part 1: how often the patterns appear',
    '',
    part1Md(part1),
    '',
    `## Part 2: the look-back (entry E0, trades filled ${spanText(P.choose)})`,
    '',
    'Each table pools both charts, both swing sizes and all four patterns. "How far price went" is the Bid from the Bid at entry, before costs. The splits by chart, swing size and pattern are in part2.json.',
  )
  for (const gname of ['ALL', ...used]) {
    md.push('', `### ${gname === 'ALL' ? 'All markets together' : gname}`, '')
    md.push(lookMd([{ entry: 'E0', t: looks[gname].E0.pooled }]))
  }
  md.push(
    '',
    `## Part 3: do our confirmations help? (trades filled ${spanText(P.choose)})`,
    '',
    'C1 RSI and EMA; C2 reversal candle; C3 = E0 with the 4-hour trend; C4 = E0 in London and New York hours; C5 = C1 with the trend. Splits in part3.json.',
  )
  for (const gname of ['ALL', ...used]) {
    md.push('', `### ${gname === 'ALL' ? 'All markets together' : gname}`, '')
    md.push(lookMd(VERSION_ENTRIES.map((e) => ({ entry: e, t: looks[gname][e].pooled }))))
  }
  md.push('', '## Part 4: choosing', '')
  md.push(
    `A version qualifies with at least ${P.minTradesAll} trades over ${spanText(P.choose)} and a sum of results above zero after costs in both ${halvesText.join(' and ')}. Ranked by weekly t-statistic after costs; ties by pattern set, chart, swing size, entry, exit.`,
    '',
    `Qualifying versions: ${ranked.length} of ${VERSIONS.length}.`,
    '',
  )
  if (candidate) {
    md.push(
      `**${candidate.fallback ? 'REHEARSAL ONLY (nothing qualified, top-ranked taken)' : 'The candidate'}: ${candidate.key}** (${describeVersion(candidate.version)}).`,
      '',
    )
    md.push(
      versionTable(
        [candidate.row, ...nextFour.map((p) => p.row)].map((r, i) => ({ ...r, rank: i + 1 })),
        halvesText,
      ),
    )
    if (nextFour.length) md.push('', 'Ranks 2 to 5 are listed for description only.')
  } else md.push(`**${NOT_EVEN_CHOOSING}**`)
  md.push(
    '',
    `### The pair candidate (each market alone: at least ${P.minTradesMarket} trades, both halves above zero)`,
    '',
    `Qualifying market versions: ${pairRanked.length} of ${allMarketRows.length}.`,
    '',
  )
  if (pair) {
    md.push(
      `**${pair.fallback ? 'REHEARSAL ONLY (nothing qualified, top-ranked taken)' : 'The pair candidate'}: ${pair.market} ${pair.key}** (${describeVersion(pair.version)}).`,
      '',
      versionTable(
        [pair.row, ...pairRanked.slice(1, 5)].map((r, i) => ({ ...r, rank: i + 1 })),
        halvesText,
      ),
    )
  } else md.push(`**${NO_PAIR}**`)
  md.push('', 'Best qualifying version per market:', '')
  md.push(
    versionTable(
      used.flatMap((m) => qualifiedRanking(perMarket[m]).slice(0, 1)),
      halvesText,
    ),
  )
  md.push('', '### All 336 versions, all markets together, by weekly t', '')
  md.push(
    versionTable(
      rankRows(pooledRows).map((r, i) => ({ ...r, rank: i + 1 })),
      halvesText,
    ),
  )
  md.push('', `Run time ${choose.seconds.total.toFixed(1)} s.`, '')
  writeFileSync(join(out, 'choose.md'), md.filter((x) => x !== undefined).join('\n'))
  console.log(
    `${label}choose: ${used.length} markets, ${recs.length} trade records, ` +
      VERSION_ENTRIES.map((e) => `${e} ${tradesPerEntry[e]}`).join(' ') +
      `; candidate ${candidate ? candidate.key + (candidate.fallback ? ' (fallback)' : '') : 'none'}; pair ${pair ? pair.market + ' ' + pair.key + (pair.fallback ? ' (fallback)' : '') : 'none'}; ${choose.seconds.total.toFixed(1)} s`,
  )
  return join(out, 'choose.json')
}

// ---------------------------------------------------------------- checking

interface CheckOpts {
  data: string
  choosePath: string
  out: string
  marker: string
  commit: string | null
  /** The real check tests git; the rehearsal does not. */
  gitTest: boolean
}

function checkGit(sha: string) {
  const g = gitTest(sha, git)
  if ('refuse' in g) fail(g.refuse)
  return g
}

interface Candidacy {
  role: 'candidate' | 'pair candidate'
  pick: Pick
}

async function runCheck(o: CheckOpts, P: StudyPeriods) {
  const t0 = Date.now()
  if (!existsSync(o.choosePath)) fail(`no ${o.choosePath}`)
  const choose = JSON.parse(readFileSync(o.choosePath, 'utf8'))
  if (choose.rehearsal !== P.rehearsal)
    fail(`${o.choosePath} is ${choose.rehearsal ? 'a rehearsal' : 'a real choosing run'}`)
  const cands: Candidacy[] = []
  if (choose.candidate) cands.push({ role: 'candidate', pick: choose.candidate })
  if (choose.pairCandidate) cands.push({ role: 'pair candidate', pick: choose.pairCandidate })
  if (!cands.length) fail('choose.json names neither a candidate nor a pair candidate')
  const gitInfo = o.gitTest ? checkGit(o.commit ?? fail('missing --commit')) : null
  // Which files exist (nothing is read): a wrong --data must not use up the check.
  const { used, missing, file } = marketsIn(o.data)
  if (!used.length) fail(`no market file in ${o.data}`)
  // The marker is written before any bar is read.
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
      candidates: cands.map((c) => ({ role: c.role, market: c.pick.market, key: c.pick.key })),
    },
  })
  if (refusal) fail(refusal)
  mkdirSync(o.out, { recursive: true })

  const pool = new Pool()
  await pool.start(used)
  const loaded = await loadAll(pool, used, file, {
    refuseFrom: P.rehearsal ? P.refuseFrom : null,
    readBefore: null,
    keepFrom: P.check[0],
  })
  const recs = loaded.flatMap((l) => l.recs)
  const inCheck = recs.filter((r) => inSpan(periodTime(r), P.check))

  const results = []
  for (const c of cands) {
    const v: Version = VERSIONS[c.pick.index]
    if (v.key !== c.pick.key) fail(`version ${c.pick.index} is ${v.key}, not ${c.pick.key}`)
    const mine = inCheck.filter(
      (r) =>
        r.status === 'filled' &&
        inVersion(r, v) &&
        (c.pick.market === 'ALL' || r.market === c.pick.market),
    )
    const skips = inCheck.filter(
      (r) =>
        r.status === 'skipRisk' &&
        inVersion(r, v) &&
        (c.pick.market === 'ALL' || r.market === c.pick.market),
    ).length
    const items = exitItems(mine, v.exit)
    const all = stats(items)
    const sub = (f: (r: TradeRec) => boolean) => stats(exitItems(mine.filter(f), v.exit))
    const byYear = P.checkYears.map((y) => ({
      year: y,
      ...sub((r) => inSpan(r.fillTime, [yearStart(y), yearStart(y + 1)])),
    }))
    const marketsHere: HarmonicMarket[] = c.pick.market === 'ALL' ? used : [c.pick.market]
    const byMarket = marketsHere.map((m) => ({ market: m, ...sub((r) => r.market === m) }))
    const byDir = [
      { dir: 'buys', ...sub((r) => r.dir === 1) },
      { dir: 'sells', ...sub((r) => r.dir === -1) },
    ]
    const third = thirds(mine.map((r) => ({ r, size: r.R! / r.entryPrice!, time: r.fillTime! })))
    const byThird = third.map((part, i) => ({
      third: ['smallest', 'middle', 'largest'][i],
      sizeFrom: part.length ? part[0].size : NaN,
      sizeTo: part.length ? part[part.length - 1].size : NaN,
      ...stats(
        exitItems(
          part.map((x) => x.r),
          v.exit,
        ),
      ),
    }))

    // Twins: one move per (market, UTC fill date) group per seed.
    const tw = twinGroups(mine.map((r) => ({ market: r.market, fillTime: r.fillTime! })))
    const movesBySeed = Array.from({ length: P.twins }, (_, s) =>
      twinMoves(s + 1, tw.groups.length),
    )
    const seeds: TwinSeed[] = Array.from({ length: P.twins }, () => ({
      n: 0,
      sumAfter: 0,
      sumBefore: 0,
    }))
    const replies = await Promise.all(
      marketsHere.map((m) => {
        const idx = mine.map((r, i) => (r.market === m ? i : -1)).filter((i) => i >= 0)
        const moves: number[] = []
        for (let s = 0; s < P.twins; s++)
          for (const i of idx) moves.push(movesBySeed[s][tw.ofTrade[i]])
        return pool.ask(m, {
          kind: 'twins',
          jobs: [
            {
              name: c.role,
              exit: v.exit,
              uids: idx.map((i) => mine[i].uid),
              moves,
              seeds: P.twins,
            },
          ],
        })
      }),
    )
    for (const rep of replies) {
      if (rep.kind !== 'twins') fail(`twins: ${JSON.stringify(rep)}`)
      rep.results[0].seeds.forEach((s, i) => {
        seeds[i].n += s.n
        seeds[i].sumAfter += s.sumAfter
        seeds[i].sumBefore += s.sumBefore
      })
    }
    const twinAfter = seeds.map((s) => (s.n ? s.sumAfter / s.n : NaN))
    const twinBefore = seeds.map((s) => (s.n ? s.sumBefore / s.n : NaN))
    const aheadAfter = aheadOf(all.mean, twinAfter)
    const aheadBefore = aheadOf(all.meanBefore, twinBefore)
    const pair = c.role === 'pair candidate'
    const lines = passLines(
      {
        n: all.n,
        t: all.t,
        yearsAbove: byYear.filter(aboveZero).length,
        ahead: aheadAfter,
        doubleSum: all.sumDouble,
        marketsAbove: pair ? null : byMarket.filter(aboveZero).length,
        marketsUsed: pair ? null : used.length,
      },
      pair ? P.passTradesPair : P.passTrades,
      P,
    )
    const pass = lines.every((l) => l.ok)
    const read = reading(
      { pass, meanAfter: all.mean, aheadAfter, tBefore: all.tBefore, aheadBefore },
      P,
    )
    results.push({
      role: c.role,
      market: c.pick.market,
      key: v.key,
      description: describeVersion(v),
      fallback: c.pick.fallback,
      chosenOn: c.pick.row,
      trades: all.n,
      skips,
      all,
      byYear,
      byMarket,
      byDir,
      byThird,
      twins: {
        generator: TWIN_GENERATOR,
        seeds: `1 to ${P.twins}`,
        perSeed: seeds.map((s, i) => ({
          seed: i + 1,
          ...s,
          meanAfter: twinAfter[i],
          meanBefore: twinBefore[i],
        })),
        aheadAfter,
        aheadBefore,
        leftOutMean: P.twins ? seeds.reduce((a, s) => a + (all.n - s.n), 0) / P.twins : NaN,
      },
      passLines: lines,
      pass,
      beforeCosts: {
        t: all.tBefore,
        aheadOfTwins: aheadBefore,
        clears2and4: all.tBefore >= P.minT && aheadBefore >= P.minAhead,
      },
      reading: read,
    })
  }
  pool.stop()

  // All 336 versions on the checking span, all markets together.
  const checkRows = versionRows(recs, 'ALL', P.check, [P.check, P.check], 0)
  const chosenRows: VersionRow[] = choose.versions
  const both = VERSIONS.filter((v) => chosenRows[v.index].all.n > 0 && checkRows[v.index].all.n > 0)
  const rho = spearman(
    both.map((v) => chosenRows[v.index].all.mean),
    both.map((v) => checkRows[v.index].all.mean),
  )
  const above = checkRows.filter((r) => aboveZero(r.all)).length
  const part1 = loaded.flatMap((l) => l.part1)

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
    files: loaded.map((l) => ({
      market: l.market,
      bars: l.bars,
      first: iso(l.first),
      last: iso(l.last),
    })),
    span: spanText(P.check),
    periods: P,
    results,
    versions: {
      aboveZero: above,
      of: VERSIONS.length,
      spearman: rho,
      spearmanPairs: both.length,
      rows: checkRows.map((r) => ({
        index: r.index,
        key: r.key,
        chosen: chosenRows[r.index].all,
        checked: r.all,
      })),
    },
    part1,
    seconds: (Date.now() - t0) / 1000,
  }
  writeFileSync(join(o.out, 'check.json'), JSON.stringify(check))
  writeFileSync(join(o.out, 'check.md'), checkMd(check, P))
  console.log(
    `${P.rehearsal ? 'REHEARSAL: ' : ''}check: ` +
      results
        .map((r) => `${r.role} ${r.market} ${r.key}: ${r.trades} trades, ${r.reading}`)
        .join('; ') +
      `; ${above}/${VERSIONS.length} versions above zero, Spearman ${fn(rho, 3)}; ${check.seconds.toFixed(1)} s`,
  )
}

function statRow(label: string | number, s: Stats): (string | number)[] {
  return [
    label,
    s.n,
    pc(s.wonBefore),
    fx(s.meanBefore),
    fx(s.mean),
    fx(s.meanDouble),
    fx(s.sum, 2),
    fn(s.t),
  ]
}
const STAT_HEAD = [
  '',
  'Trades',
  'Won before costs',
  'Avg R before',
  'Avg R after',
  'Avg R double cost',
  'Sum R after',
  'Weekly t after',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkMd(c: any, P: StudyPeriods): string {
  const label = P.rehearsal ? 'REHEARSAL: ' : ''
  const md: string[] = [
    `# ${label}Harmonic study: checking run`,
    '',
    P.rehearsal
      ? `**REHEARSAL inside the development years: checking on ${c.span}. Nothing here is a result of the study.**\n`
      : '',
    `Generated ${c.generated}. Code: ${c.commit ?? 'not tested (rehearsal)'}. Choose file: ${c.choose} (code ${c.chooseCommit ?? 'not committed'}).`,
    `Markets used: ${c.marketsUsed.join(', ')}.${c.marketsMissing.length ? ` Left out (file missing): ${c.marketsMissing.join(', ')}.` : ''}`,
    `Checking span: ${c.span}, trades by fill minute; swings and indicators over each whole file. Marker: ${c.marker}.`,
    '',
  ]
  for (const r of c.results) {
    md.push(
      `## The ${r.role}: ${r.market === 'ALL' ? 'all markets' : r.market}, ${r.key}`,
      '',
      `${r.description}.${r.fallback ? ' REHEARSAL ONLY: taken although nothing qualified.' : ''}`,
      '',
      `**Reading: "${r.reading}"**`,
      '',
      table(
        ['Line', 'Rule (after costs)', 'Value', 'Holds'],
        r.passLines.map((l: { line: number; rule: string; value: number; ok: boolean }) => [
          l.line,
          l.rule,
          Number.isInteger(l.value) ? l.value : fn(l.value, 3),
          l.ok ? 'yes' : 'no',
        ]),
      ),
      '',
      `Before costs: weekly t ${fn(r.beforeCosts.t)}, ahead of ${r.beforeCosts.aheadOfTwins} of ${P.twins} twins (clears lines 2 and 4 before costs: ${r.beforeCosts.clears2and4 ? 'yes' : 'no'}). Skips (R under 5 costs): ${r.skips}.`,
      '',
      table(STAT_HEAD, [statRow('All', r.all)]),
      '',
      'Each year:',
      '',
      table(
        STAT_HEAD,
        r.byYear.map((y: Stats & { year: number }) => statRow(y.year, y)),
      ),
      '',
      'Each market:',
      '',
      table(
        STAT_HEAD,
        r.byMarket.map((y: Stats & { market: string }) => statRow(y.market, y)),
      ),
      '',
      'Buys and sells:',
      '',
      table(
        STAT_HEAD,
        r.byDir.map((y: Stats & { dir: string }) => statRow(y.dir, y)),
      ),
      '',
      'Thirds by size of R (R / entry price):',
      '',
      table(
        [...STAT_HEAD, 'R / price from', 'to'],
        r.byThird.map((y: Stats & { third: string; sizeFrom: number; sizeTo: number }) => [
          ...statRow(y.third, y),
          y.sizeFrom.toExponential(3),
          y.sizeTo.toExponential(3),
        ]),
      ),
      '',
      `Twins (${r.twins.seeds}; ${r.twins.generator}): ahead of ${r.twins.aheadAfter} after costs, ${r.twins.aheadBefore} before costs. Trades left out per twin on average: ${fn(r.twins.leftOutMean, 1)}.`,
      '',
    )
    const ta = r.twins.perSeed
      .map((s: { meanAfter: number }) => s.meanAfter)
      .filter((x: number) => !Number.isNaN(x))
      .sort((a: number, b: number) => a - b)
    if (ta.length)
      md.push(
        `Twin averages after costs: lowest ${fx(ta[0])}, median ${fx(ta[Math.floor(ta.length / 2)])}, highest ${fx(ta[ta.length - 1])}; the ${r.role}: ${fx(r.all.mean)}.`,
        '',
      )
  }
  md.push(
    '## All 336 versions on the checking span',
    '',
    `Above zero after costs: ${c.versions.aboveZero} of ${c.versions.of}. Spearman rank correlation of the average result per trade between the choosing and the checking span: ${fn(c.versions.spearman, 3)} over ${c.versions.spearmanPairs} versions with a trade in both. Nothing here is used to choose.`,
    '',
    table(
      [
        'Version',
        'Trades chosen',
        'Avg R after chosen',
        'Trades checked',
        'Avg R before checked',
        'Avg R after checked',
        'Weekly t checked',
      ],
      c.versions.rows.map((r: { key: string; chosen: Stats; checked: Stats }) => [
        r.key,
        r.chosen.n,
        fx(r.chosen.mean),
        r.checked.n,
        fx(r.checked.meanBefore),
        fx(r.checked.mean),
        fn(r.checked.t),
      ]),
    ),
    '',
    `## Part 1 for ${c.span}`,
    '',
    part1Md(c.part1),
    '',
    `Run time ${c.seconds.toFixed(1)} s.`,
    '',
  )
  return md.join('\n')
}

// ---------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2]
  if (cmd === 'choose') {
    await runChoose(need('data'), need('out'), REAL_PERIODS)
  } else if (cmd === 'check') {
    await runCheck(
      {
        data: need('data'),
        choosePath: need('choose'),
        out: need('out'),
        commit: need('commit'),
        marker: markerPath(false, ''),
        gitTest: true,
      },
      REAL_PERIODS,
    )
  } else if (cmd === 'rehearse') {
    const out = need('out')
    const data = need('data')
    const choosePath = await runChoose(data, join(out, 'choose'), REHEARSAL_PERIODS)
    await runCheck(
      {
        data,
        choosePath,
        out: join(out, 'check'),
        commit: null,
        marker: markerPath(true, out),
        gitTest: false,
      },
      REHEARSAL_PERIODS,
    )
  } else {
    console.error(
      'usage: harmonic-study.ts choose --data <dir> --out <dir>\n' +
        '       harmonic-study.ts check --data <dir> --choose <choose.json> --out <dir> --commit <sha>\n' +
        '       harmonic-study.ts rehearse --data <dir> --out <dir>',
    )
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
