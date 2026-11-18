/**
 * Levels study worker: started by scripts/lab/levels-study.ts, one per market
 * and job. Reads its market's 1-minute file once, puts it through the chosen
 * price series, runs the engine (runLevels) and sends back the level records,
 * the visits of the levels and round numbers with their trades, the twin sums,
 * the closed days and 4-hour candles for Part 5, and fingerprints of the file
 * and of the bars before the boundary. Then it exits. Offline, play money only.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Bars, HarmonicMarket } from '../../src/lib/lab/harmonicFind'
import { readMarket } from '../../src/lib/lab/harmonicLoad'
import {
  buildDays,
  buildFourHours,
  runLevels,
  TV,
  type LevelsRun,
  type VisitRec,
} from '../../src/lib/lab/levels'
import { shuffleDays } from '../../src/lib/lab/levelsShuffle'
import { addVisitRec, Cells, levelCells, type Cell } from '../../src/lib/lab/levelsStudy'

/** Placebo 2's shuffle of one market: days, days now in another's place, minutes dropped. */
export interface ShuffleInfo {
  days: number
  moved: number
  minutes: number
  outside: number
  taken: number
}

/**
 * The price series the same pipeline can run on. 'real' is the file as it
 * is; 'shuffled' is Placebo 2's shuffled days, each day moving only inside
 * the job's blocks of years.
 */
export const SERIES = {
  real: (bars: Bars): { bars: Bars; shuffle: ShuffleInfo | null } => ({ bars, shuffle: null }),
  shuffled: (bars: Bars, job: LevelsJob): { bars: Bars; shuffle: ShuffleInfo | null } => {
    const s = shuffleDays(bars, job.blocks ?? [])
    const { days, moved, minutes, outside, taken } = s
    return { bars: s.bars, shuffle: { days, moved, minutes, outside, taken } }
  },
} as const
export type SeriesName = keyof typeof SERIES

export interface LevelsJob {
  market: HarmonicMarket
  file: string
  /** Keep no bar stamped at or after this (null: the whole file). */
  readBefore: number | null
  /** The bars fingerprint covers the bars stamped before this. */
  hashBefore: number
  series: SeriesName
  /** 'shuffled': the blocks of years ([from, to) in UTC seconds) a day may move inside. */
  blocks?: [number, number][]
}

/**
 * What a Placebo 2 run sends back instead of records: the level visits'
 * cells, and the level and twin visit cells of the visits touched on days
 * whose range is at most 1.5 x the ATR in force (the limit line).
 */
export interface Placebo2Cells {
  shuffle: ShuffleInfo
  lv: Cell[]
  lvCalm: Cell[]
  tvCalm: Cell[]
}

export interface MarketRun {
  market: HarmonicMarket
  series: SeriesName
  file: string
  fileSha256: string
  bars: number
  first: number
  last: number
  /** sha256 of the time, open, high, low and close columns of the bars stamped before hashBefore. */
  barsHash: string
  barsHashed: number
  run: Pick<LevelsRun, 'levels' | 'visits' | 'twins' | 'counts' | 'fifteenth'>
  /** Closed candles only (the last candle of a file never closes). */
  days: { name: Int32Array; close: Float64Array }
  four: { start: Float64Array; close: Float64Array }
  ms: number
  rssMB: number
  /** Only for the 'shuffled' series, whose run then holds only the twins' visits by week. */
  placebo2?: Placebo2Cells
}

export type WorkerReply = { kind: 'done'; result: MarketRun } | { kind: 'error'; error: string }

async function fileSha256(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

function barsHash(bars: Bars, before: number): { hash: string; n: number } {
  let n = 0
  while (n < bars.n && bars.time[n] < before) n++
  const h = createHash('sha256')
  for (const col of [bars.time, bars.open, bars.high, bars.low, bars.close])
    h.update(Buffer.from(col.buffer, col.byteOffset, n * 8))
  return { hash: h.digest('hex'), n }
}

async function work(job: LevelsJob): Promise<MarketRun> {
  const t0 = Date.now()
  const read = await readMarket(job.file, null, job.readBefore)
  if (!('bars' in read)) throw new Error('unexpected refusal')
  const { bars, shuffle } = SERIES[job.series](read.bars, job)
  const fp = barsHash(bars, job.hashBefore)
  const calm = new Cells(TV.size)
  const calmDay = (v: VisitRec) => v.dayRangeAtr <= 1.5
  const run = runLevels(
    bars,
    job.market,
    shuffle
      ? {
          onTwinVisit: (v) => {
            if (calmDay(v))
              addVisitRec(
                calm.get(job.market, v.kind, v.year, v.side === 'below' ? 1 : -1, v.week),
                v,
              )
          },
        }
      : {},
  )
  if (shuffle) {
    const all = levelCells(job.market, run.visits)
    const lvCalm = levelCells(job.market, run.visits.filter(calmDay))
    return {
      market: job.market,
      series: job.series,
      file: job.file,
      fileSha256: await fileSha256(job.file),
      bars: bars.n,
      first: bars.n ? bars.time[0] : NaN,
      last: bars.n ? bars.time[bars.n - 1] : NaN,
      barsHash: fp.hash,
      barsHashed: fp.n,
      run: {
        levels: [],
        visits: [],
        twins: {
          visitsByWeek: run.twins.visitsByWeek,
          visitsBySet: [],
          placebo: [],
          tradesByWeek: [],
          tradesBySet: [],
        },
        counts: run.counts,
        fifteenth: run.fifteenth,
      },
      days: { name: new Int32Array(0), close: new Float64Array(0) },
      four: { start: new Float64Array(0), close: new Float64Array(0) },
      ms: Date.now() - t0,
      rssMB: process.resourceUsage().maxRSS / 1024,
      placebo2: { shuffle, lv: all.visits, lvCalm: lvCalm.visits, tvCalm: calm.list() },
    }
  }
  const days = buildDays(bars)
  const four = buildFourHours(bars)
  const closed = (n: number) => Math.max(0, n - 1)
  return {
    market: job.market,
    series: job.series,
    file: job.file,
    fileSha256: await fileSha256(job.file),
    bars: bars.n,
    first: bars.n ? bars.time[0] : NaN,
    last: bars.n ? bars.time[bars.n - 1] : NaN,
    barsHash: fp.hash,
    barsHashed: fp.n,
    run: {
      levels: run.levels,
      visits: run.visits,
      twins: run.twins,
      counts: run.counts,
      fifteenth: run.fifteenth,
    },
    days: { name: days.name.slice(0, closed(days.n)), close: days.close.slice(0, closed(days.n)) },
    four: {
      start: four.start.slice(0, closed(four.n)),
      close: four.close.slice(0, closed(four.n)),
    },
    ms: Date.now() - t0,
    rssMB: process.resourceUsage().maxRSS / 1024,
  }
}

process.on('message', (job: LevelsJob) => {
  work(job)
    .then((result) => process.send?.({ kind: 'done', result } satisfies WorkerReply))
    .catch((e) =>
      process.send?.({
        kind: 'error',
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      } satisfies WorkerReply),
    )
})
process.on('disconnect', () => process.exit(0))
process.send?.({ kind: 'ready' })
