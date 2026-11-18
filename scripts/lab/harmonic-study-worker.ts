/**
 * Harmonic study worker: started by scripts/lab/harmonic-study.ts, one per
 * market. Loads its market's 1-minute file once, runs both charts and both
 * swing sizes, sends back the trade records and Part 1 counts, then answers
 * twin jobs from the same runs. Offline, play money only.
 */
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import {
  barsBefore,
  fourHourCandles,
  harmonicContext,
  minuteAt,
  runHarmonic,
  simulateTwin,
  type HarmonicContext,
  type HarmonicMarket,
  type Trade,
} from '../../src/lib/lab/harmonic'
import { loadBars } from '../../src/lib/lab/harmonicLoad'
import {
  CHARTS,
  part1Rows,
  periodTime,
  SWING_SIZES,
  tradeRecord,
  twinStamp,
  yearOf,
  type Part1Row,
  type TradeRec,
} from '../../src/lib/lab/harmonicStudy'

export interface LoadJob {
  kind: 'load'
  market: HarmonicMarket
  file: string
  /** Refuse the file if a bar is stamped at or after this (null: no test). */
  refuseFrom: number | null
  /** Read no price at or after this (null: the whole file). */
  readBefore: number | null
  /** Send back only records whose period time, and Part 1 rows whose year, start here. */
  keepFrom: number
}

export interface TwinJob {
  kind: 'twins'
  jobs: {
    name: string
    exit: number
    uids: number[]
    /** Seed-major: moves[s * uids.length + i] in days. */
    moves: number[]
    seeds: number
  }[]
}

export interface TwinSeed {
  n: number
  sumAfter: number
  sumBefore: number
}

export type WorkerReply =
  | { kind: 'ready' }
  | { kind: 'refused'; market: HarmonicMarket; reason: string }
  | {
      kind: 'loaded'
      market: HarmonicMarket
      bars: number
      first: number
      last: number
      recs: TradeRec[]
      part1: Part1Row[]
      ms: number
    }
  | { kind: 'twins'; results: { name: string; seeds: TwinSeed[] }[]; ms: number }
  | { kind: 'error'; error: string }

/** First stamp at or after t in a gzip CSV, reading only up to it (the file is not read further), or null. */
export async function firstStampAtOrAfter(file: string, t: number): Promise<number | null> {
  const stream = createReadStream(file).pipe(createGunzip())
  stream.setEncoding('utf8')
  let rest = ''
  let header = true
  try {
    for await (const chunk of stream as AsyncIterable<string>) {
      const s = rest + chunk
      let from = 0
      for (let at = s.indexOf('\n'); at >= 0; at = s.indexOf('\n', from)) {
        const line = s.slice(from, at)
        from = at + 1
        if (header) {
          header = false
          continue
        }
        const stamp = Number(line.slice(0, line.indexOf(',')))
        if (stamp >= t) return stamp
      }
      rest = s.slice(from)
    }
    if (rest !== '' && !header) {
      const stamp = Number(rest.slice(0, rest.indexOf(',')))
      if (stamp >= t) return stamp
    }
    return null
  } finally {
    stream.destroy()
  }
}

const send = (m: WorkerReply) => process.send?.(m)

let ctxs: Map<number, HarmonicContext> | null = null
let trades: Trade[] = []

async function load(job: LoadJob) {
  const t0 = Date.now()
  if (job.refuseFrom !== null) {
    const hit = await firstStampAtOrAfter(job.file, job.refuseFrom)
    if (hit !== null) {
      send({
        kind: 'refused',
        market: job.market,
        reason: `${job.file} holds a bar stamped ${new Date(hit * 1000).toISOString()}, at or after ${new Date(job.refuseFrom * 1000).toISOString()}`,
      })
      return
    }
  }
  const whole = await loadBars(job.file)
  const bars = job.readBefore === null ? whole : barsBefore(whole, job.readBefore)
  const four = fourHourCandles(bars)
  ctxs = new Map(CHARTS.map((c) => [c, harmonicContext(bars, job.market, c, four)]))
  trades = []
  const recs: TradeRec[] = []
  const part1: Part1Row[] = []
  const keepYear = yearOf(job.keepFrom)
  for (const chart of CHARTS) {
    const ctx = ctxs.get(chart)!
    for (const k of SWING_SIZES) {
      const run = runHarmonic(ctx, k)
      part1.push(...part1Rows(run.patterns, (y) => y >= keepYear))
      for (const t of run.trades) {
        const r = tradeRecord(t, ctx.chart, trades.length)
        trades.push(t)
        if (periodTime(r) >= job.keepFrom) recs.push(r)
      }
    }
  }
  send({
    kind: 'loaded',
    market: job.market,
    bars: bars.n,
    first: bars.n ? bars.time[0] : NaN,
    last: bars.n ? bars.time[bars.n - 1] : NaN,
    recs,
    part1,
    ms: Date.now() - t0,
  })
}

function twins(job: TwinJob) {
  const t0 = Date.now()
  if (!ctxs) throw new Error('twins before load')
  const results = job.jobs.map((j) => {
    const seeds: TwinSeed[] = []
    for (let s = 0; s < j.seeds; s++) {
      const acc: TwinSeed = { n: 0, sumAfter: 0, sumBefore: 0 }
      j.uids.forEach((uid, i) => {
        const tr = trades[uid]
        const ctx = ctxs!.get(tr.pattern.chart)!
        const stamp = twinStamp(
          tr.fillTime,
          j.moves[s * j.uids.length + i],
          (x) => minuteAt(ctx.bars, x) >= 0,
        )
        if (stamp === null) return
        const o = simulateTwin(ctx, tr, j.exit, minuteAt(ctx.bars, stamp))
        acc.n++
        acc.sumAfter += o.after
        acc.sumBefore += o.before
      })
      seeds.push(acc)
    }
    return { name: j.name, seeds }
  })
  send({ kind: 'twins', results, ms: Date.now() - t0 })
}

process.on('message', (job: LoadJob | TwinJob | { kind: 'exit' }) => {
  if (job.kind === 'exit') process.exit(0)
  Promise.resolve()
    .then(() => (job.kind === 'load' ? load(job) : twins(job)))
    .catch((e) =>
      send({ kind: 'error', error: e instanceof Error ? (e.stack ?? e.message) : String(e) }),
    )
})
process.on('disconnect', () => process.exit(0))
send({ kind: 'ready' })
