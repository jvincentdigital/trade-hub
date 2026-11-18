/**
 * Harmonic study, Amendment 5 (docs/harmonic-study.md): the lead of
 * Amendment 4, frozen, on four yen pairs the study never opened. Offline,
 * play money only: reads local 1-minute files, nothing else.
 *
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-repl.ts reproduce --dev <dir> --full-gbpjpy <file>
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-repl.ts rehearse --data <dev dir> --out <dir> [--after-error --error-note <file>]
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-repl.ts run --data <dir> --gbpjpy <file> --out <dir> --commit <sha> [--after-error --error-note <file>]
 *
 * reproduce: Amendment 4's table (GBP/JPY development copy, 2010 to 2018)
 * and its check (GBP/JPY full file, 2019 to 2025), with the functions the
 * run uses; reads only those two files; exits 1 on any FAIL. rehearse: the
 * whole pooled path with GBP/JPY and EUR/JPY's development copies as the
 * pairs, 2010 to 2018, 20 twins, the marker in the out folder. run: the one
 * real run; refuses unless the tree is clean, HEAD is <sha> and on a remote
 * branch, exactly the files of REPL_MARKETS and the GBP/JPY file are there
 * and the fixed marker does not exist; writes the marker before any bar of
 * the pairs is read; prints no figure; writes REPL-DONE.json and then
 * every output at the end. --after-error (one second run, Amendment 5 step
 * 4) needs the first marker, no REPL-DONE.json, no results in this or the
 * first run's out folder, the first run's process gone, and a note of the
 * error and the fix, which goes into the second marker and the results.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  fourHourCandles,
  harmonicContext,
  MARKET_COSTS,
  runHarmonic,
  type HarmonicMarket,
} from '../../src/lib/lab/harmonic'
import { gitTest } from '../../src/lib/lab/harmonicCheckGate'
import {
  holdIndex,
  LEAD_HOLDS,
  leadFigures,
  leadTrade,
  leadTwins,
  selectLead,
  type LeadTrade,
  type TwinSum,
} from '../../src/lib/lab/harmonicLead'
import { readMarket } from '../../src/lib/lab/harmonicLoad'
import {
  dailyCloses,
  dailyCorrelation,
  pairDescription,
  pooledFigures,
  pooledTwins,
  READING_NOTES,
  REPL_CANDIDATES,
  REPL_REFERENCE,
  REPL_REHEARSAL,
  REPL_SETTINGS,
  replGate,
  replVerdict,
  sumTwins,
  twinMeans,
  type PairDescription,
  type PooledFigures,
  type ReplSettings,
  type ReplVerdict,
  type TwinTrade,
} from '../../src/lib/lab/harmonicRepl'
import {
  aheadOf,
  CHARTS,
  median,
  SWING_SIZES,
  yearStart,
  type Span,
} from '../../src/lib/lab/harmonicStudy'

const REPO = resolve(__dirname, '../..')
/** The real run's markers; no option moves them. */
const MARKER_DIR = join(homedir(), '.local/share/trade-hub/harmonic-check')
const MARKER = join(MARKER_DIR, 'REPL-RAN.json')
const MARKER_2 = join(MARKER_DIR, 'REPL-RAN-2.json')
const DONE = join(MARKER_DIR, 'REPL-DONE.json')
const RESULT_FILES = ['repl.json', 'repl.md', 'repl-trades.csv.gz']
/** A first candle stamped at or after this leaves a pair out (Amendment 5, step 2). */
const LATE_FIRST = '2009-07-01T00:00:00.000Z'

const POOLED_TWINS =
  'mulberry32 seeded with 1 to N; one draw u per UTC fill date of all the pairs together, dates in ascending order; move = [-5,-4,-3,-2,-1,1,2,3,4,5][floor(10 u)] days for every trade filled on that date; the moved minute looked for in the pair of the trade, one more day the same way up to 4 times, else the trade is left out of that twin'
const PLAN_TWINS =
  "The plan's own way: leadTwins on each pair alone (one draw per UTC fill date of that pair, the generator started again for each pair), summed seed by seed"

