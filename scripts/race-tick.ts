/**
 * Strategy race, live forward test: one tick.
 *
 *   npx tsx scripts/race-tick.ts            (or: make race-tick)
 *   npx tsx scripts/race-tick.ts --reset --start 1000
 *   npx tsx scripts/race-tick.ts --push-only   (send the saved state to the live site, no tick)
 *   npx tsx scripts/race-tick.ts --no-push     (tick without sending, for a test file in RACE_FILE)
 *   npx tsx scripts/race-tick.ts --funded-reset (back up race.json, start fresh $10K/$50K/$100K/$200K funded tests)
 *   make race-reset                            (back up race.json, start over, first tick, push)
 *
 * Fetches fresh candles per market (Kraken's free public OHLC for crypto,
 * gold and the forex pairs it trades well, one call per candle size in use,
 * about 1 a second, forex spike wicks capped; GBP/JPY computed from GBP/USD
 * and the ECB's USD/JPY; Frankfurter for the other forex; no keys; forex
 * candles from the weekend close are left out), asks every strategy for its
 * latest signal on closed candles (none on forex while that market is shut),
 * and opens/closes trades in that strategy's
 * own play-money account: one balance across all its markets, every trade
 * risking 2% of it (src/lib/race/account.ts). State: ~/.local/share/trade-hub/race.json
 * (override with RACE_FILE). Play money only: nothing here talks to a broker.
 *
 * Strategies: the built-in rules, London breakout (src/lib/race/londonBreakout.ts),
 * Claude's picks (opened by scripts/claude-picks.ts; a tick only checks
 * their stops and targets) and the strategy lab's top 5 (src/lib/race/labBots.ts:
 * US30 from Yahoo's public chart feed, a red-news filter from Forex Factory's
 * free weekly feed, cached next to the race file) and John's London v1
 * (src/lib/race/johnsLondonLive.ts: closed 15m candles only, for signals and
 * exits, GBP/USD exits confirmed against lone wicks) and John's Method, a quiet
 * watch-only Lab account (src/lib/race/johnsMethodLive.ts: closed 1h candles,
 * 4h built on the New York close, any hour, no 12:45 close). A lock (race.json.lock) keeps two runs from
 * writing at once: a tick that finds it taken waits up to 3 minutes, then
 * prints one line and stops.
 *
 * Close now taps from Today (stored in the relay worker) are booked first, at
 * the minute of the tap (src/lib/race/closeRequests.ts), and cleared after
 * the save. After saving, the state is PUT to the race relay worker (docs/live.md) when
 * ~/.local/share/trade-hub/race.env exists (RACE_PUT_URL + RACE_WRITE_KEY).
 * A failed push only logs a line; the tick itself still counts.
 */
