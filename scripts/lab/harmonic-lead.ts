/**
 * Harmonic study, Amendment 4 (docs/harmonic-study.md): the lead from the
 * tables and its one check. Offline, play money only: reads local 1-minute
 * files, nothing else.
 *
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-lead.ts choose --data <dir> --out <dir>
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-lead.ts check --data <dir> --choose <dir>/lead-choose.json --out <dir> --commit <sha>
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-lead.ts rehearse --data <dir> --out <dir>
 *
 * choose: GBP/JPY and EUR/JPY on 2010 to 2018 (refuses a file with any bar
 * from 2019 on) and the test that Amendment 4's table is reproduced. check:
 * trades filled 2019 to 2025, the five lines, 200 twins and the reading;
 * refuses unless lead-choose.json reproduced the table, the tree is clean,
 * HEAD is <sha> and on a remote branch, lead-choose.json was made by HEAD,
 * both market files exist and the fixed marker does not; writes the marker
 * before any bar is read. rehearse: both inside the development years
 * (choose 2010 to 2014, check 2015 to 2018, 20 twins), the same functions.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  fourHourCandles,
  harmonicContext,
  runHarmonic,
  type HarmonicContext,
  type HarmonicMarket,
  type Trade,
} from '../../src/lib/lab/harmonic'
import { gitTest, openCheck } from '../../src/lib/lab/harmonicCheckGate'
import {
  LEAD_MARKET,
  LEAD_MARKETS,
  leadFigures,
  leadTrade,
  leadTwins,
  leadVerdict,
  selectLead,
  spanYears,
  type LeadFigures,
  type LeadVerdict,
  type TwinSum,
} from '../../src/lib/lab/harmonicLead'
import { readMarket } from '../../src/lib/lab/harmonicLoad'
import {
  CHARTS,
  REAL_PERIODS,
  REHEARSAL_PERIODS,
  SWING_SIZES,
  TWIN_GENERATOR,
  type StudyPeriods,
} from '../../src/lib/lab/harmonicStudy'

const REPO = resolve(__dirname, '../..')
/** The real check's one marker; no option moves it. */
const LEAD_MARKER = join(homedir(), '.local/share/trade-hub/harmonic-check/LEAD-RAN.json')

/** Amendment 4's table, 2010 to 2018, at 120 hours: trades, average after costs, weekly t. */
const AMENDMENT_4: Record<string, { trades: number; mean: number; t: number }> = {
  GBPJPY: { trades: 628, mean: 0.323, t: 1.46 },
  EURJPY: { trades: 668, mean: 0.086, t: 0.42 },
}

const iso = (t: number) => new Date(t * 1000).toISOString()
const day = (t: number) => iso(t).slice(0, 10)
const spanText = ([a, b]: [number, number]) => `${day(a)} to ${day(b - 86_400)}`
const fx = (x: number, d = 3) => (Number.isNaN(x) ? '-' : (x > 0 ? '+' : '') + x.toFixed(d))
const fn = (x: number, d = 2) => (Number.isNaN(x) ? '-' : x.toFixed(d))
const pc = (x: number) => (Number.isNaN(x) ? '-' : `${(100 * x).toFixed(1)}%`)

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
  console.error(`harmonic-lead: ${msg}`)
  process.exit(1)
}
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fileOf = (data: string, m: HarmonicMarket) => join(data, `${m}_1m.csv.gz`)

