/**
 * Strategy race, live forward test: one tick.
 *
 *   npx tsx scripts/race-tick.ts            (or: make race-tick)
 *   npx tsx scripts/race-tick.ts --reset --start 1000
 *
 * Fetches fresh candles once per market (CoinGecko free for crypto and gold,
 * Frankfurter for forex; no keys, sequential with pauses), asks every built-in strategy for its latest
 * signal on closed candles, and opens/closes trades in that strategy's own
 * play-money account. State: ~/.local/share/trade-hub/race.json
 * (override with RACE_FILE). Play money only: nothing here talks to a broker.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { BUILT_IN_RULES } from '../src/lib/rules/presets'
import { latestSignal } from '../src/lib/rules/engine'
import { ruleInstrumentIds } from '../src/lib/rules/data'
import { getInstrument, INSTRUMENTS } from '../src/lib/paper/instruments'
import { FEE_RATE, LEVERAGE } from '../src/lib/paper/engine'
import { closedOnly, resample, TF_HOURS } from '../src/lib/race/candles'
import { fetchForexDaily, fetchHourlyCandles } from '../src/lib/race/feeds'
import {
  createRaceState,
  MAX_TICK_LOG,
  raceStateSchema,
  stepSlot,
  summarize,
  syncRaceState,
  type RaceState,
} from '../src/lib/race/live'
import type { OHLCCandle } from '../src/lib/types/market'

const FILE = process.env.RACE_FILE || join(homedir(), '.local/share/trade-hub/race.json')
const args = process.argv.slice(2)
const startArg = args.includes('--start') ? Number(args[args.indexOf('--start') + 1]) : 1000
const money = (n: number) => `${n < -0.005 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function load(): RaceState | null {
  if (!existsSync(FILE)) return null
  const parsed = raceStateSchema.safeParse(JSON.parse(readFileSync(FILE, 'utf8')))
  if (!parsed.success)
    throw new Error(`${FILE} is not a valid race file; fix it or run with --reset`)
  return parsed.data
}

function save(state: RaceState) {
  mkdirSync(dirname(FILE), { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 1))
  renameSync(tmp, FILE)
}

async function fetchMarket(id: string): Promise<OHLCCandle[]> {
  const inst = getInstrument(id)
  const get = () => (inst?.market === 'forex' ? fetchForexDaily(id) : fetchHourlyCandles(id))
  try {
    return await get()
  } catch {
    await sleep(30_000) // the free CoinGecko tier rate-limits bursts: one polite retry
    return get()
  }
}

async function main() {
  const rules = BUILT_IN_RULES.map((r) => ({ rule: r, markets: ruleInstrumentIds(r, INSTRUMENTS) }))
  let state = args.includes('--reset') ? null : load()
  if (!state) {
    if (!(startArg > 0)) throw new Error('--start must be a positive number')
    state = createRaceState(
      rules.map(({ rule, markets }) => ({ id: rule.id, name: rule.name, markets })),
      startArg,
    )
    console.log(`New race: $${startArg} per strategy, ${rules.length} strategies`)
  }
  // New strategies or markets (gold) join without touching open trades.
  const synced = syncRaceState(
    state,
    rules.map(({ rule, markets }) => ({ id: rule.id, name: rule.name, markets })),
  )
  state = synced.state
  for (const c of synced.changes) console.log(`  ${c}`)

  const needed = [...new Set(rules.flatMap((r) => r.markets))]
  const data = new Map<string, OHLCCandle[]>()
  const skipped: string[] = []
  for (const [n, id] of needed.entries()) {
    try {
      data.set(id, await fetchMarket(id))
      process.stdout.write(`  ${n + 1}/${needed.length} ${id} ok\n`)
    } catch (e) {
      skipped.push(id)
      process.stdout.write(`  ${n + 1}/${needed.length} ${id} skipped (${(e as Error).message})\n`)
    }
    if (getInstrument(id)?.market !== 'forex') await sleep(6000)
  }

  const nowSec = Math.floor(Date.now() / 1000)
  let checked = 0
  let opened = 0
  let closed = 0
  for (const { rule, markets } of rules) {
    const acct = state.strategies[rule.id]
    for (const id of markets) {
      const path = data.get(id)
      const slot = acct.slots[id]
      if (!path?.length || !slot) continue
      const market = getInstrument(id)?.market ?? 'crypto'
      const tf = market === 'forex' ? '1d' : rule.timeframe
      const signalCandles =
        market === 'forex' ? path : closedOnly(resample(path, TF_HOURS[tf]), TF_HOURS[tf], nowSec)
      const signal = latestSignal({ ...rule, timeframe: tf }, signalCandles)
      const price = path[path.length - 1].close
      state.prices[id] = price
      const r = stepSlot(slot, {
        market: id,
        signal,
        path,
        price,
        nowSec,
        riskPct: rule.riskPct,
        feeRate: FEE_RATE[market],
        leverage: LEVERAGE[market],
      })
      acct.slots[id] = r.slot
      checked++
      if (r.closed) {
        closed++
        acct.closed.push(r.closed)
        console.log(`  CLOSE ${rule.name} ${id} ${r.closed.reason} ${money(r.closed.pnl)}`)
      }
      if (r.opened) {
        opened++
        console.log(`  OPEN  ${rule.name} ${id} ${r.opened.direction} at ${r.opened.entry}`)
      }
    }
  }

  state.tickCount += 1
  state.ticks = [...state.ticks, { at: Date.now(), checked, opened, closed, skipped }].slice(
    -MAX_TICK_LOG,
  )
  save(state)

  console.log(
    `${new Date().toISOString()} tick #${state.tickCount}: ${checked} checks, ${opened} opened, ${closed} closed, ${skipped.length} markets skipped`,
  )
  for (const s of summarize(state)) {
    console.log(
      `  ${s.name.padEnd(28)} $${s.money.toFixed(2).padStart(9)}  ${money(s.pnl)}  open ${s.open.length}  closed ${s.closed.length}`,
    )
  }
  console.log(`Saved ${FILE} (play money only)`)
}

main().catch((e) => {
  console.error(`race tick failed: ${(e as Error).message}`)
  process.exit(1)
})