const iso = (t: number) => new Date(t * 1000).toISOString()
const day = (t: number) => iso(t).slice(0, 10)
const spanText = ([a, b]: Span) => `${day(a)} to ${day(b - 86_400)}`
const fx = (x: number, d = 3) => (Number.isNaN(x) ? '-' : (x > 0 ? '+' : '') + x.toFixed(d))
const fn = (x: number, d = 2) => (Number.isNaN(x) ? '-' : x.toFixed(d))
const pc = (x: number) => (Number.isNaN(x) ? '-' : `${(100 * x).toFixed(1)}%`)
const yn = (b: boolean) => (b ? 'holds' : 'no')
const mb = () =>
  `${Math.round(process.memoryUsage().rss / 2 ** 20)} MB now, peak ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`
const since = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(0)} s`

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
  console.error(`harmonic-repl: ${msg}`)
  process.exit(1)
}
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fileOf = (data: string, m: HarmonicMarket) => join(data, `${m}_1m.csv.gz`)

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const c of createReadStream(file)) h.update(c as Buffer)
  return h.digest('hex')
}

/** A process with this id that is a harmonic-repl run. */
function alive(pid: unknown): boolean {
  if (typeof pid !== 'number') return false
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).includes('harmonic-repl')
  } catch {
    return false
  }
}

function table(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

// ---------------------------------------------------------------- one pair

interface FileInfo {
  market: HarmonicMarket
  path: string
  bars: number
  first: string
  last: string
  sha256?: string
}

interface PairRun extends FileInfo {
  /** The lead trades (order at D, filled, fill in the span) with their contexts. */
  sel: TwinTrade[]
  closes: Map<number, number>
}

/** One pair: both charts, both swing sizes; keeps only the lead trades in the span. */
async function runPair(
  file: string,
  market: HarmonicMarket,
  refuseFrom: number | null,
  span: Span,
): Promise<PairRun> {
  const read = await readMarket(file, refuseFrom, null)
  if ('refusedAt' in read)
    fail(`${file} holds a bar stamped ${iso(read.refusedAt)}, at or after ${iso(refuseFrom!)}`)
  const { bars } = read
  const four = fourHourCandles(bars)
  const sel: TwinTrade[] = []
  for (const chart of CHARTS) {
    const ctx = harmonicContext(bars, market, chart, four)
    for (const k of SWING_SIZES)
      sel.push(
        ...selectLead(
          runHarmonic(ctx, k).trades.map((t) => ({ market, t, ctx })),
          market,
          span,
        ),
      )
  }
  return {
    market,
    path: resolve(file),
    bars: bars.n,
    first: bars.n ? iso(bars.time[0]) : '-',
    last: bars.n ? iso(bars.time[bars.n - 1]) : '-',
    sel,
    closes: dailyCloses(bars, span),
  }
}

const leadOf = (r: { market: HarmonicMarket; sel: TwinTrade[] }): LeadTrade[] =>
  r.sel.map((x) => leadTrade(r.market, x.t))

// ---------------------------------------------------------------- reproduce

async function runReproduce(dev: string, full: string) {
  const devFile = fileOf(dev, 'GBPJPY')
  for (const f of [devFile, full]) if (!existsSync(f)) fail(`no ${f}`)
  const rows: { what: string; want: number; got: number; d: number }[] = []
  const one = (span: Span, years: number[]): ReplSettings => ({
    ...REPL_SETTINGS,
    pairs: ['GBPJPY'],
    minPairs: 1,
    span,
    periods: [span, span],
    years,
  })

  // (a) Amendment 4's table: the development copy, fills 2010 to 2018.
  let t0 = Date.now()
  const A = one(REPL_REHEARSAL.span, REPL_REHEARSAL.years)
  let r: PairRun | null = await runPair(devFile, 'GBPJPY', yearStart(2019), A.span)
  console.log(`GBPJPY development copy: ${r.bars} bars, ${since(t0)}, ${mb()}`)
  let lead = leadOf(r)
  let f = pooledFigures(lead, A)
  let g = leadFigures('GBPJPY', lead, A.years)
  rows.push(
    { what: 'a. trades, 2010 to 2018', want: 628, got: f.trades, d: 0 },
    { what: 'a. average after costs (R)', want: 0.323, got: f.at120.mean, d: 3 },
    { what: 'a. weekly t', want: 1.46, got: f.at120.t, d: 2 },
    { what: 'a. trades, each-pair path', want: 628, got: g.trades, d: 0 },
    { what: 'a. average after costs, each-pair path', want: 0.323, got: g.at120.mean, d: 3 },
    { what: 'a. weekly t, each-pair path', want: 1.46, got: g.at120.t, d: 2 },
  )
  r = null

  // (b) Amendment 4's check: the full file, fills 2019 to 2025, 200 twins.
  t0 = Date.now()
  const B = one(
    [yearStart(2019), yearStart(2026)],
    REPL_SETTINGS.years.filter((y) => y >= 2019),
  )
  r = await runPair(full, 'GBPJPY', null, B.span)
  console.log(`GBPJPY full file: ${r.bars} bars, ${r.first} to ${r.last}, ${since(t0)}, ${mb()}`)
  lead = leadOf(r)
  f = pooledFigures(lead, B)
  g = leadFigures('GBPJPY', lead, B.years)
  t0 = Date.now()
  const own = leadTwins(r.sel, 200)
  console.log(`GBPJPY twins (leadTwins): ${since(t0)}, ${mb()}`)
  t0 = Date.now()
  const pooled = pooledTwins(r.sel, 200)
  console.log(`GBPJPY twins (pooled code on one pair): ${since(t0)}, ${mb()}`)
  const d = pairDescription(g, own)
  rows.push(
    { what: 'b. trades, 2019 to 2025', want: 422, got: f.trades, d: 0 },
    { what: 'b. average after costs (R)', want: 0.244, got: f.at120.mean, d: 3 },
    { what: 'b. weekly t', want: 1.07, got: f.at120.t, d: 2 },
    { what: 'b. ahead of its 200 twins (leadTwins)', want: 196, got: d.aheadAfter, d: 0 },
    {
      what: 'b. ahead of 200 twins (pooled code, one pair)',
      want: 196,
      got: aheadOf(f.at120.mean, twinMeans(pooled, 'after')),
      d: 0,
    },
  )
  const same = pooled.every(
    (p, i) =>
      p.n === own[i].n && p.sumAfter === own[i].sumAfter && p.sumBefore === own[i].sumBefore,
  )
  let bad = 0
  console.log('')
  for (const x of rows) {
    const got = +x.got.toFixed(x.d)
    const ok = got === x.want
    if (!ok) bad++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${x.what}: expected ${x.want.toFixed(x.d)}, got ${got.toFixed(x.d)}`,
    )
  }
  if (!same) bad++
  console.log(
    `${same ? 'PASS' : 'FAIL'}  b. pooled twins on one pair equal leadTwins seed by seed (n and both sums)`,
  )
  console.log(`\n${bad ? `${bad} FAIL` : 'all PASS'}; ${mb()}`)
  if (bad) process.exit(1)
}