import { copyFileSync } from 'node:fs'
import { BUILT_IN_RULES } from '../src/lib/rules/presets'
import { latestSignal, type Signal } from '../src/lib/rules/engine'
import { ruleInstrumentIds } from '../src/lib/rules/data'
import type { Rule, RuleTimeframe } from '../src/lib/rules/schema'
import { getInstrument, INSTRUMENTS, type PriceMap } from '../src/lib/paper/instruments'
import { sizingLine, sizingOf, usdPerQuoteFor } from '../src/lib/sizing/sizing'
import { FEE_RATE, LEVERAGE } from '../src/lib/paper/engine'
import { closedOnly, dropClosedForex, forexClosed, TF_HOURS } from '../src/lib/race/candles'
import { minStopForFullRisk } from '../src/lib/race/account'
import { BST_NOTE, londonOnSummerTime } from '../src/lib/positions/london'
import { feedOf } from '../src/lib/feeds'
import type { CandleTf } from '../src/lib/kraken'
import { LONDON_BREAKOUT, londonBreakout } from '../src/lib/race/londonBreakout'
import { CLAUDE_PICKS } from '../src/lib/race/claudePicks'
import { entryWindowBlock } from '../src/lib/race/session'
import {
  LAB_BOTS,
  labCheck,
  newsCloseDue,
  RACE_ONLY_MARKETS,
  type LabBot,
} from '../src/lib/race/labBots'
import { newsWindows, type Window } from '../src/lib/lab/news'
import {
  entriesToday,
  JOHNS_LONDON,
  johnsLondonCheck,
  sessionClock,
  type JohnsLondonMarket,
} from '../src/lib/race/johnsLondonLive'
import { nyCloseBars } from '../src/lib/lab/load'
import { JOHNS_METHOD, stepJohnsMethod, type JmMarketInput } from '../src/lib/race/johnsMethodLive'
import {
  addFundedSizes,
  checkFunded,
  FUNDED,
  FUNDED_SIGNALS_FROM,
  fundedAccounts,
  fundedView,
  sizeLabel,
  stepFunded,
  withFunded,
  type FundedCandidate,
} from '../src/lib/race/funded'
import {
  applyDailyClose,
  createRaceState,
  MAX_TICK_LOG,
  stepStrategy,
  summarize,
  syncRaceState,
  tradeRisk,
  type MarketTick,
  type RaceState,
} from '../src/lib/race/live'
import type { OHLCCandle } from '../src/lib/types/market'
import {
  clearCloseRequests,
  fetchMarket,
  fetchMinutes,
  FILE,
  load,
  loadCloseRequests,
  loadRedNews,
  money,
  push,
  save,
  sleep,
  waitLock,
} from './race-io'
import {
  bookCloseRequests,
  findOpen,
  type CloseRequests,
  type Minute,
} from '../src/lib/race/closeRequests'
import { KRAKEN_PAIRS } from '../src/lib/kraken'

const args = process.argv.slice(2)
const startArg = args.includes('--start') ? Number(args[args.indexOf('--start') + 1]) : 1000

/** What each race account trades and how it finds a signal. */
type Plan = { id: string; name: string; markets: string[] } & (
  | { kind: 'rule'; rule: Rule }
  | { kind: 'london' }
  /** Claude's picks open from scripts/claude-picks.ts; the tick only closes them. */
  | { kind: 'picks' }
  /** The strategy lab's top 5 (src/lib/race/labBots.ts, docs/strategy-lab.md). */
  | { kind: 'lab'; bot: LabBot }
  /** John's London v1 (src/lib/race/johnsLondonLive.ts, SPEC.md section 6). */
  | { kind: 'johns' }
  /** John's Method, watch only (src/lib/race/johnsMethodLive.ts); stepped after the others. */
  | { kind: 'jm' }
)

const PLANS: Plan[] = [
  ...BUILT_IN_RULES.map((rule) => ({
    kind: 'rule' as const,
    id: rule.id,
    name: rule.name,
    markets: ruleInstrumentIds(rule, INSTRUMENTS),
    rule,
  })),
  {
    kind: 'london',
    id: LONDON_BREAKOUT.id,
    name: LONDON_BREAKOUT.name,
    markets: [...LONDON_BREAKOUT.markets],
  },
  {
    kind: 'picks',
    id: CLAUDE_PICKS.id,
    name: CLAUDE_PICKS.name,
    markets: [...CLAUDE_PICKS.markets],
  },
  ...LAB_BOTS.map((bot) => ({
    kind: 'lab' as const,
    id: bot.id,
    name: bot.name,
    markets: [bot.market],
    bot,
  })),
  {
    kind: 'johns',
    id: JOHNS_LONDON.id,
    name: JOHNS_LONDON.name,
    markets: [...JOHNS_LONDON.markets],
  },
  {
    kind: 'jm',
    id: JOHNS_METHOD.id,
    name: JOHNS_METHOD.name,
    markets: [...JOHNS_METHOD.markets],
  },
]

const ecb = (id: string) => !RACE_ONLY_MARKETS[id] && feedOf(id) === 'ecb'
/** Candles stops and targets are checked on: 1h crypto and US30 (Yahoo), 15m gold and Kraken forex, daily ECB forex. */
const pathTf = (id: string): CandleTf =>
  ecb(id) ? '1d' : getInstrument(id)?.market === 'crypto' || id === 'US30' ? '1h' : '15m'
