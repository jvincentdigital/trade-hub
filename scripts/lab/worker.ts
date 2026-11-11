/**
 * Strategy lab worker: started by scripts/lab/run.ts (one per core it uses).
 * Takes jobs over IPC, keeps candles and planned trades cached between jobs,
 * answers with results. Play money only: reads local history files, nothing else.
 */
import { LabRunner, runEnsemble, type BotSpec, type EnsemblePart } from '../../src/lib/lab/bots'
import { DEFAULT_HISTORY_DIR, loadMarket, loadNews } from '../../src/lib/lab/load'

export type LabJob =
  | { id: number; kind: 'group'; specs: BotSpec[] }
  | { id: number; kind: 'detail'; spec: BotSpec }
  | { id: number; kind: 'ensemble'; ensId: string; name: string; parts: EnsemblePart[] }

async function main() {
  const dir = process.env.LAB_HISTORY ?? DEFAULT_HISTORY_DIR
  const news = await loadNews(dir)
  const runner = new LabRunner({ candles: (m, tf) => loadMarket(dir, m, tf), news })
  const send = (msg: unknown) => process.send?.(msg)

  process.on('message', async (job: LabJob | { kind: 'exit' }) => {
    if (job.kind === 'exit') process.exit(0)
    try {
      const t0 = Date.now()
      let result: unknown
      if (job.kind === 'group') {
        const out = []
        for (const spec of job.specs) out.push(await runner.result(spec))
        result = out
      } else if (job.kind === 'detail') {
        result = await runner.detail(job.spec)
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