// ---------------------------------------------------------------- the run

interface ReplOpts {
  data: string
  /** The GBP/JPY file read only for its daily closes. */
  reference: string
  out: string
  marker: string
  marker2: string
  done: string
  commit: string | null
  afterError: boolean
  /** --after-error: a text file with the error that stopped the first run and the fix. */
  errorNote: string | null
  /** The pairs whose files are looked for in --data (existence only). */
  candidates: HarmonicMarket[]
}

async function runRepl(o: ReplOpts, S: ReplSettings) {
  const label = S.rehearsal ? 'REHEARSAL: ' : ''
  let gitInfo: { head: string; remote: string[] } | null = null
  if (!S.rehearsal) {
    const g = gitTest(o.commit ?? fail('missing --commit'), git)
    if ('refuse' in g) fail(g.refuse)
    gitInfo = g
  }
  // Which files exist; nothing of the pairs is opened.
  const present = o.candidates.filter((m) => existsSync(fileOf(o.data, m)))
  const first = existsSync(o.marker)
    ? (JSON.parse(readFileSync(o.marker, 'utf8')) as { out?: string; pid?: number })
    : null
  const outs = [o.out, ...(first?.out ? [first.out] : [])]
  const note =
    o.afterError && o.errorNote && existsSync(o.errorNote)
      ? readFileSync(o.errorNote, 'utf8').trim()
      : ''
  const gate = replGate({
    afterError: o.afterError,
    pairs: S.pairs,
    minPairs: S.minPairs,
    present,
    reference: existsSync(o.reference),
    marker: first !== null,
    marker2: existsSync(o.marker2),
    done: existsSync(o.done),
    outHasResults: outs.some((d) => RESULT_FILES.some((f) => existsSync(join(d, f)))),
    firstAlive: o.afterError && alive(first?.pid),
    errorNote: note.length > 0,
  })
  if ('refuse' in gate) fail(gate.refuse)
  const errorNote = o.afterError ? note : null
  mkdirSync(o.out, { recursive: true })
  const marker = gate.write === 1 ? o.marker : o.marker2
  mkdirSync(dirname(marker), { recursive: true })
  // The marker is written before any bar of the pairs is read.
  writeFileSync(
    marker,
    JSON.stringify(
      {
        what: 'harmonic lead on yen pairs, Amendment 5',
        label: S.label,
        time: new Date().toISOString(),
        commit: gitInfo?.head ?? null,
        remote: gitInfo?.remote ?? null,
        pid: process.pid,
        afterError: o.afterError,
        errorNote,
        pairs: S.pairs,
        files: S.pairs.map((m) => resolve(fileOf(o.data, m))),
        reference: resolve(o.reference),
        out: resolve(o.out),
      },
      null,
      2,
    ),
    { flag: 'wx' },
  )
  const tAll = Date.now()
  let t0 = tAll
  console.log(`${label}marker written: ${marker}`)

  // The pairs, one at a time; each keeps its lead trades and contexts for the twins.
  let runs: PairRun[] = []
  for (const m of S.pairs) {
    const t0 = Date.now()
    runs.push(await runPair(fileOf(o.data, m), m, S.refuseFrom, S.span))
    console.log(`${label}${m}: ${runs[runs.length - 1].bars} bars, ${since(t0)}, ${mb()}`)
  }
  const files: FileInfo[] = runs.map(({ market, path, bars, first, last }) => ({
    market,
    path,
    bars,
    first,
    last,
  }))
  t0 = Date.now()
  for (const x of files) x.sha256 = await sha256(x.path)
  console.log(`${label}SHA-256 of the pairs' files: ${since(t0)}`)
  const leads = runs.map(leadOf)
  const all = leads.flat()
  const figures = pooledFigures(all, S)

  t0 = Date.now()
  const pooled = pooledTwins(
    runs.flatMap((r) => r.sel),
    S.twins,
  )
  console.log(`${label}pooled twins: ${S.twins} seeds, ${since(t0)}, ${mb()}`)
  t0 = Date.now()
  const perPair = runs.map((r) => leadTwins(r.sel, S.twins))
  const plan = sumTwins(perPair)
  console.log(`${label}each pair's own twins: ${since(t0)}, ${mb()}`)
  const pairs = runs.map((r, i) =>
    pairDescription(leadFigures(r.market, leads[i], S.years), perPair[i]),
  )
  const verdict = replVerdict(figures, pooled, S)
  const planAhead = {
    after: aheadOf(figures.at120.mean, twinMeans(plan, 'after')),
    before: aheadOf(figures.at120.meanBefore, twinMeans(plan, 'before')),
  }
  const closes = runs.map((r) => ({ market: r.market, closes: r.closes }))
  runs = [] // the contexts are no longer needed

  // GBP/JPY's file, read only for its daily closes.
  t0 = Date.now()
  const ref = await readMarket(o.reference, null, null)
  if ('refusedAt' in ref) fail('unreachable')
  const refCloses = dailyCloses(ref.bars, S.span)
  const refInfo = {
    market: REPL_REFERENCE,
    path: resolve(o.reference),
    bars: ref.bars.n,
    first: ref.bars.n ? iso(ref.bars.time[0]) : '-',
    last: ref.bars.n ? iso(ref.bars.time[ref.bars.n - 1]) : '-',
    sha256: await sha256(o.reference),
    dates: refCloses.size,
  }
  console.log(`${label}${REPL_REFERENCE} daily closes: ${ref.bars.n} bars, ${since(t0)}, ${mb()}`)
  const correlations = closes.map((c) => ({
    market: c.market,
    with: REPL_REFERENCE,
    ...dailyCorrelation(c.closes, refCloses),
  }))

  // Every output is made, then written, at the very end.
  const seedRows = (tw: TwinSum[]) =>
    tw.map((s, i) => ({
      seed: i + 1,
      ...s,
      meanAfter: s.n ? s.sumAfter / s.n : null,
      meanBefore: s.n ? s.sumBefore / s.n : null,
    }))
  const result = {
    label: S.label,
    note: S.rehearsal
      ? 'REHEARSAL on the development copies; its reading is not a result'
      : 'Amendment 5, the one run',
    generated: new Date().toISOString(),
    commit: gitInfo?.head ?? null,
    remote: gitInfo?.remote ?? null,
    marker,
    afterError: o.afterError,
    errorNote,
    leftOut: o.candidates.filter((m) => !S.pairs.includes(m)),
    settings: {
      ...S,
      spanText: spanText(S.span),
      periodsText: S.periods.map(spanText),
      costs: S.pairs.map((m) => ({
        market: m,
        pip: MARKET_COSTS[m].pip,
        spread: MARKET_COSTS[m].spreadAt(1),
        slip: MARKET_COSTS[m].slip,
      })),
      pooledTwins: POOLED_TWINS,
      planTwins: PLAN_TWINS,
    },
    files,
    reference: refInfo,
    reading: verdict.reading,
    lines: verdict.lines,
    pass: verdict.pass,
    aheadAfter: verdict.aheadAfter,
    aheadBefore: verdict.aheadBefore,
    clears2and4Before: verdict.clears2and4Before,
    pooled: figures,
    pooledTwins: seedRows(pooled),
    planTwins: {
      aheadAfter: planAhead.after,
      aheadBefore: planAhead.before,
      seeds: seedRows(plan),
    },
    pairs: pairs.map((p, i) => ({ ...p, twins: seedRows(perPair[i]) })),
    correlations,
  }
  const json = JSON.stringify(result, null, 2)
  const md = reportMd(
    label,
    S,
    result.commit,
    marker,
    figures,
    verdict,
    pooled,
    planAhead,
    pairs,
    correlations,
    files,
    refInfo,
    result.leftOut,
    errorNote,
  )
  const csv = tradesCsv(label, all)

  // From here a figure is written: no second run after this point.
  writeFileSync(
    o.done,
    JSON.stringify({ time: new Date().toISOString(), marker, out: resolve(o.out) }, null, 2),
    { flag: 'wx' },
  )
  writeFileSync(join(o.out, 'repl.json'), json)
  writeFileSync(join(o.out, 'repl.md'), md)
  writeFileSync(join(o.out, 'repl-trades.csv.gz'), csv)
  console.log(`${label}done in ${since(tAll)}, ${mb()}`)
  console.log(`${label}reading: "${verdict.reading}"; outputs in ${resolve(o.out)}`)
}