/** ECB-only forex has daily candles whatever size is asked for; US30 (Yahoo) is always 1h. */
const sizeFor = (id: string, tf: CandleTf): CandleTf => (ecb(id) ? '1d' : id === 'US30' ? '1h' : tf)
const key = (id: string, tf: CandleTf) => `${id}:${sizeFor(id, tf)}`
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const feeRate = (id: string) => FEE_RATE[getInstrument(id)?.market ?? 'forex']

async function main() {
  if (args.includes('--push-only')) {
    const saved = load()
    if (!saved) throw new Error(`no race file at ${FILE}`)
    await push(saved)
    return
  }
  // One writer at a time: the hourly job, the London 15-minute job and
  // Claude's picks share race.json. A tick that finds the lock taken waits a
  // little (a London tick must not be lost to an overlapping run), then stops.
  const release = await waitLock(3 * 60_000)
  if (!release) {
    console.log(`${new Date().toISOString()} another race run is still going; skipping this tick`)
    return
  }
  try {
    await tick()
  } finally {
    release()
  }
}

async function tick() {
  // Before any fetch: a candle counts as closed only if it closed before it was fetched.
  const nowSec = Math.floor(Date.now() / 1000)
  if (londonOnSummerTime(nowSec * 1000)) console.log(`  ${BST_NOTE}`)
  let state = args.includes('--reset') ? null : load()
  if (!state) {
    if (!(startArg > 0)) throw new Error('--start must be a positive number')
    state = createRaceState(
      PLANS.map((p) => ({ id: p.id, name: p.name })),
      startArg,
    )
    console.log(
      `New race: $${startArg} per strategy, ${PLANS.length} strategies, ${state.sizing.riskPct}% risk per trade`,
    )
  }
  // A new strategy joins with fresh money; the others and their open trades stay as they are.
  const synced = syncRaceState(
    state,
    PLANS.map((p) => ({ id: p.id, name: p.name })),
  )
  state = synced.state
  for (const c of synced.changes) console.log(`  ${c}`)

  // Every market: its path candles. Rules: their own size. London breakout: 15m and 1h.
  const jobs = new Map<string, { id: string; tf: CandleTf }>()
  const want = (id: string, tf: CandleTf) => jobs.set(key(id, tf), { id, tf: sizeFor(id, tf) })
  for (const p of PLANS)
    for (const id of p.markets) {
      want(id, pathTf(id))
      if (p.kind === 'rule') want(id, p.rule.timeframe)
      if (p.kind === 'london') {
        want(id, '15m')
        want(id, '1h')
      }
      if (p.kind === 'lab') want(id, p.bot.candles === 'kraken-ny4h' ? '1h' : p.bot.tf)
      if (p.kind === 'johns') want(id, '15m')
      if (p.kind === 'jm') want(id, '1h')
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
  for (const id of new Set(PLANS.flatMap((p) => p.markets))) {
    const last = data.get(key(id, pathTf(id)))?.at(-1)
    if (last) prices[id] = last.close
  }
  state.prices = { ...state.prices, ...prices }

  // Red news for the lab bots' filter (Forex Factory's free weekly feed, cached).
  const red = PLANS.some(
    (p) => p.kind === 'johns' || p.kind === 'jm' || (p.kind === 'lab' && p.bot.news !== 'off'),
  )
    ? await loadRedNews()
    : { events: [], note: '' }
  if (red.note) console.log(`  ${red.note}`)
  // John's London v1 trades nothing new without a news list (a failed feed with no cached copy).
  const johnsNews = red.note.includes('news filter off') ? null : red.events
  const prevTick = state.ticks.at(-1)
  const clock = sessionClock(prevTick ? Math.floor(prevTick.at / 1000) : null, nowSec)
  if (clock) console.log(`  JOHN'S LONDON v1: ${clock}`)
  /** John's London v1 extras for the market tick. */
  const johnsExtra = new Map<
    string,
    Pick<MarketTick, 'target1' | 'deadline' | 'closeNow' | 'sizeStop' | 'seen'>
  >()
  const windowsOf = (bot: LabBot): Window[] => newsWindows(red.events, bot.currencies, bot.news)
  /** Lab bot extras for the market tick: first target, deadline, close before news. */
  const labExtra = new Map<string, Pick<MarketTick, 'target1' | 'deadline' | 'closeNow'>>()

  const shut = forexClosed(nowSec)
  if (shut)
    console.log('  Forex market closed (Friday 17:00 to Sunday 17:00 New York): no forex signals')
  // New trades only from 02:00 to 12:30 AST on weekdays (src/lib/race/session.ts).
  const blockNew = entryWindowBlock(nowSec)
  if (blockNew) console.log(`  No new trades now: ${blockNew}`)
  const riskPct = state.sizing.riskPct
  const signalFor = (p: Plan, id: string): Signal | null => {
    if (p.kind === 'picks' || p.kind === 'jm') return null
    const inst = getInstrument(id)
    if (shut && inst?.market === 'forex') return null
    if (p.kind === 'lab') {
      const bot = p.bot
      const raw = data.get(key(id, bot.candles === 'kraken-ny4h' ? '1h' : bot.tf))
      if (!raw?.length || !(prices[id] > 0)) return null
      const closed =
        bot.candles === 'kraken-ny4h'
          ? closedOnly(nyCloseBars(closedOnly(raw, 1, nowSec), 4 * 3600), 4, nowSec)
          : closedOnly(raw, TF_HOURS[bot.tf], nowSec)
      const w = windowsOf(bot)
      const r = labCheck(bot, closed, nowSec, prices[id], w)
      labExtra.set(`${p.id}|${id}`, {
        ...(r.signal?.target1 != null ? { target1: r.signal.target1 } : {}),
        deadline: r.deadline,
        closeNow: newsCloseDue(bot, w, nowSec),
      })
      console.log(`  LAB ${bot.name}: ${r.note}`)
      return r.signal
    }
    if (p.kind === 'johns') {
      const raw = data.get(key(id, '15m'))
      // Read at call time: Close now taps may have changed the account this check.
      const account = state?.strategies[p.id]
      if (!raw?.length || !inst || !account) return null
      const r = johnsLondonCheck({
        market: id as JohnsLondonMarket,
        closed: closedOnly(raw, 0.25, nowSec),
        nowSec,
        price: prices[id] ?? 0,
        news: johnsNews,
        seen: account.lastSignal[id] ?? 0,
        todayEntries: entriesToday(account, id, nowSec),
        feeRate: FEE_RATE[inst.market],
      })
      johnsExtra.set(id, {
        ...(r.signal?.target1 != null ? { target1: r.signal.target1 } : {}),
        ...(r.deadline != null ? { deadline: r.deadline } : {}),
        ...(r.sizeStop != null ? { sizeStop: r.sizeStop } : {}),
        ...(r.seen != null ? { seen: r.seen } : {}),
        closeNow: r.closeNow,
      })
      console.log(`  JOHN'S LONDON v1 ${id}: ${r.note}`)
      return r.signal
    }
    if (p.kind === 'london') {
      const m15 = data.get(key(id, '15m'))
      const h1 = data.get(key(id, '1h'))
      if (!m15?.length || !h1?.length || !inst || !(prices[id] > 0)) return null
      // Levels around the price the trade would open at; the stop never so
      // close that the margin cap would cut the trade below the race's risk.
      const r = londonBreakout(m15, h1, nowSec, {
        price: prices[id],
        minDist: minStopForFullRisk(prices[id], LEVERAGE[inst.market], riskPct),
      })
      console.log(`  LONDON ${id}: ${r.note}`)
      return r.signal
    }
    const own = data.get(key(id, p.rule.timeframe))
    if (!own?.length) return null
    const tf: RuleTimeframe = ecb(id) ? '1d' : p.rule.timeframe
    // ECB days are only published once done; Kraken's last candle is still forming.
    const candles = ecb(id) ? own : closedOnly(own, TF_HOURS[tf], nowSec)
    return latestSignal({ ...p.rule, timeframe: tf }, candles)
  }

  let checked = 0
  let opened = 0
  let closed = 0

  // Close now taps from Today, booked before anything else (src/lib/race/closeRequests.ts).
  const requests = await loadCloseRequests()
  let clearIds: string[] = []
  if (Object.keys(requests).length) {
    // The last check saw candles up to its quarter hour: from there on is unchecked.
    const fromSec = Math.floor((state.ticks.at(-1)?.at ?? 0) / 1000 / 900) * 900
    const minutes = await requestMinutes(state, requests, fromSec)
    const r = bookCloseRequests(state, requests, (m) => minutes.get(m), fromSec, feeRate)
    state = r.state
    closed += r.booked.length
    for (const b of r.booked)
      console.log(
        `  CLOSE ${b.account} ${b.closed.market} ${b.closed.reason === 'manual' ? 'closed by you' : `${b.closed.reason} (touched before the tap)`} at ${b.closed.exit}: ${money(b.closed.pnl)}`,
      )
    for (const id of r.dropped) console.log(`  Close request for a trade that is not open: ${id}`)
    for (const id of r.waiting) console.log(`  Close request waits for its minute: ${id}`)
    clearIds = [...r.booked.map((b) => b.id), ...r.dropped]
  }
  // The funded test takes only John's London v1's signals (FUNDED_SIGNALS_FROM in
  // src/lib/race/funded.ts), on v1's own market ticks (closed candles, its news
  // close, the lone-wick flag). Other markets get a plain tick, for a trade it
  // opened before the switch.
  const candidates: FundedCandidate[] = []
  const marketTicks = new Map<string, MarketTick>()
  for (const p of PLANS) {
    if (p.kind === 'jm') continue
    const ticks: MarketTick[] = []
    for (const id of p.markets) {
      const path = data.get(key(id, pathTf(id)))
      const inst = getInstrument(id)
      const only = RACE_ONLY_MARKETS[id]
      if (!path?.length || (!inst && !only)) continue
      const price = prices[id]
      const signal = signalFor(p, id)
      ticks.push({
        market: id,
        signal,
        // John's London v1 checks exits on closed candles only (SPEC.md 6, step 1).
        path: p.kind === 'johns' ? closedOnly(path, 0.25, nowSec) : path,
        price,
        usdPerQuote: inst ? usdPerQuoteFor(inst, price, prices) : 1,
        feeRate: inst ? FEE_RATE[inst.market] : only.feeRate,
        leverage: inst ? LEVERAGE[inst.market] : only.leverage,
        // Built-in rules (the lab's rule bots too) keep their planned R at the fill (entryLevels in live.ts).
        reanchor: p.kind === 'rule' || (p.kind === 'lab' && p.bot.kind === 'rule'),
        ...(p.kind === 'lab' ? labExtra.get(`${p.id}|${id}`) : {}),
        ...(p.kind === 'johns'
          ? { ...johnsExtra.get(id), minRiskPct: 1, confirm: id === 'GBP-USD' }
          : {}),
      })
      const t = ticks[ticks.length - 1]
      if (p.id === FUNDED_SIGNALS_FROM) {
        marketTicks.set(id, t)
        if (t.signal)
          candidates.push({ strategy: p.id, market: id, signal: t.signal, reanchor: t.reanchor })
      } else if (p.kind !== 'lab' && !marketTicks.has(id)) marketTicks.set(id, t)
    }
    const r = stepStrategy(state.strategies[p.id], ticks, nowSec, state.sizing, blockNew)
    state.strategies[p.id] = r.strategy
    checked += ticks.length
    closed += r.closed.length
    opened += r.opened.length
    for (const c of r.closed)
      console.log(`  CLOSE ${p.name} ${c.market} ${c.reason} ${money(c.pnl)}`)
    for (const t of r.opened) {
      const inst = getInstrument(t.market)
      const size = sizingOf({ inst, ...t, target: t.takeProfit })
      const sizeWords = inst
        ? sizingLine(inst, size)
        : `${t.units.toFixed(3)} units, $${tradeRisk(t).toFixed(2)} at the stop`
      console.log(`  OPEN  ${p.name} ${t.market} ${t.direction} at ${t.entry}: ${sizeWords}`)
    }
    for (const x of r.passed) console.log(`  PASS  ${p.name} ${x.market}: ${x.reason}`)
    // A lone wick is decided when the next candle closes: log it once, on the first tick after that.
    const since = prevTick ? prevTick.at / 1000 : 0
    for (const w of r.wicks)
      if (w.next + 15 * 60 > since)
        console.log(
          `  LONE WICK ${p.name} ${w.market} ${w.level} ${w.price} on the ${new Date(w.time * 1000).toISOString().slice(0, 16)}Z candle: ignored`,
        )
  }

  // John's Method, watch only: its own step (halves, double down, 120-candle
  // limit), closed candles only, gold's weekend prints left out like forex.
  {
    const inputs: JmMarketInput[] = []
    for (const id of JOHNS_METHOD.markets) {
      const raw = data.get(key(id, '1h'))
      const path = data.get(key(id, pathTf(id)))
      const inst = getInstrument(id)
      if (!raw?.length || !path?.length || !inst) continue
      inputs.push({
        market: id,
        h1: dropClosedForex(closedOnly(raw, 1, nowSec)),
        path: dropClosedForex(closedOnly(path, 0.25, nowSec)),
        price: prices[id] ?? 0,
        usdPerQuote: usdPerQuoteFor(inst, prices[id], prices),
        feeRate: FEE_RATE[inst.market],
        leverage: LEVERAGE[inst.market],
      })
    }
    const r = stepJohnsMethod(
      state.strategies[JOHNS_METHOD.id],
      inputs,
      nowSec,
      shut ? 'the market is closed for the weekend' : null,
      red.events,
    )
    state.strategies[JOHNS_METHOD.id] = r.strategy
    checked += inputs.length
    closed += r.closed.length
    opened += r.opened.length
    for (const n of r.notes) console.log(`  JOHN'S METHOD ${n.market}: ${n.note}`)
    for (const c of r.closed)
      console.log(`  CLOSE ${JOHNS_METHOD.name} ${c.market} ${c.reason} ${money(c.pnl)}`)
    for (const t of r.opened) {
      const inst = getInstrument(t.market)
      const size = sizingOf({ inst, ...t, target: t.takeProfit })
      console.log(
        `  OPEN  ${JOHNS_METHOD.name} ${t.market} ${t.direction} at ${t.entry} (${t.note}): ${sizingLine(inst, size)}`,
      )
    }
    for (const x of r.passed) console.log(`  PASS  ${JOHNS_METHOD.name} ${x.market}: ${x.reason}`)
  }

  // The funded tests: $10K, $50K, $100K and $200K accounts, the same rules,
  // fed only by John's London v1 (src/lib/race/funded.ts).
  if (args.includes('--funded-reset') && fundedAccounts(state).length) {
    const bak = `${FILE}.bak-${stamp()}-funded`
    copyFileSync(FILE, bak)
    console.log(`  Funded tests reset (the old ones are kept in ${bak})`)
    state = withFunded(state, [])
  }
  // A size not running yet starts empty now; the running ones keep their history.
  const sizes = addFundedSizes(fundedAccounts(state), Date.now(), candidates)
  for (const a of sizes.added)
    console.log(
      `  Funded test ${sizeLabel(a.startMoney)} started with $${a.startMoney.toLocaleString('en-US')}; it trades signals that come after now`,
    )
  const lastPrices = state.prices
  const steppedFunded = sizes.accounts.map((acc) => {
    const label = `${FUNDED.name} ${sizeLabel(acc.startMoney)}`
    const f = stepFunded(acc, [...marketTicks.values()], candidates, nowSec, blockNew, lastPrices)
    closed += f.closed.length
    opened += f.opened.length
    for (const c of f.closed)
      console.log(`  CLOSE ${label} ${c.market} ${c.reason} ${money(c.pnl)}`)
    for (const t of f.opened) {
      const inst = getInstrument(t.market)
      const size = sizingOf({ inst, ...t, target: t.takeProfit })
      console.log(
        `  OPEN  ${label} ${t.market} ${t.direction} at ${t.entry} (signal from ${t.strategy}): ${sizingLine(inst, size)}`,
      )
    }
    for (const x of f.passed)
      console.log(`  PASS  ${label} ${x.market} (${x.strategy}): ${x.reason}`)
    return f.funded
  })
  state = withFunded(state, steppedFunded)

  // Daily close: the first check at or after 12:45 AST on a weekday closes every open trade.
  // John's Method holds for days (any hour): the daily close leaves it alone.
  const daily = applyDailyClose(state, nowSec, feeRate, [JOHNS_METHOD.id])
  state = daily.state
  closed += daily.closed.length
  for (const c of daily.closed)
    console.log(`  CLOSE ${c.strategy} ${c.market} at 12:45 (${c.exit}): ${money(c.pnl)}`)
  if (daily.missing.length)
    console.log(`  still open after the daily close (no price): ${daily.missing.join(', ')}`)
  const closePrices = state.prices
  state = withFunded(
    state,
    fundedAccounts(state).map((acc) => {
      const f = checkFunded(acc, closePrices, nowSec)
      if (f.status !== acc.status)
        console.log(
          `  ${FUNDED.name} ${sizeLabel(f.startMoney)} ${f.status.toUpperCase()}: ${f.statusNote}`,
        )
      return f
    }),
  )

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
      `  ${s.name.padEnd(34)} $${s.money.toFixed(2).padStart(9)}  ${money(s.pnl)}  open ${s.open.length}  closed ${s.closed.length}`,
    )
  }
  for (const acc of fundedAccounts(state)) {
    const v = fundedView(acc, state.prices, nowSec)
    console.log(
      `  ${`${FUNDED.name} ${sizeLabel(acc.startMoney)}`.padEnd(34)} $${v.money.toFixed(2).padStart(9)}  ${money(v.result)}  open ${v.openCount}  closed ${acc.closed.length}  ${v.status}, day loss $${v.dayLoss.toFixed(2)} of $${v.dayLimit.toFixed(2)}, ${v.days} of ${FUNDED.minDays} days`,
    )
  }
  console.log(`Saved ${FILE} (play money only)`)
  if (args.includes('--no-push')) console.log('Not pushed (--no-push)')
  else await push(state)
  await clearCloseRequests(clearIds)
}

