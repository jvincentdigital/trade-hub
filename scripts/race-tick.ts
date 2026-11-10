/**
 * Strategy race, live forward test: one tick.
 *
 *   npx tsx scripts/race-tick.ts            (or: make race-tick)
 *   npx tsx scripts/race-tick.ts --reset --start 1000
 *   npx tsx scripts/race-tick.ts --push-only   (send the saved state to the live site, no tick)
 *   npx tsx scripts/race-tick.ts --no-push     (tick without sending, for a test file in RACE_FILE)
 *   make race-reset                            (back up race.json, start over, first tick, push)
 *
 * Fetches fresh candles per market (Kraken's free public OHLC for crypto and
 * gold, one call per candle size in use, about 1 a second; Frankfurter for
 * forex; no keys), asks every built-in strategy for its latest
 * signal on closed candles, and opens/closes trades in that strategy's own
 * play-money account: one balance across all its markets, every trade
 * risking 2% of it (src/lib/race/account.ts). State: ~/.local/share/trade-hub/race.json
 * (override with RACE_FILE). Play money only: nothing here talks to a broker.
 *
 * After saving, the state is PUT to the race relay worker (docs/live.md) when
 * ~/.local/share/trade-hub/race.env exists (RACE_PUT_URL + RACE_WRITE_KEY).
 * A failed push only logs a line; the tick itself still counts.
 */
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { BUILT_IN_RULES } from '../src/lib/rules/presets'
import { latestSignal } from '../src/lib/rules/engine'
import { ruleInstrumentIds } from '../src/lib/rules/data'
import { getInstrument, INSTRUMENTS, type PriceMap } from '../src/lib/paper/instruments'
import { sizingLine, sizingOf, usdPerQuoteFor } from '../src/lib/sizing/sizing'
import { FEE_RATE, LEVERAGE } from '../src/lib/paper/engine'
import { closedOnly, TF_HOURS } from '../src/lib/race/candles'
import { fetchForexDaily } from '../src/lib/race/feeds'
import { fetchKrakenCandles } from '../src/lib/kraken'
import type { RuleTimeframe } from '../src/lib/rules/schema'
import {
  createRaceState,
  MAX_TICK_LOG,
  parseRaceState,
  stepStrategy,
  summarize,
  syncRaceState,
  type MarketTick,
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
  const parsed = parseRaceState(JSON.parse(readFileSync(FILE, 'utf8')))
  if (!parsed.ok) throw new Error(`${FILE} is not a valid race file; fix it or run make race-reset`)
  if (parsed.migrated) {
    // Old layout (money split per market): keep a copy before the first save in the new one.
    const bak = `${FILE}.bak-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-split`
    copyFileSync(FILE, bak)
    console.log(`Moved the race to one account per strategy (old file kept at ${bak})`)
  }
  return parsed.state
}

function save(state: RaceState) {
  mkdirSync(dirname(FILE), { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 1))
  renameSync(tmp, FILE)
}

const ENV_FILE = join(homedir(), '.local/share/trade-hub/race.env')

/** Send the saved state to the live site's relay. Never throws, never prints the key. */
async function push(state: RaceState) {
  if (!existsSync(ENV_FILE)) return
  const env = Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  if (!env.RACE_PUT_URL || !env.RACE_WRITE_KEY) return
  try {
    const res = await fetch(env.RACE_PUT_URL, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${env.RACE_WRITE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(20_000),
    })
    console.log(
      res.ok ? 'Pushed to the live site' : `Push to the live site failed: HTTP ${res.status}`,
    )
  } catch (e) {
    console.log(`Push to the live site failed: ${(e as Error).message}`)
  }
}

const isForex = (id: string) => getInstrument(id)?.market === 'forex'

/** Forex: daily, one polite retry. Crypto/gold: lib/kraken spaces, caches and retries itself. */
async function fetchMarket(id: string, tf: RuleTimeframe): Promise<OHLCCandle[]> {
  if (!isForex(id)) return fetchKrakenCandles(id, tf)
  try {
    return await fetchForexDaily(id)
  } catch {
    await sleep(30_000)
    return fetchForexDaily(id)
  }
}

