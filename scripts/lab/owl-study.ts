/**
 * What is worth taking from the Golden Owl (docs/owl-study.md; the plan was
 * committed and pushed before this script existed). Counts how often gold
 * bounces back a step in the Owl's hours, and runs an illustration of a grid
 * with the Owl's passive numbers. Offline, play money research.
 *
 *   tsx scripts/lab/owl-study.ts --hist <histdata dir> --frozen <frozen 1-minute dir> --out <dir>
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import { loadCandleFile } from '../../src/lib/lab/load'
import {
  OWL,
  bounceCount,
  candlesIn,
  eveningOf,
  gridEvening,
  isWeekday,
  londonHoursOf,
  type BounceCount,
  type Window,
} from '../../src/lib/lab/owl'

const DAY = 86_400
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${k}`)
  return process.argv[i + 1]
}
const HIST = resolve(arg('hist'))
const FROZEN = resolve(arg('frozen'))
const OUT = resolve(arg('out'))
/** The HistData gold file fixed in the v1 exam (docs/v1-older-years-exam.md on branch lab/v1-older-years). */
const HIST_SHA = '918b9c8113a1812acc1861cb043df8b62840950c74df5a4f8457a76f09bcbcf3'
const FROM = Date.UTC(2019, 0, 1) / 1000
const SPLICE = Date.UTC(2026, 0, 1) / 1000
const TO = Date.UTC(2026, 10, 11) / 1000
/** The presets were written between March and May 2022: the fair part starts here. */
const FAIR_FROM = Date.UTC(2022, 5, 1) / 1000
const COSTS = [
  { key: 'best', label: 'best case, $0.20 a round trip', c: 0.2 },
  { key: 'typical', label: 'typical, $0.35 a round trip', c: 0.35 },
] as const
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
/** The grid run ends when the account is under this share of its start. */
const RUIN_SHARE = 0.1