function table(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

interface Run {
  market: HarmonicMarket
  bars: number
  first: string
  last: string
  trades: { market: HarmonicMarket; t: Trade; ctx: HarmonicContext }[]
}

/** One market: both charts, both swing sizes, every trade with its context. */
async function runMarket(
  file: string,
  market: HarmonicMarket,
  refuseFrom: number | null,
  readBefore: number | null,
): Promise<Run> {
  const read = await readMarket(file, refuseFrom, readBefore)
  if ('refusedAt' in read)
    fail(`${file} holds a bar stamped ${iso(read.refusedAt)}, at or after ${iso(refuseFrom!)}`)
  const { bars } = read
  if (refuseFrom !== null && bars.n && bars.time[bars.n - 1] >= refuseFrom)
    fail(`${market}: a bar at ${iso(bars.time[bars.n - 1])}`)
  const four = fourHourCandles(bars)
  const trades: Run['trades'] = []
  for (const chart of CHARTS) {
    const ctx = harmonicContext(bars, market, chart, four)
    for (const k of SWING_SIZES)
      for (const t of runHarmonic(ctx, k).trades) trades.push({ market, t, ctx })
  }
  return {
    market,
    bars: bars.n,
    first: bars.n ? iso(bars.time[0]) : '-',
    last: bars.n ? iso(bars.time[bars.n - 1]) : '-',
    trades,
  }
}

function figuresMd(fs: LeadFigures[]): string {
  const holds = fs[0].holds.map((h) => `${h.hours} hours`)
  return [
    table(
      ['Market', 'Trades', ...holds, 'Weekly t at 120 hours'],
      fs.map((f) => [
        f.market,
        f.trades,
        ...f.holds.map((h) => `${fx(h.meanAfter)} R`),
        fn(f.at120.t),
      ]),
    ),
    '',
    'At 120 hours, after costs:',
    '',
    table(
      [
        'Market',
        'Sum',
        'Before costs (mean)',
        'Double cost (mean)',
        'Buys n, mean',
        'Sells n, mean',
        'Ended at stop',
        'Median',
        'Best',
        'Ten best: sum of total',
      ],
      fs.map((f) => [
        f.market,
        `${fx(f.at120.sum, 1)} R`,
        `${fx(f.at120.meanBefore)} R`,
        `${fx(f.at120.meanDouble)} R`,
        `${f.buys.n}, ${fx(f.buys.mean)} R`,
        `${f.sells.n}, ${fx(f.sells.mean)} R`,
        pc(f.stopShare),
        `${fx(f.medianAfter)} R`,
        `${fx(f.best, 1)} R`,
        `${fx(f.tenBest.sum, 1)} of ${fx(f.tenBest.total, 1)} R (${pc(f.tenBest.share)})`,
      ]),
    ),
    '',
    'Sum after costs by year, at 120 hours:',
    '',
    table(
      ['Market', ...fs[0].byYear.map((y) => String(y.year))],
      fs.map((f) => [f.market, ...f.byYear.map((y) => `${fx(y.sum, 1)} (${y.n})`)]),
    ),
  ].join('\n')
}

// ---------------------------------------------------------------- choose

async function runChoose(data: string, out: string, P: StudyPeriods): Promise<string> {
  const label = P.rehearsal ? 'REHEARSAL: ' : ''
  for (const m of LEAD_MARKETS) if (!existsSync(fileOf(data, m))) fail(`no ${fileOf(data, m)}`)
  const figures: LeadFigures[] = []
  const files: Omit<Run, 'trades'>[] = []
  for (const m of LEAD_MARKETS) {
    const run = await runMarket(fileOf(data, m), m, P.refuseFrom, P.readBefore)
    const mine = selectLead(run.trades, m, P.choose).map((x) => leadTrade(m, x.t))
    figures.push(leadFigures(m, mine, spanYears(P.choose)))
    files.push({ market: m, bars: run.bars, first: run.first, last: run.last })
  }
  // Amendment 4's table must come out again (real choosing run only).
  const repro = P.rehearsal
    ? null
    : figures.map((f) => {
        const want = AMENDMENT_4[f.market]
        const got = { trades: f.trades, mean: +f.at120.mean.toFixed(3), t: +f.at120.t.toFixed(2) }
        const ok = got.trades === want.trades && got.mean === want.mean && got.t === want.t
        return { market: f.market, want, got, ok }
      })
  const reproduces = repro ? repro.every((r) => r.ok) : null
  const clean = git('status', '--porcelain') === ''
  const head = git('rev-parse', 'HEAD')
  const choose = {
    rehearsal: P.rehearsal,
    label: P.label,
    generated: new Date().toISOString(),
    commit: clean ? head : null,
    head,
    clean,
    data: resolve(data),
    span: spanText(P.choose),
    marketsUsed: LEAD_MARKETS,
    lead: {
      market: LEAD_MARKET,
      rule: 'order at D (E0); all four patterns, both charts, both swing sizes; the pattern stop; closed at market at the first minute at or after 120 hours from the fill (the engine look-back worth)',
    },
    files,
    reproduces,
    reproduction: repro,
    figures,
  }
  mkdirSync(out, { recursive: true })
  const path = join(out, 'lead-choose.json')
  writeFileSync(path, JSON.stringify(choose, null, 2))
  const md = [
    `# ${label}Harmonic lead (Amendment 4): the choosing years`,
    '',
    `${label}Span ${choose.span}, trades by fill minute; average after costs. Commit: ${choose.commit ?? `none (tree not clean; HEAD ${head})`}.`,
    '',
    figuresMd(figures),
    '',
    repro
      ? `Amendment 4's table reproduced: ${reproduces ? 'yes' : 'NO'} (${repro.map((r) => `${r.market} ${r.got.trades} trades, ${fx(r.got.mean)} R, t ${fn(r.got.t)}`).join('; ')}).`
      : 'REHEARSAL: no reproduction test.',
    '',
  ].join('\n')
  writeFileSync(join(out, 'lead-choose.md'), md)
  console.log(`${label}choose ${choose.span}`)
  console.log(figuresMd(figures))
  if (repro) {
    console.log(`reproduces Amendment 4: ${reproduces ? 'yes' : 'NO'}`)
    if (!reproduces) process.exit(1)
  }
  return path
}

// ---------------------------------------------------------------- check

interface CheckOpts {
  data: string
  choosePath: string
  out: string
  marker: string
  commit: string | null
}

async function runCheck(o: CheckOpts, P: StudyPeriods) {
  const label = P.rehearsal ? 'REHEARSAL: ' : ''
  if (!existsSync(o.choosePath)) fail(`no ${o.choosePath}`)
  const choose = JSON.parse(readFileSync(o.choosePath, 'utf8'))
  if (choose.rehearsal !== P.rehearsal)
    fail(`${o.choosePath} is ${choose.rehearsal ? 'a rehearsal' : 'a real choosing run'}`)
  if (!P.rehearsal && choose.reproduces !== true)
    fail(`${o.choosePath} did not reproduce Amendment 4's table`)
  let gitInfo: { head: string; remote: string[] } | null = null
  if (!P.rehearsal) {
    const g = gitTest(o.commit ?? fail('missing --commit'), git)
    if ('refuse' in g) fail(g.refuse)
    gitInfo = g
  }
  // Which files exist (nothing is read): a wrong --data must not use up the check.
  const used = LEAD_MARKETS.filter((m) => existsSync(fileOf(o.data, m)))
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
      what: 'harmonic lead, Amendment 4',
      time: new Date().toISOString(),
      commit: gitInfo?.head ?? null,
      remote: gitInfo?.remote ?? null,
      choose: resolve(o.choosePath),
      data: resolve(o.data),
      marketsUsed: used,
    },
  })
  if (refusal) fail(refusal)
  mkdirSync(o.out, { recursive: true })

  const results: {
    market: HarmonicMarket
    role: string
    figures: LeadFigures
    twins: TwinSum[]
    verdict: LeadVerdict
  }[] = []
  const files: Omit<Run, 'trades'>[] = []
  for (const m of LEAD_MARKETS) {
    const run = await runMarket(fileOf(o.data, m), m, P.rehearsal ? P.refuseFrom : null, null)
    const sel = selectLead(run.trades, m, P.check)
    const figures = leadFigures(
      m,
      sel.map((x) => leadTrade(m, x.t)),
      P.checkYears,
    )
    const twins = leadTwins(sel, P.twins)
    results.push({
      market: m,
      role: m === LEAD_MARKET ? 'the lead' : 'description only',
      figures,
      twins,
      verdict: leadVerdict(figures, twins, P),
    })
    files.push({ market: m, bars: run.bars, first: run.first, last: run.last })
  }
  const lead = results.find((r) => r.market === LEAD_MARKET)!
  const check = {
    rehearsal: P.rehearsal,
    label: P.label,
    generated: new Date().toISOString(),
    commit: gitInfo?.head ?? null,
    remote: gitInfo?.remote ?? null,
    marker: o.marker,
    data: resolve(o.data),
    choose: resolve(o.choosePath),
    chooseCommit: choose.commit,
    span: spanText(P.check),
    twins: { generator: TWIN_GENERATOR, seeds: `1 to ${P.twins}` },
    files,
    reading: lead.verdict.reading,
    results: results.map((r) => ({
      market: r.market,
      role: r.role,
      figures: r.figures,
      lines: r.verdict.lines,
      pass: r.verdict.pass,
      aheadAfter: r.verdict.aheadAfter,
      aheadBefore: r.verdict.aheadBefore,
      clears2and4Before: r.verdict.clears2and4Before,
      reading: r.role === 'the lead' ? r.verdict.reading : null,
      twins: r.twins.map((s, i) => ({
        seed: i + 1,
        ...s,
        meanAfter: s.n ? s.sumAfter / s.n : NaN,
        meanBefore: s.n ? s.sumBefore / s.n : NaN,
      })),
    })),
  }
  writeFileSync(join(o.out, 'lead-check.json'), JSON.stringify(check, null, 2))
  const linesMd = table(
    ['Line (after costs)', ...results.map((r) => `${r.market} (${r.role})`)],
    lead.verdict.lines.map((l, i) => [
      `${l.line}. ${l.rule}`,
      ...results.map(
        (r) =>
          `${l.line === 5 ? `${fx(r.verdict.lines[i].value, 1)} R` : fn(r.verdict.lines[i].value, l.line === 2 ? 2 : 0)}, ${r.verdict.lines[i].ok ? 'holds' : 'no'}`,
      ),
    ]),
  )
  const md = [
    `# ${label}Harmonic lead (Amendment 4): the check`,
    '',
    `${label}Span ${check.span}, trades by fill minute; swings and indicators over each whole file. Commit ${check.commit ?? 'none (rehearsal)'}. Marker ${o.marker}. Twins: ${check.twins.seeds}; ${TWIN_GENERATOR}.`,
    '',
    figuresMd(results.map((r) => r.figures)),
    '',
    linesMd,
    '',
    ...results.map(
      (r) =>
        `${r.market}: ahead of ${r.verdict.aheadAfter} of ${P.twins} twins after costs, ${r.verdict.aheadBefore} before costs; before costs clears lines 2 and 4: ${r.verdict.clears2and4Before ? 'yes' : 'no'}.`,
    ),
    '',
    `**${label}Reading (GBP/JPY): "${lead.verdict.reading}"**`,
    '',
  ].join('\n')
  writeFileSync(join(o.out, 'lead-check.md'), md)
  console.log(md)
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
        marker: LEAD_MARKER,
        commit: need('commit'),
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
        marker: join(out, 'LEAD-RAN.json'),
        commit: null,
      },
      REHEARSAL_PERIODS,
    )
  } else {
    console.error(
      'usage: harmonic-lead.ts choose --data <dir> --out <dir>\n' +
        '       harmonic-lead.ts check --data <dir> --choose <dir>/lead-choose.json --out <dir> --commit <sha>\n' +
        '       harmonic-lead.ts rehearse --data <dir> --out <dir>',
    )
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
