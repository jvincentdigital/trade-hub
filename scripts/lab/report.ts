/**
 * Strategy lab report: REPORT.md and REPORT.html from results.json.
 *
 *   npx tsx scripts/lab/report.ts [--dir DIR]     (make lab runs it after the lab)
 *
 * DIR defaults to ~/jvd-outputs/<today>/strategy-lab. A hand-written notes.md
 * in DIR (plain paragraphs, "- " bullets, **bold**) goes in as "What it means".
 * The HTML is one calm phone-first page: dark, one accent, no sideways scroll.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BotDetail, BotResult } from '../../src/lib/lab/bots'
import { labMarket, type LabMarketId } from '../../src/lib/lab/markets'

type Detailed = BotResult & { detail: BotDetail }
interface FamRow {
  variant: string
  name: string
  family: string
  bots: number
  eligible: number
  positiveOos: number
  positiveBoth: number
  medianOosPerMonth: number | null
  best: { id: string; oosPerMonth: number; oosNet: number } | null
}
interface GroupRow {
  key: string
  bots: number
  eligible: number
  positiveOos: number
  medianOosPerMonth: number | null
  medianOosWinRate: number | null
  medianOosAvgR: number | null
  oosTrades: number
}
interface NewsRow {
  words: string
  pairs: number
  better: number
  worse: number
  same: number
  medianDiff: number | null
  meanDiff: number | null
  medianTradesCut: number | null
  byFamily: Record<string, { pairs: number; better: number; medianDiff: number | null }>
  biggest: {
    family: string
    diff: number
    off: number
    on: number
    tradesOff: number
    tradesOn: number
  }[]
}
interface Results {
  generatedAt: string
  runSeconds: number
  workers: number
  settings: {
    startMoney: number
    sizing: { riskPct: number; maxOpen: number; maxOpenRiskPct: number }
    inSampleShare: number
    minOosTrades: number
    newsPadMinutes: number
    costs: {
      id: string
      label: string
      spread: number
      slippage: number
      unit: string
      feePerSide: number
      leverage: number
      timeframes: string[]
    }[]
    params: Record<string, string>
  }
  counts: {
    bots: number
    controls: number
    eligible: number
    positiveOos: number
    positiveBoth: number
    medianOosPerMonth: number | null
  }
  luck: {
    line: number
    best: { id: string; oosPerMonth: number; oosNet: number; oosTrades: number; isNet: number }[]
    eligible: number
    positiveOos: number
    realAboveLine: number
    rankOfBestCoin: number
  }
  shortlist: string[]
  shortlistDetails: Detailed[]
  top10: Detailed[]
  bestFib: Detailed | null
  ensembles: Detailed[]
  newsEffect: Record<string, NewsRow>
  families: FamRow[]
  fib: {
    byVariant: GroupRow[]
    byTfStyle: GroupRow[]
    byMarket: GroupRow[]
    chosenK: Record<string, number>
    chosenEntry: Record<string, number>
  }
  fibCosts?: {
    id: string
    tf: string
    style: string
    variant: string
    trades: number
    normal: number
    free: number
    double: number
  }[]
  bots: BotResult[]
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const DIR = arg('dir') ?? join(homedir(), 'jvd-outputs', localDate(), 'strategy-lab')

const R: Results = JSON.parse(readFileSync(join(DIR, 'results.json'), 'utf8'))
const NOTES = existsSync(join(DIR, 'notes.md')) ? readFileSync(join(DIR, 'notes.md'), 'utf8') : ''

// ── formatting ───────────────────────────────────────────
let MINUS = '-'
const usd = (x: number) => '$' + Math.round(Math.abs(x)).toLocaleString('en-US')
const money = (x: number) => (x < 0 ? MINUS : '') + usd(x)
const delta = (x: number) => (x < 0 ? MINUS : '+') + usd(x)
const pct = (x: number | null, d = 0) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`)
const num = (x: number | null, d = 1) =>
  x == null ? 'n/a' : (x < 0 ? MINUS : '') + Math.abs(x).toFixed(d)

const TF: Record<string, string> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': 'daily',
}
const STYLE: Record<string, string> = {
  scalp: 'scalp',
  day: 'day trade',
  swing: 'swing',
  race: 'race exits',
}
const NEWS: Record<string, string> = {
  off: 'no news filter',
  block: 'news: no new trades',
  close: 'news: close before',
  day: 'news: skip red days',
}
const mlabel = (id: string) => {
  try {
    return labMarket(id as LabMarketId).label
  } catch {
    return id
  }
}
const marketsShort = (b: BotResult) =>
  b.scope === 'all' ? `all ${b.markets.length} markets` : b.markets.map(mlabel).join(' + ')
const label = (b: BotResult) =>
  b.family === 'ensemble'
    ? b.name
    : `${b.name}, ${TF[b.tf]} ${STYLE[b.style]}, ${marketsShort(b)}, ${NEWS[b.news]}`
const both = (b: BotResult) => b.is.net > 0 && b.oos.net > 0
const bestOf = (m: Record<string, { net: number }>) => {
  const e = Object.entries(m).sort((a, b) => b[1].net - a[1].net)
  return e.length ? e[0][0] : null
}
const byId = new Map(R.bots.map((b) => [b.id, b]))
const fmtDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
const oosMonths = (tf: string) => {
  const b = R.bots.find((x) => x.tf === tf && x.scope === 'GBPUSD')
  return b ? b.oos.months.toFixed(1) : 'a few'
}

// ── content model: blocks rendered to both formats ───────
type Block =
  | { h: 1 | 2 | 3; text: string }
  | { p: string }
  | { ul: string[] }
  | { table: { head: string[]; rows: string[][]; narrow?: boolean } }
  | { cards: { title: string; lines: string[] }[] }
  | { notes: string }

function build(): Block[] {
  const s = R.settings
  const c = R.counts
  const out: Block[] = []
  const firstSpan = R.top10[0]?.span
  out.push({ h: 1, text: 'Strategy lab: which bot makes money?' })
  out.push({
    p: `${c.bots} play-money bots, each with its own ${usd(s.startMoney)} account, ${s.sizing.riskPct}% risk per trade (the race's rules: at most ${s.sizing.maxOpen} trades open, ${s.sizing.maxOpenRiskPct}% open risk, margin limits). Run ${R.generatedAt.slice(0, 16).replace('T', ' ')} UTC on the Mac Mini in ${R.runSeconds} seconds. Nothing here touched a broker, a live account or the live race.`,
  })
  out.push({ h: 2, text: 'The short answer' })
  out.push({
    ul: [
      `**${c.positiveOos} of ${c.eligible}** bots with enough trades made money in the test period they never saw (the last ${Math.round((1 - s.inSampleShare) * 100)}% of the history). Only **${c.positiveBoth}** made money in both halves.`,
      `A **coin flip** bot (random entries, same stops, targets and costs) made ${delta(R.luck.line)} a month at best, enough to rank #${R.luck.rankOfBestCoin}. Only ${R.luck.realAboveLine} real bots did better than that luck line.`,
      R.shortlist.length
        ? `Bots that beat the coin flip AND made money in both halves: ${[
            ...new Set(
              R.shortlist.map((id) => {
                const b = byId.get(id)!
                return `${b.name}, ${TF[b.tf]}, ${marketsShort(b)}`
              }),
            ),
          ].join('; ')} (with or without the news filter where both qualify).`
        : 'No bot beat the coin flip and made money in both halves.',
    ],
  })
  if (NOTES) {
    out.push({ h: 2, text: 'What it means' })
    out.push({ notes: NOTES })
  }

  // How it was tested
  out.push({ h: 2, text: 'How it was tested' })
  out.push({
    ul: [
      `**Walk-forward.** Each bot has a few free settings (${Object.entries(s.params)
        .filter(([k]) => k !== 'ensemble')
        .map(([k, v]) => `${k}: ${v}`)
        .join(
          '; ',
        )}). They were chosen on the first ${Math.round(s.inSampleShare * 100)}% of the history (in-sample) and then scored only on the last ${Math.round((1 - s.inSampleShare) * 100)}% (out-of-sample), in a fresh ${usd(s.startMoney)} account. A big gap between the two halves means the settings were fitted to the past.`,
      `**Ranked** by out-of-sample dollars per month, only bots with at least ${s.minOosTrades} out-of-sample trades.`,
      '**History:** 1-hour, 4-hour and daily candles for 24 months on all 7 markets; 5, 15 and 30-minute candles for 12 months on GBP/USD and gold and 24 months on Bitcoin (the other markets only have days of small candles so far).' +
        (firstSpan
          ? ` A 1-hour bot's test period runs ${fmtDate(R.bots.find((b) => b.tf === '1h' && b.scope === 'all')?.span.split ?? firstSpan.split)} to ${fmtDate(firstSpan.to)}.`
          : ''),
      '**Backtest rules** as in the race: enter at the next candle open, the stop counts first when a candle touches both, gaps fill at the open. Plus the spread (prices in the history are the bid), slippage on every market fill and a commission. Scalps close by the end of their session, day trades by 21:00 UTC, swings within 5 days.',
      `**News filter** (the red events: US jobs, CPI, retail sales, Fed, GDP; Bank of England and UK CPI; ECB; Bank of Japan): no new trades from ${s.newsPadMinutes} minutes before to ${s.newsPadMinutes} after an event in the pair's currencies; tested with open trades kept and with open trades closed before it.`,
    ],
  })
  out.push({
    table: {
      head: ['Market', 'Spread', 'Slippage', 'Commission / side'],
      rows: s.costs.map((m) => [
        m.label,
        m.unit === 'price'
          ? m.id.endsWith('JPY')
            ? `${(m.spread / 0.01).toFixed(1)} pip`
            : m.id === 'XAUUSD'
              ? `$${m.spread.toFixed(2)}`
              : m.id === 'US30'
                ? `${m.spread} pts`
                : `${(m.spread / 0.0001).toFixed(1)} pip`
          : `${(m.spread * 100).toFixed(2)}%`,
        m.unit === 'price'
          ? m.id.endsWith('JPY')
            ? `${(m.slippage / 0.01).toFixed(1)} pip`
            : m.id === 'XAUUSD'
              ? `$${m.slippage.toFixed(2)}`
              : m.id === 'US30'
                ? `${m.slippage} pt`
                : `${(m.slippage / 0.0001).toFixed(1)} pip`
          : `${(m.slippage * 100).toFixed(2)}%`,
        `${(m.feePerSide * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`,
      ]),
    },
  })

  // Top 10
  out.push({ h: 2, text: 'Top 10 bots (best version of each strategy)' })
  out.push({
    p: `Ranked by out-of-sample money a month. "Both halves" says whether it also made money in-sample; a bot that lost in-sample and won after is more likely lucky than good.`,
  })
  out.push({
    cards: R.top10.map((b, i) => {
      const mk = Object.entries(b.detail.byMarket).sort((x, y) => y[1].net - x[1].net)
      const ss = bestOf(b.detail.bySession)
      return {
        title: `${i + 1}. ${label(b)}`,
        lines: [
          b.what,
          `${usd(s.startMoney)} became **${money(b.oos.end)}** in ${b.oos.months.toFixed(1)} months: **${delta(b.oos.perMonth)} a month**, max drop ${b.oos.maxDrawdownPct.toFixed(1)}%, ${b.oos.tradesPerMonth.toFixed(1)} trades a month (${b.oos.trades} trades, ${pct(b.oos.winRate)} won, profit factor ${num(b.oos.profitFactor, 2)}, worst month ${money(b.oos.worstMonth)}).`,
          `Markets: ${mk.map(([m, v]) => `${mlabel(m)} ${delta(v.net)}`).join(', ')}. Best session: ${ss ?? 'n/a'}. Settings ${JSON.stringify(b.params).replace(/"/g, '')}.`,
          `In-sample: ${delta(b.is.net)} on ${b.is.trades} trades. ${both(b) ? 'Made money in both halves.' : '**Lost in-sample**, so treat the win as luck until it repeats.'} Without any costs: ${delta(b.detail.costs.free)}; with double costs: ${delta(b.detail.costs.double)}.`,
        ],
      }
    }),
  })
  out.push({
    table: {
      head: ['#', 'Bot', '$/month', 'Max drop'],
      narrow: true,
      rows: R.top10.map((b, i) => [
        String(i + 1),
        `${b.name} (${TF[b.tf]}, ${marketsShort(b)})${both(b) ? '' : ' *'}`,
        delta(b.oos.perMonth),
        `${b.oos.maxDrawdownPct.toFixed(0)}%`,
      ]),
    },
  })
  out.push({ p: '* lost money in-sample.' })

  // John's Fib
  out.push({ h: 2, text: "John's Fib" })
  out.push({
    p: 'Sell: after a big drop, 1 at the top of the last bullish candle before it, 0 at the bottom; sell the pullback at 0.786 or 0.886; stop just past 1; half off at 0, the rest at -0.272. Buy is the mirror. "Big" = at least k x the ATR(14) within 12 candles. Six versions: plain limit order, with a reversal candle (engulfing, stars, pin bars, hammers), London session only, candle + the day\'s London direction, and with or without the bigger chart\'s trend (EMA 50).',
  })
  out.push({
    table: {
      head: ['Chart', 'Ranked bots', 'Made money', 'Median $/month'],
      rows: R.fib.byTfStyle.map((g) => [
        g.key.replace('-', ' ').replace('1d', 'daily'),
        String(g.eligible),
        `${g.positiveOos}`,
        g.medianOosPerMonth == null ? 'too few trades' : delta(g.medianOosPerMonth),
      ]),
    },
  })
  out.push({
    table: {
      head: ['Version', 'Ranked bots', 'Made money', 'Median $/month'],
      rows: R.fib.byVariant.map((g) => [
        R.families.find((f) => f.variant === g.key)?.name.replace("John's Fib", 'Fib') ?? g.key,
        String(g.eligible),
        `${g.positiveOos}`,
        g.medianOosPerMonth == null ? 'n/a' : delta(g.medianOosPerMonth),
      ]),
    },
  })
  const fibWin = R.fib.byTfStyle.filter((g) => g.medianOosWinRate != null)
  out.push({
    ul: [
      `Median win rate by chart: ${fibWin.map((g) => `${g.key.split('-')[0]} ${pct(g.medianOosWinRate)}`).join(', ')}. Median result per trade: ${fibWin.map((g) => `${g.key.split('-')[0]} ${num(g.medianOosAvgR, 2)}R`).join(', ')}.`,
      `Settings the walk-forward kept: impulse k ${Object.entries(R.fib.chosenK)
        .map(([k, n]) => `${k}x ATR ${n} times`)
        .join(', ')}; entry ${Object.entries(R.fib.chosenEntry)
        .map(([k, n]) => `${k} ${n} times`)
        .join(', ')}.`,
      R.bestFib
        ? `Best Fib bot: ${label(R.bestFib)}: ${money(R.bestFib.oos.end)} from ${usd(s.startMoney)} (${delta(R.bestFib.oos.perMonth)} a month, ${R.bestFib.oos.trades} trades, max drop ${R.bestFib.oos.maxDrawdownPct.toFixed(1)}%); in-sample ${delta(R.bestFib.is.net)}.`
        : 'No Fib bot had enough trades to rank.',
    ],
  })
  if (R.fibCosts?.length) {
    out.push({ h: 3, text: 'Is it the costs?' })
    out.push({
      p: "John's Fib on all markets, no news filter, out-of-sample, with the same settings: normal costs, no costs at all, double costs.",
    })
    out.push({
      table: {
        head: ['Version, chart', 'Normal', 'No costs', 'Double'],
        rows: R.fibCosts.map((f) => [
          `${(R.families.find((x) => x.variant === f.variant)?.name ?? f.variant).replace("John's Fib", 'Fib')}, ${TF[f.tf]} ${STYLE[f.style]}`,
          delta(f.normal),
          delta(f.free),
          delta(f.double),
        ]),
      },
    })
  }

  // News
  out.push({ h: 2, text: 'What the news filter did' })
  out.push({
    p: 'Each bot was run with and without the filter; out-of-sample money compared, same strategy, chart and markets.',
  })
  out.push({
    table: {
      head: ['Filter', 'Better', 'Worse', 'Median change'],
      rows: Object.entries(R.newsEffect).map(([mode, n]) => [
        mode === 'block'
          ? 'No new trades, keep open'
          : mode === 'close'
            ? 'No new trades, close open'
            : 'Scalper: skip red-news days',
        `${n.better} of ${n.pairs}`,
        `${n.worse}`,
        delta(n.medianDiff ?? 0),
      ]),
    },
  })
  const day = R.newsEffect.day
  if (day?.biggest?.length)
    out.push({
      p: `Skipping red-news days helped the scalper most: ${day.biggest
        .slice(0, 3)
        .map(
          (d) =>
            `${d.family.replace('scalper|', '').replace('-scalp', '')} ${delta(d.off)} to ${delta(d.on)}`,
        )
        .join('; ')}. It still lost money.`,
    })

  // Combined accounts
  if (R.ensembles.length) {
    out.push({ h: 2, text: 'Combining them in one account' })
    out.push({
      table: {
        head: ['Account', 'Out-of-sample', '$/month', 'In-sample'],
        rows: R.ensembles.map((e) => [
          `${e.name}${e.news !== 'off' && e.id.includes('|') ? ` (${NEWS[e.news]})` : ''}`,
          `${money(e.oos.end)} (${e.oos.trades} trades)`,
          delta(e.oos.perMonth),
          delta(e.is.net),
        ]),
      },
    })
  }

  // Families
  out.push({ h: 2, text: 'Every strategy at a glance' })
  out.push({
    table: {
      head: ['Strategy', 'Ranked', 'Made money', 'Median $/month'],
      rows: R.families.map((f) => [
        f.name,
        String(f.eligible),
        `${f.positiveOos} (both halves ${f.positiveBoth})`,
        f.medianOosPerMonth == null ? 'too few trades' : delta(f.medianOosPerMonth),
      ]),
    },
  })
  const failed = R.families.filter(
    (f) => f.eligible > 0 && f.positiveOos === 0 && f.family !== 'control',
  )
  out.push({ h: 3, text: 'What failed' })
  out.push({
    ul: [
      `No version made money out-of-sample: ${failed.map((f) => f.name).join('; ')}.`,
      ...R.families
        .filter((f) => f.eligible === 0 && f.family !== 'control')
        .map(
          (f) =>
            `${f.name}: too few trades to judge (${f.bots} bots, none with ${s.minOosTrades} out-of-sample trades).`,
        ),
    ],
  })

  // Caveats
  out.push({ h: 2, text: 'Honest caveats' })
  out.push({
    ul: [
      `**Past results.** The out-of-sample test is about ${oosMonths('15m')} months for the 5 to 30-minute bots and ${oosMonths('1h')} months for 1-hour and up. Markets change; what worked in that stretch of 2026 may not work next.`,
      `**Luck from testing many bots.** ${c.bots} bots were tried; even with no edge, the best few look good. The best of ${R.luck.eligible} coin flips made ${delta(R.luck.line)} a month; with ${c.eligible} real bots in the pool, pure luck can reach higher than that, so the luck line is a floor, not a ceiling. Trust only what beats it, in both halves, and then in a live forward test.`,
      '**Small samples.** 30 to 60 trades is not much: a few trades either way change the ranking.',
      "**Costs.** Spreads, slippage and commission are typical numbers, not a broker's real fills. Spreads widen at the daily rollover (21:00-22:00 UTC) and on news; that is only partly modelled (the news filter). Tight-stop bots on small charts depend on this most.",
      '**Candles, not ticks.** Inside a candle the order of the high and the low is unknown; the stop is assumed first and a limit fill never reaches its target in its own candle. That leans against the bots.',
      "**London breakout** runs the race's fixed winter UTC hours, so in summer it is an hour late against London (as in the live race).",
      '**Not done:** 5 to 30-minute history for EUR/USD, USD/JPY, US30 and EUR/GBP is only days long so far, so the small-chart bots only trade GBP/USD, gold and Bitcoin.',
    ],
  })
  out.push({ h: 2, text: 'Files' })
  out.push({
    ul: [
      `${DIR}/results.json: every bot (settings, in-sample and out-of-sample numbers), the top 10 with every trade.`,
      `${DIR}/ranking.csv and ranking.md: the full ranking.`,
      'Code: trade-hub src/lib/lab and scripts/lab; how it works: docs/strategy-lab.md. Rerun with `make lab`.',
    ],
  })
  return out
}

// ── markdown ─────────────────────────────────────────────
function toMd(blocks: Block[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    if ('h' in b) lines.push(`${'#'.repeat(b.h)} ${b.text}`, '')
    else if ('p' in b) lines.push(b.p, '')
    else if ('notes' in b) lines.push(b.notes.trim(), '')
    else if ('ul' in b) lines.push(...b.ul.map((x) => `- ${x}`), '')
    else if ('table' in b) {
      lines.push(`| ${b.table.head.join(' | ')} |`, `|${b.table.head.map(() => '---').join('|')}|`)
      for (const r of b.table.rows) lines.push(`| ${r.join(' | ')} |`)
      lines.push('')
    } else if ('cards' in b) {
      for (const c of b.cards) lines.push(`**${c.title}**`, '', ...c.lines.map((l) => `- ${l}`), '')
    }
  }
  return lines.join('\n')
}

// ── html ─────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/([\u2212+]\u2060?\$[\d,]+)/g, '<span class="nw">$1</span>')

function notesHtml(md: string): string {
  const out: string[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`)
    list = []
  }
  for (const para of md.trim().split(/\n\s*\n/)) {
    const ls = para.split('\n')
    if (ls.every((l) => /^\s*[-*] /.test(l))) {
      list.push(...ls.map((l) => l.replace(/^\s*[-*] /, '')))
      continue
    }
    flush()
    if (/^#{1,3} /.test(ls[0])) out.push(`<h3>${inline(ls[0].replace(/^#+ /, ''))}</h3>`)
    else out.push(`<p>${inline(para.replace(/\n/g, ' '))}</p>`)
  }
  flush()
  return out.join('\n')
}

function toHtml(blocks: Block[]): string {
  const body = blocks
    .map((b) => {
      if ('h' in b) return `<h${b.h}>${inline(b.text)}</h${b.h}>`
      if ('p' in b) return `<p>${inline(b.p)}</p>`
      if ('notes' in b) return `<div class="notes">${notesHtml(b.notes)}</div>`
      if ('ul' in b) return `<ul>${b.ul.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`
      if ('table' in b) {
        const t = b.table
        // A column is right-aligned when every cell in it starts like a number.
        const isNum = t.head.map(
          (_, i) => i > 0 && t.rows.every((r) => /^[\u2212+$\d]/.test(r[i] ?? '')),
        )
        const cls = (i: number) => (isNum[i] ? ' class="n"' : '')
        return `<table${t.narrow ? ' class="narrow"' : ''}><thead><tr>${t.head.map((h, i) => `<th${cls(i)}>${inline(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      }
      return b.cards
        .map(
          (c) =>
            `<section class="card"><h3>${inline(c.title)}</h3>${c.lines.map((l, i) => `<p${i ? '' : ' class="what"'}>${inline(l)}</p>`).join('')}</section>`,
        )
        .join('\n')
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Strategy lab</title>
<style>
:root { color-scheme: dark; --bg: #121314; --panel: #1b1c1e; --line: #2c2d30; --text: #e9e8e4; --muted: #a3a29c; --accent: #e7b45a; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; overflow-wrap: anywhere; }
h1 { font-size: 26px; line-height: 1.2; margin: 8px 0 12px; letter-spacing: -0.01em; }
h2 { font-size: 19px; margin: 36px 0 10px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; }
h3 { font-size: 16px; margin: 20px 0 6px; }
p, li { color: var(--text); }
ul { padding-left: 20px; margin: 8px 0; }
li { margin: 6px 0; }
strong { color: #fff; font-weight: 650; }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel); padding: 1px 4px; border-radius: 4px; }
.notes { background: var(--panel); border-left: 3px solid var(--accent); border-radius: 8px; padding: 4px 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 12px 0; }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.card p { margin: 6px 0; font-size: 14.5px; }
.card .what { color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13.5px; table-layout: fixed; }
th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 12.5px; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { width: 40%; }
table.narrow th:first-child, table.narrow td:first-child { width: 2em; }
table.narrow th:nth-child(2), table.narrow td:nth-child(2) { width: 52%; }
td.n, .nw { white-space: nowrap; }
@media (max-width: 420px) { body { font-size: 15px; } table { font-size: 12.5px; } th, td { padding: 6px 4px; } }
</style>
</head>
<body>
<main>
${body}
<p style="color:var(--muted);font-size:13px;margin-top:40px">Play money only. Generated ${esc(R.generatedAt.slice(0, 16).replace('T', ' '))} UTC from results.json.</p>
</main>
</body>
</html>
`
}

MINUS = '-'
writeFileSync(join(DIR, 'REPORT.md'), toMd(build()))
MINUS = '\u2212\u2060' // minus sign + word joiner: never wraps away from its number
writeFileSync(join(DIR, 'REPORT.html'), toHtml(build()))
console.log(`report: ${join(DIR, 'REPORT.md')} and REPORT.html`)