const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const money = (x: number) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(0)}`
const yearOf = (day: number) => new Date(day * 1000).getUTCFullYear()
const add = (a: BounceCount, b: BounceCount): BounceCount => ({
  steps: a.steps + b.steps,
  bounces: a.bounces + b.bounces,
  onward: a.onward + b.onward,
  fast: a.fast + b.fast,
  firstBounces: a.firstBounces + b.firstBounces,
  firstOnward: a.firstOnward + b.firstOnward,
})
const ZERO: BounceCount = {
  steps: 0,
  bounces: 0,
  onward: 0,
  fast: 0,
  firstBounces: 0,
  firstOnward: 0,
}
/** The generous estimate added after the first run: only the first step of each price move counts. It leans toward bounces and is not a strict limit. */
const firstRate = (c: BounceCount) => c.firstBounces / (c.firstBounces + c.firstOnward)
const rate = (c: BounceCount) => c.bounces / (c.bounces + c.onward)
/** Plus or minus, in percentage points: two standard errors of a share (steps treated as independent). */
const margin = (c: BounceCount) => {
  const n = c.bounces + c.onward
  const p = rate(c)
  return 200 * Math.sqrt((p * (1 - p)) / n)
}

interface Session {
  w: Window
  candles: OHLCCandle[]
}

/** Every window of the given kind between FROM and TO that has enough candles; `skipped` counts the ones that sat out. */
function sessions(m1: OHLCCandle[], make: (day: number) => Window, days: readonly number[]) {
  const out: Session[] = []
  let skipped = 0
  let i = 0
  for (let day = FROM; day < TO; day += DAY) {
    if (!isWeekday(day, days)) continue
    const w = make(day)
    if (w.to > TO) continue
    while (i < m1.length && m1[i].time < w.from) i++
    const candles = candlesIn(m1, i, w)
    if (candles) out.push({ w, candles })
    else skipped++
  }
  return { out, skipped }
}

function byYear(ss: Session[]) {
  const per: Record<number, { n: number; c: BounceCount }> = {}
  for (const s of ss) {
    const y = yearOf(s.w.day)
    const e = (per[y] ??= { n: 0, c: ZERO })
    e.n++
    e.c = add(e.c, bounceCount(s.candles))
  }
  return per
}

function grid(ss: Session[], cost: number, from: number) {
  let balance: number = OWL.startMoney
  let peak = balance
  let drop = 0
  const per: Record<
    number,
    {
      n: number
      up: number
      upSum: number
      stops: number
      pnl: number
      start: number
      worst: number
    }
  > = {}
  let ruined: string | null = null
  for (const s of ss) {
    if (s.w.day < from) continue
    // An account under a tenth of its start cannot run this grid any more: the run ends there.
    if (balance < RUIN_SHARE * OWL.startMoney) {
      ruined = new Date(s.w.day * 1000).toISOString().slice(0, 10)
      break
    }
    const y = yearOf(s.w.day)
    const e = (per[y] ??= { n: 0, up: 0, upSum: 0, stops: 0, pnl: 0, start: balance, worst: 0 })
    const r = gridEvening(s.candles, balance, cost)
    e.n++
    if (r.pnl > 0) {
      e.up++
      e.upSum += r.pnl
    }
    if (r.stopped) e.stops++
    e.pnl += r.pnl
    e.worst = Math.min(e.worst, r.pnl)
    balance += r.pnl
    peak = Math.max(peak, balance)
    drop = Math.max(drop, (peak - balance) / peak)
  }
  return { per, end: balance, drop, ruined }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const histFile = join(HIST, 'XAUUSD', 'XAUUSD_1m.csv.gz')
  if (createHash('sha256').update(readFileSync(histFile)).digest('hex') !== HIST_SHA)
    throw new Error(`${histFile} is not the gold file fixed in the v1 exam`)
  const hist = await loadCandleFile(histFile)
  const frozen = await loadCandleFile(join(FROZEN, 'XAUUSD', 'XAUUSD_1m.csv.gz'))
  const m1 = [
    ...hist.filter((b) => b.time >= FROM && b.time < SPLICE),
    ...frozen.filter((b) => b.time >= SPLICE && b.time < TO),
  ]

  const lines: string[] = []
  const results: Record<string, unknown> = {}
  lines.push(
    `Gold 1-minute candles: ${m1.length}, ${new Date(m1[0].time * 1000).toISOString().slice(0, 10)} to ${new Date(m1[m1.length - 1].time * 1000).toISOString().slice(0, 10)}`,
  )

  // Part 1: the bounce count.
  const owl = sessions(m1, eveningOf, OWL.eveningDays)
  const other = sessions(m1, eveningOf, [4, 5])
  const london = sessions(m1, londonHoursOf, [1, 2, 3, 4, 5])
  lines.push('')
  lines.push(
    'PART 1: the bounce count ($1 steps). A fade needs over 60.0% at the best cost and over 67.5% at the typical cost.',
  )
  lines.push(
    '   "Too fast" = steps that came two or more inside one price move of a 1-minute candle, where a bounce in between cannot be seen. The generous estimate counts only the first step of each move and leans toward bounces (added after the first run).',
  )
  const table = (name: string, x: { out: Session[]; skipped: number }) => {
    const per = byYear(x.out)
    let all = ZERO
    lines.push(`${name}: ${x.out.length} sessions counted, ${x.skipped} sat out`)
    for (const y of YEARS) {
      const e = per[y]
      if (!e) continue
      all = add(all, e.c)
      lines.push(
        `   ${y}: ${String(e.n).padStart(3)} sessions  ${String(e.c.steps).padStart(6)} steps (${f(e.c.steps / e.n)} a session)  bounce rate ${f(100 * rate(e.c))}% (plus or minus ${f(margin(e.c))})  | too fast for 1-minute candles: ${f((100 * e.c.fast) / e.c.steps, 0)}% of steps; generous estimate ${f(100 * firstRate(e.c))}%`,
      )
    }
    lines.push(
      `   all: ${all.steps} steps  bounce rate ${f(100 * rate(all))}% (plus or minus ${f(margin(all), 2)})  | too fast: ${f((100 * all.fast) / all.steps, 0)}% of steps; generous estimate ${f(100 * firstRate(all))}%`,
    )
    results[name] = { per, all, sessions: x.out.length, skipped: x.skipped }
    return per
  }
  const owlPer = table("The Owl's hours (Mon to Wed evenings, 18:05 to 24:00 New York)", owl)
  table('Thursday and Friday evenings, same clock hours', other)
  table('London hours (07:00 to 16:30 London), all weekdays', london)

  // Part 2: the grid illustration.
  lines.push('')
  lines.push(
    `PART 2: a grid with the Owl's passive numbers, $${OWL.startMoney} play account (our reading of the preset, not the Owl itself)`,
  )
  const ends: Record<string, { all: number; fair: number }> = {}
  for (const k of COSTS) {
    for (const [label, from] of [
      ['all years', FROM],
      ['June 2022 on (after the presets were written)', FAIR_FROM],
    ] as const) {
      const g = grid(owl.out, k.c, from)
      lines.push(
        `${k.label}; ${label}: $${OWL.startMoney} became $${g.end.toFixed(0)}, worst drop ${f(g.drop * 100)}%${g.ruined ? `; ACCOUNT UNDER A TENTH OF ITS START, the run ended before ${g.ruined}` : ''}`,
      )
      for (const y of YEARS) {
        const e = g.per[y]
        if (!e) continue
        lines.push(
          `   ${y}: ${String(e.n).padStart(3)} evenings  ${String(e.up).padStart(3)} ended up (average ${money(e.up ? e.upSum / e.up : 0)})  ${String(e.stops).padStart(2)} hit the 4% stop  worst evening ${money(e.worst)}  year ${money(e.pnl)} (${f((100 * e.pnl) / e.start)}%)`,
        )
      }
      results[`grid ${k.key} ${from === FROM ? 'all' : 'fair'}`] = g
      ends[k.key] = {
        ...(ends[k.key] ?? { all: 0, fair: 0 }),
        [from === FROM ? 'all' : 'fair']: g.end,
      }
    }
  }

  // The reading fixed in the plan.
  const under = YEARS.filter((y) => owlPer[y] && rate(owlPer[y].c) < 0.6).length
  const atLeast = YEARS.filter((y) => owlPer[y] && rate(owlPer[y].c) >= 0.6).length
  const gridUp = COSTS.every((k) => ends[k.key].fair > OWL.startMoney)
  const reading =
    under >= 5
      ? 'NO BOUNCE EDGE'
      : atLeast >= 6 && gridUp
        ? 'A BOUNCE WORTH A PLAY ACCOUNT'
        : 'UNCLEAR'
  lines.push('')
  lines.push(
    `The reading fixed in the plan: ${reading} (years with a bounce rate under 60% in the Owl's hours: ${under} of ${under + atLeast}; grid above its start at both cost levels from June 2022 on: ${gridUp ? 'yes' : 'no'})`,
  )
  console.log(lines.join('\n'))
  writeFileSync(join(OUT, 'results.txt'), lines.join('\n') + '\n')
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ reading, results }, null, 1))
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
