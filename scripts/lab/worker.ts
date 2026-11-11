/**
 * Strategy lab worker: started by scripts/lab/run.ts (one per core it uses).
 * Takes jobs over IPC, keeps candles and planned trades cached between jobs,
 * answers with results. Play money only: reads local history files, nothing else.
 */
import { LabRunner, runEnsemble, type BotSpec, type EnsemblePart } from '../../src/lib/lab/bots'
import { existsSync } from 'node:fs'
import {
  DEFAULT_HISTORY_DIR,
  DEFAULT_OLD_HISTORY_DIR,
  loadMarket,
  loadNews,
} from '../../src/lib/lab/load'
import { ismEvents } from '../../src/lib/lab/news'

export type LabJob =
  | { id: number; kind: 'group'; specs: BotSpec[] }
  | { id: number; kind: 'detail'; spec: BotSpec }
  | { id: number; kind: 'ensemble'; ensId: string; name: string; parts: EnsemblePart[] }

async function main() {
  const dir = process.env.LAB_HISTORY ?? DEFAULT_HISTORY_DIR
  const oldDir = process.env.LAB_OLD_HISTORY ?? DEFAULT_OLD_HISTORY_DIR
  const csv = await loadNews(dir)
  // The CSV has no ISM rows (its calendar is behind a captcha): add them by rule.
  const news = [...csv, ...ismEvents(csv[0].time, csv[csv.length - 1].time)].sort(
    (a, b) => a.time - b.time,
  )
  const runner = new LabRunner({ candles: (m, tf) => loadMarket(dir, m, tf), news })
  // Older history (no news list before 2024-11: the filter has nothing to block there).
  const old = existsSync(oldDir)
    ? new LabRunner({ candles: (m, tf) => loadMarket(oldDir, m, tf), news: [] })
    : undefined
  const send = (msg: unknown) => process.send?.(msg)

  process.on('message', async (job: LabJob | { kind: 'exit' }) => {
    if (job.kind === 'exit') process.exit(0)
    try {
      const t0 = Date.now()
      let result: unknown
      if (job.kind === 'group') {
        const out = []
        for (const spec of job.specs) out.push(await runner.result(spec, old))
        result = out
      } else if (job.kind === 'detail') {
        result = await runner.detail(job.spec, old)
      } else {
        result = await runEnsemble(runner, job.ensId, job.name, job.parts)
      }
      send({ kind: 'done', id: job.id, ms: Date.now() - t0, result })
    } catch (e) {
      send({
        kind: 'error',
        id: job.id,
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      })
    }
  })
  send({ kind: 'ready' })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