async function main() {
  const rules = BUILT_IN_RULES.map((r) => ({ rule: r, markets: ruleInstrumentIds(r, INSTRUMENTS) }))
  if (args.includes('--push-only')) {
    const saved = load()
    if (!saved) throw new Error(`no race file at ${FILE}`)
    await push(saved)
    return
  }
  let state = args.includes('--reset') ? null : load()
  if (!state) {
    if (!(startArg > 0)) throw new Error('--start must be a positive number')
    state = createRaceState(
      rules.map(({ rule }) => ({ id: rule.id, name: rule.name })),
      startArg,
    )
    console.log(
      `New race: $${startArg} per strategy, ${rules.length} strategies, ${state.sizing.riskPct}% risk per trade`,
    )
  }
  // A new built-in strategy joins without touching the others.
  const synced = syncRaceState(
    state,
    rules.map(({ rule }) => ({ id: rule.id, name: rule.name })),
  )
  state = synced.state
  for (const c of synced.changes) console.log(`  ${c}`)

  // Crypto/gold: 1h always (stop/target checks walk 1h candles) plus every
  // size a rule uses. Forex: one daily series. Keys are `${id}:${tf}`.
  const key = (id: string, tf: RuleTimeframe) => (isForex(id) ? id : `${id}:${tf}`)
  const jobs = new Map<string, { id: string; tf: RuleTimeframe }>()
  for (const id of new Set(rules.flatMap((r) => r.markets))) {
    jobs.set(key(id, '1h'), { id, tf: '1h' })
    for (const r of rules)
      if (r.markets.includes(id)) jobs.set(key(id, r.rule.timeframe), { id, tf: r.rule.timeframe })
  }
  const data = new Map<string, OHLCCandle[]>()
  const skipped = new Set<string>()
  for (const [n, [k, { id, tf }]] of [...jobs.entries()].entries()) {
    try {
      data.set(k, await fetchMarket(id, tf))
      process.stdout.write(`  ${n + 1}/${jobs.size} ${k} ok\n`)
    } catch (e) {
      skipped.add(id)
      process.stdout.write(`  ${n + 1}/${jobs.size} ${k} skipped (${(e as Error).message})\n`)
    }
  }

  // Latest price per market first: crosses like EUR/GBP need GBP/USD to size in dollars.
  const prices: PriceMap = {}
  for (const id of new Set(rules.flatMap((r) => r.markets))) {
    const last = data.get(key(id, '1h'))?.at(-1)
    if (last) prices[id] = last.close
  }
  state.prices = { ...state.prices, ...prices }

  const nowSec = Math.floor(Date.now() / 1000)
  let checked = 0
  let opened = 0
  let closed = 0
  for (const { rule, markets } of rules) {
    const ticks: MarketTick[] = []
    for (const id of markets) {
      const path = data.get(key(id, '1h'))
      const own = data.get(key(id, rule.timeframe))
      const inst = getInstrument(id)
      if (!path?.length || !own?.length || !inst) continue
      const tf = inst.market === 'forex' ? '1d' : rule.timeframe
      const signalCandles = inst.market === 'forex' ? own : closedOnly(own, TF_HOURS[tf], nowSec)
      const price = prices[id]
      ticks.push({
        market: id,
        signal: latestSignal({ ...rule, timeframe: tf }, signalCandles),
        path,
        price,
        usdPerQuote: usdPerQuoteFor(inst, price, prices),
        feeRate: FEE_RATE[inst.market],
        leverage: LEVERAGE[inst.market],
      })
    }
    const r = stepStrategy(state.strategies[rule.id], ticks, nowSec, state.sizing)
    state.strategies[rule.id] = r.strategy
    checked += ticks.length
    closed += r.closed.length
    opened += r.opened.length
    for (const c of r.closed)
      console.log(`  CLOSE ${rule.name} ${c.market} ${c.reason} ${money(c.pnl)}`)
    for (const t of r.opened) {
      const inst = getInstrument(t.market)
      const size = sizingOf({ inst, ...t, target: t.takeProfit })
      console.log(
        `  OPEN  ${rule.name} ${t.market} ${t.direction} at ${t.entry}: ${sizingLine(inst, size)}`,
      )
    }
    for (const p of r.passed) console.log(`  PASS  ${rule.name} ${p.market}: ${p.reason}`)
  }

  state.tickCount += 1
  state.ticks = [
    ...state.ticks,
    { at: Date.now(), checked, opened, closed, skipped: [...skipped] },
  ].slice(-MAX_TICK_LOG)
  save(state)

  console.log(
    `${new Date().toISOString()} tick #${state.tickCount}: ${checked} checks, ${opened} opened, ${closed} closed, ${skipped.size} markets skipped`,
  )
  for (const s of summarize(state)) {
    console.log(
      `  ${s.name.padEnd(28)} $${s.money.toFixed(2).padStart(9)}  ${money(s.pnl)}  open ${s.open.length}  closed ${s.closed.length}`,
    )
  }
  console.log(`Saved ${FILE} (play money only)`)
  if (args.includes('--no-push')) console.log('Not pushed (--no-push)')
  else await push(state)
}

main().catch((e) => {
  console.error(`race tick failed: ${(e as Error).message}`)
  process.exit(1)
})