function tradesCsv(label: string, trades: LeadTrade[]): Buffer {
  const head = ['pair', 'fill_time', 'fill_utc', 'dir', 'how_120']
  for (const h of LEAD_HOLDS) head.push(`after_${h}`, `before_${h}`, `double_${h}`)
  const lines = label ? [`# ${label}not a result`] : []
  lines.push(head.join(','))
  for (const x of trades) {
    const row: (string | number)[] = [
      x.market,
      x.fillTime,
      iso(x.fillTime),
      x.dir,
      x.worth[holdIndex(120)].how,
    ]
    for (const h of LEAD_HOLDS) {
      const w = x.worth[holdIndex(h)]
      row.push(w.after, w.before, w.double)
    }
    lines.push(row.join(','))
  }
  return gzipSync(lines.join('\n') + '\n')
}

function reportMd(
  label: string,
  S: ReplSettings,
  commit: string | null,
  marker: string,
  f: PooledFigures,
  v: ReplVerdict,
  pooled: TwinSum[],
  planAhead: { after: number; before: number },
  pairs: PairDescription[],
  correlations: {
    market: HarmonicMarket
    with: string
    dates: number
    changes: number
    r: number
  }[],
  files: FileInfo[],
  ref: FileInfo & { dates: number },
  leftOut: HarmonicMarket[],
  errorNote: string | null,
): string {
  const tm = twinMeans(pooled, 'after').filter((x) => !Number.isNaN(x))
  const s = f.at120
  return [
    `# ${label}Harmonic lead on yen pairs (Amendment 5)`,
    '',
    ...(S.rehearsal
      ? [
          'REHEARSAL: GBP/JPY and EUR/JPY development copies stand in as the pairs. Its reading is not a result.',
          '',
        ]
      : []),
    `**${label}Reading, the pairs together: "${v.reading}"**`,
    '',
    READING_NOTES[v.reading],
    '',
    ...(errorNote === null
      ? []
      : [
          '## The second run, after an error',
          '',
          'The error that stopped the first run, and the fix, as written before this run:',
          '',
          ...errorNote.split('\n').map((l) => `> ${l}`),
          '',
        ]),
    `${label}Pairs ${f.pairs.join(', ')}; left out: ${leftOut.length ? leftOut.join(', ') : 'none'}. Trades filled ${spanText(S.span)} (UTC), at 120 hours, after costs unless said. Commit ${commit ?? 'none (rehearsal)'}. Marker ${marker}.`,
    '',
    '## The seven lines',
    '',
    table(
      ['Line (after costs, at 120 hours)', 'Value', 'Holds'],
      v.lines.map((l) => [
        `${l.line}. ${l.rule}`,
        l.line === 2 ? fn(l.value) : l.line === 5 ? `${fx(l.value, 1)} R` : String(l.value),
        yn(l.ok),
      ]),
    ),
    '',
    `- Ahead of ${v.aheadAfter} of the ${S.twins} pooled twins after costs, ${v.aheadBefore} before costs. Before costs the pairs together clear lines 2 and 4: ${v.clears2and4Before ? 'yes' : 'no'}.`,
    `- The median pooled twin made ${fx(median(tm))} R a trade; the best ${fx(tm.length ? Math.max(...tm) : NaN)} R.`,
    `- The plan's own twins (each pair alone, summed), as description: ahead of ${planAhead.after} after costs, ${planAhead.before} before costs.`,
    '',
    '## The pairs together',
    '',
    table(
      ['A trade was worth', ...f.holds.map((h) => `${h.hours} hours`)],
      [
        ['after costs', ...f.holds.map((h) => `${fx(h.meanAfter)} R`)],
        ['before costs', ...f.holds.map((h) => `${fx(h.meanBefore)} R`)],
        ['at double cost', ...f.holds.map((h) => `${fx(h.meanDouble)} R`)],
      ],
    ),
    '',
    `- ${s.n} trades, ${fx(s.sum, 1)} R in all after costs (${fx(s.sumBefore, 1)} R before, ${fx(s.sumDouble, 1)} R at double cost). Weekly t ${fn(s.t)} after costs, ${fn(s.tBefore)} before, over ${s.weeks} weeks.`,
    `- Buys ${f.buys.n} trades, ${fx(f.buys.mean)} R; sells ${f.sells.n} trades, ${fx(f.sells.mean)} R.`,
    `- ${pc(f.stopShare)} ended at their stop; the median trade ${fx(f.medianAfter)} R; the best ${fx(f.best, 1)} R. The ten best made ${fx(f.tenBest.sum, 1)} R of the ${fx(f.tenBest.total, 1)} R total.`,
    '',
    table(
      ['Period', 'Trades', 'Sum after costs', 'Above zero'],
      f.byPeriod.map((p) => [spanText(p.span), p.n, `${fx(p.sum, 1)} R`, p.above ? 'yes' : 'no']),
    ),
    '',
    table(
      ['Pair', 'Trades', 'Sum after costs', 'Above zero'],
      f.byPair.map((p) => [p.market, p.n, `${fx(p.sum, 1)} R`, p.above ? 'yes' : 'no']),
    ),
    '',
    table(
      ['Year', 'Trades', 'Sum after costs', 'Above zero'],
      f.byYear.map((y) => [y.year, y.n, `${fx(y.sum, 1)} R`, y.above ? 'yes' : 'no']),
    ),
    '',
    '## Each pair alone (description)',
    '',
    `Each pair with Amendment 4's figures and its own ${S.twins} twins made as in Amendment 4.`,
    '',
    table(
      [
        'Pair',
        'Trades',
        ...LEAD_HOLDS.map((h) => `${h} hours`),
        'Weekly t',
        'Years above zero',
        'Ahead of twins (after, before)',
        'Double cost sum',
        'Buys n, mean',
        'Sells n, mean',
        'Ended at stop',
        'Ten best: sum of total',
      ],
      pairs.map((p) => {
        const g = p.figures
        return [
          g.market,
          g.trades,
          ...g.holds.map((h) => `${fx(h.meanAfter)} R`),
          fn(g.at120.t),
          `${p.yearsAbove} of ${S.years.length}`,
          `${p.aheadAfter}, ${p.aheadBefore}`,
          `${fx(p.sumDouble, 1)} R`,
          `${g.buys.n}, ${fx(g.buys.mean)} R`,
          `${g.sells.n}, ${fx(g.sells.mean)} R`,
          pc(g.stopShare),
          `${fx(g.tenBest.sum, 1)} of ${fx(g.tenBest.total, 1)} R`,
        ]
      }),
    ),
    '',
    'Sum after costs by year (trades):',
    '',
    table(
      ['Pair', ...S.years.map(String)],
      pairs.map((p) => [
        p.figures.market,
        ...p.figures.byYear.map((y) => `${fx(y.sum, 1)} (${y.n})`),
      ]),
    ),
    '',
    `## Daily changes against ${REPL_REFERENCE}`,
    '',
    `Change in percent of the last Bid close of each UTC date from the previous date present in both files, ${spanText(S.span)}.`,
    '',
    table(
      ['Pair', 'Dates in both', 'Correlation'],
      correlations.map((c) => [c.market, c.dates, fn(c.r, 3)]),
    ),
    '',
    '## Files and settings',
    '',
    table(
      ['File', 'Read for', 'Bars', 'First', 'Last', 'SHA-256'],
      [
        ...files.map((x) => [
          x.path,
          `${x.market}, the lead`,
          x.bars,
          x.first >= LATE_FIRST ? `${x.first} (at or after 2009-07-01)` : x.first,
          x.last,
          x.sha256 ?? '-',
        ]),
        [
          ref.path,
          `${ref.market}, daily closes only`,
          ref.bars,
          ref.first,
          ref.last,
          ref.sha256 ?? '-',
        ],
      ],
    ),
    '',
    `- Spreads: ${S.pairs.map((m) => `${m} ${MARKET_COSTS[m].spreadAt(1)}`).join(', ')} (price); 0.2 pip on every market fill; double cost doubles both.`,
    `- Pooled twins: ${POOLED_TWINS}.`,
    `- ${PLAN_TWINS}.`,
    '- Play money only. No broker is connected.',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2]
  const afterError = process.argv.includes('--after-error')
  const errorNote = arg('error-note') ?? null
  if (cmd === 'reproduce') {
    await runReproduce(need('dev'), need('full-gbpjpy'))
  } else if (cmd === 'rehearse') {
    const out = need('out')
    const data = need('data')
    await runRepl(
      {
        data,
        reference: fileOf(data, REPL_REFERENCE),
        out,
        marker: join(out, 'REPL-RAN.json'),
        marker2: join(out, 'REPL-RAN-2.json'),
        done: join(out, 'REPL-DONE.json'),
        commit: null,
        afterError,
        errorNote,
        candidates: REPL_REHEARSAL.pairs,
      },
      REPL_REHEARSAL,
    )
  } else if (cmd === 'run') {
    await runRepl(
      {
        data: need('data'),
        reference: need('gbpjpy'),
        out: need('out'),
        marker: MARKER,
        marker2: MARKER_2,
        done: DONE,
        commit: need('commit'),
        afterError,
        errorNote,
        candidates: REPL_CANDIDATES,
      },
      REPL_SETTINGS,
    )
  } else {
    console.error(
      'usage: harmonic-repl.ts reproduce --dev <dir> --full-gbpjpy <file>\n' +
        '       harmonic-repl.ts rehearse --data <dev dir> --out <dir> [--after-error --error-note <file>]\n' +
        '       harmonic-repl.ts run --data <dir> --gbpjpy <file> --out <dir> --commit <sha> [--after-error --error-note <file>]',
    )
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