/**
 * Kraken 1-minute candles for each market a close request names, from the
 * earlier of the last check and the tap. GBP/JPY: GBP/USD times the race's
 * USD/JPY leg; USD/JPY and NZD/USD have none (null: the race's own price, as
 * in race-close-all.ts). A failed fetch is undefined: the request waits.
 */
async function requestMinutes(state: RaceState, requests: CloseRequests, fromSec: number) {
  const out = new Map<string, Minute[] | null | undefined>()
  const since = Math.min(fromSec, ...Object.values(requests).map((r) => Math.floor(r.at / 1000)))
  const pairOf = (m: string) => KRAKEN_PAIRS[m === 'GBP-JPY' ? 'GBP-USD' : m]
  const byPair = new Map<string, Minute[] | undefined>()
  for (const r of Object.values(requests)) {
    const m = findOpen(state, r.id)?.trade.market
    if (!m || out.has(m)) continue
    const pair = pairOf(m)
    if (!pair) {
      out.set(m, null)
      continue
    }
    if (!byPair.has(pair)) {
      await sleep(1100) // Kraken's public limit: about one call a second
      try {
        byPair.set(pair, await fetchMinutes(pair, since))
      } catch (e) {
        console.log(`  ${pair} 1-minute candles not loaded: ${(e as Error).message}`)
        byPair.set(pair, undefined)
      }
    }
    const rows = byPair.get(pair)
    const leg = m === 'GBP-JPY' ? state.prices['GBP-JPY'] / state.prices['GBP-USD'] : 1
    out.set(
      m,
      rows?.map((x) => ({ t: x.t, o: x.o * leg, h: x.h * leg, l: x.l * leg })),
    )
  }
  return out
}

main().catch((e) => {
  console.error(`race tick failed: ${(e as Error).message}`)
  process.exit(1)
})
