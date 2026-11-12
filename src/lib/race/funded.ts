import type { Signal } from '../rules/engine'
import { getInstrument } from '../paper/instruments'
import { FOREX_LOT, GOLD_LOT_OZ } from '../sizing/sizing'
import { newTradeBlock, sizeRaceTrade, type RaceSizing } from './account'
import {
  entryLevels,
  openPnl,
  tradeExits,
  tradeRisk,
  type ClosedFundedTrade,
  type FundedState,
  type FundedTrade,
  type MarketTick,
  type RaceState,
} from './live'
import { nextPragueDayStart, pragueDate, pragueDayStart } from './session'
import { JOHNS_LONDON } from './johnsLondonLive'
import { LONDON_BREAKOUT } from './londonBreakout'

// The funded test (John, 2026-11-11): "instead of every account having
// $10,000, it would be a total account of $10,000". One play account with the
// limits of FTMO's 2-Step challenge (the best fit in
// ~/jvd-outputs/2026-11-11/funded-accounts/), so we can see whether a
// strategy would pass one. Since the evening of 2026-11-11 it takes the
// signals of ONE strategy only, John's London v1 (FUNDED_SIGNALS_FROM): it
// passed its clean-year test. Since 2026-11-12 a second test, "v1 + breakouts"
// (FUNDED_B_SIGNALS_FROM), runs next to it with the same rules and sizes, fed
// by v1 and the London breakout, so the two can be compared. Every strategy,
// v1 too, keeps its own Lab account. Play money only. Pure, tested.

/**
 * The only race strategy whose signals the funded test takes (John,
 * 2026-11-11 evening): John's London v1. A signal from any other strategy is
 * ignored here; it still trades in that strategy's own Lab account. Its
 * trades keep v1's own exits (half at TP1, the forced close, the news close,
 * the lone-wick rule on GBP/USD), taken from v1's market tick.
 */
export const FUNDED_SIGNALS_FROM: string = JOHNS_LONDON.id

/**
 * The second funded test, "v1 + breakouts" (John, 2026-11-12): the same
 * rules and sizes, fed by John's London v1 AND the London breakout, in this
 * order. On a check where both signal, v1's is offered first, so on a market
 * both trade (GBP/USD, gold) v1's trade wins and the breakout's is passed.
 * Each trade keeps the exits of the strategy whose signal opened it.
 */
export const FUNDED_B_SIGNALS_FROM: readonly string[] = [JOHNS_LONDON.id, LONDON_BREAKOUT.id]

/** The two funded tests, compared side by side on Today and /compare. */
export type FundedTestId = 'v1' | 'breakouts'
export const FUNDED_TESTS: readonly {
  id: FundedTestId
  label: string
  feeds: readonly string[]
}[] = [
  { id: 'v1', label: 'v1 only', feeds: [FUNDED_SIGNALS_FROM] },
  { id: 'breakouts', label: 'v1 + breakouts', feeds: FUNDED_B_SIGNALS_FROM },
]
export const fundedTest = (id: FundedTestId) => FUNDED_TESTS.find((t) => t.id === id)!
/** Every strategy some funded test takes signals from. */
export const FUNDED_FEEDS: readonly string[] = [...new Set(FUNDED_TESTS.flatMap((t) => t.feeds))]

export const FUNDED = {
  name: 'Funded test',
  startMoney: 10_000,
  /** 2% of the balance per trade ($200 at the start), at most 2 open. */
  sizing: { riskPct: 2, maxOpen: 2, maxOpenRiskPct: 4 } satisfies RaceSizing,
  maxNewPerDay: 3,
  /** Pass: +10% ($1,000) and at least 4 trading days. */
  targetPct: 10,
  minDays: 4,
  /**
   * Fail: the day loses 5% of the START money ($500), counted from the balance
   * at the start of FTMO's day (midnight in Prague). FTMO's rule exactly.
   */
  dailyLossPct: 5,
  /** Our own buffer: no new trades for the day once it is down 4% of the start ($400). */
  dayStopPct: 4,
  /**
   * Our second buffer: a new trade opens only if the day's worst case stays at
   * or under 4.75% of the start ($475: the $500 limit minus 5% for slippage).
   * Worst case = the day's realized loss + every open trade hitting its stop
   * + this one hitting its stop, all fees included (dayWorstCase).
   */
  worstCasePct: 4.75,
  /** Fail: balance or money under $9,000 (10% of the start, static). */
  maxLossPct: 10,
} as const

// ── Four sizes (John, 2026-11-12) ────────────────────────────────────────
// "In FTMO there's different amounts you can buy: 10,000, 50,000, 100,000,
// 200,000. Test those strategies with those amounts, the same parameters."
// Every size is its own account with the rules above; every dollar limit is
// the same share of its start money, and the same v1 signal opens in all of
// them at the same moment, each risking 2% of its own balance. The $10,000
// is `funded` in race.json (its history since 2026-11-11), the others
// `fundedSizes`.

export const FUNDED_SIZES = [10_000, 50_000, 100_000, 200_000] as const

/** "$10K", "$200K". */
export const sizeLabel = (startMoney: number) => `$${startMoney / 1000}K`

/** "Funded test $10K" (v1 only), "Funded test v1 + breakouts $10K": the name in logs. */
export const fundedLabel = (startMoney: number, test: FundedTestId = 'v1') =>
  `${FUNDED.name}${test === 'v1' ? '' : ` ${fundedTest(test).label}`} ${sizeLabel(startMoney)}`

/**
 * The account in a Close now id. v1 only: "funded" for the $10K (its id since
 * 2026-11-11), "funded-50k" for the others. v1 + breakouts: "funded-b-10k" and so on.
 */
export const fundedAccountId = (startMoney: number, test: FundedTestId = 'v1') =>
  test === 'breakouts'
    ? `funded-b-${startMoney / 1000}k`
    : startMoney === FUNDED.startMoney
      ? 'funded'
      : `funded-${startMoney / 1000}k`

type FundedParts = Pick<RaceState, 'funded' | 'fundedSizes' | 'fundedB'>

/** Every account of one funded test in the state (v1 only unless said), smallest first. */
export const fundedAccounts = (
  state: FundedParts | null | undefined,
  test: FundedTestId = 'v1',
): FundedState[] =>
  (test === 'breakouts' ? (state?.fundedB ?? []) : [state?.funded, ...(state?.fundedSizes ?? [])])
    .filter((f): f is FundedState => !!f)
    .sort((a, b) => a.startMoney - b.startMoney)

/** The funded account of one size and test, if it has started. */
export const fundedOf = (
  state: FundedParts | null | undefined,
  startMoney: number,
  test: FundedTestId = 'v1',
) => fundedAccounts(state, test).find((f) => f.startMoney === startMoney)

/**
 * The accounts of one test written back. v1 only: the $10K into `funded`, the
 * rest into `fundedSizes`. v1 + breakouts: all four into `fundedB`.
 */
export function withFunded<S extends FundedParts>(
  state: S,
  accounts: FundedState[],
  test: FundedTestId = 'v1',
): S {
  const sorted = [...accounts].sort((a, b) => a.startMoney - b.startMoney)
  if (test === 'breakouts') return { ...state, fundedB: sorted.length ? sorted : undefined }
  const small = sorted.find((f) => f.startMoney === FUNDED.startMoney)
  const rest = sorted.filter((f) => f.startMoney !== FUNDED.startMoney)
  return { ...state, funded: small, fundedSizes: rest.length ? rest : undefined }
}

/**
 * Starts every size not running yet, empty (the ones already running keep
 * their history). A new size copies the used-signals list of a running one,
 * so from this check on it takes exactly the signals that one takes; with
 * none running, the signals out there now count as used (createFunded).
 */
export function addFundedSizes(
  accounts: FundedState[],
  nowMs: number,
  seen: FundedCandidate[] = [],
): { accounts: FundedState[]; added: FundedState[] } {
  const base = accounts[0]
  const added = FUNDED_SIZES.filter((s) => !accounts.some((f) => f.startMoney === s)).map(
    (s): FundedState => {
      const f = createFunded(nowMs, seen, s)
      return base ? { ...f, lastSignal: { ...base.lastSignal } } : f
    },
  )
  return {
    accounts: [...accounts, ...added].sort((a, b) => a.startMoney - b.startMoney),
    added,
  }
}

/**
 * The smallest size a broker takes, 0.01 lot: 1,000 units of forex, 1 oz of
 * gold. Null for markets with no lots here (crypto, US30): exact sizes.
 */
export function lotStep(market: string): number | null {
  const kind = getInstrument(market)?.market
  return kind === 'forex' ? FOREX_LOT / 100 : kind === 'metals' ? GOLD_LOT_OZ / 100 : null
}

/** Units rounded DOWN to the market's lot step, so a trade never risks more than 2%. */
export function roundToLot(market: string, units: number): number {
  const step = lotStep(market)
  return step ? Math.floor(units / step + 1e-9) * step : units
}

export const signalKey = (strategy: string, market: string) => `${strategy}:${market}`

/** A signal from one race strategy, offered to the funded test (only its feeds' are taken). */
export interface FundedCandidate {
  /** The race strategy id. */
  strategy: string
  market: string
  signal: Signal
  note?: string
  /** Built-in rules keep their planned R at the fill (entryLevels). */
  reanchor?: boolean
}

/**
 * A fresh account ($10,000 unless another size is given). `seen` marks the
 * signals already out there as used, so it only trades signals that come
 * after it starts (no stale entries).
 */
export function createFunded(
  nowMs: number,
  seen: FundedCandidate[] = [],
  startMoney: number = FUNDED.startMoney,
): FundedState {
  return {
    startMoney,
    startedAt: nowMs,
    balance: startMoney,
    open: [],
    closed: [],
    lastSignal: Object.fromEntries(
      seen.map((c) => [signalKey(c.strategy, c.market), c.signal.time]),
    ),
    status: 'active',
  }
}

/** Balance plus open P&L at `prices`, minus the entry fees open trades still owe. */
export const fundedMoney = (f: FundedState, prices: Record<string, number>) =>
  f.balance + f.open.reduce((a, t) => a + openPnl(t, prices[t.market]) - t.entryFee, 0)

const usd = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface FundedView {
  /** The account's size: every limit below is a share of it. */
  startMoney: number
  status: FundedState['status']
  statusNote?: string
  statusAt?: number
  /** Money now and the result against the start. */
  money: number
  result: number
  /** Balance at the start of today's FTMO day and the loss since then (0 when up). */
  dayStart: number
  dayLoss: number
  /** 5% of the start money ($500): losing that since the day start fails the test. */
  dayLimit: number
  /** True once the day is down 4%: no new trades until the next FTMO day. */
  dayStopped: boolean
  /** Unix seconds of the next FTMO day (midnight in Prague). */
  nextDay: number
  /** Below the start (the lower of balance and money), against the $1,000 limit. */
  maxLoss: number
  maxLimit: number
  /** +$1,000. */
  target: number
  /** FTMO days on which a trade opened. */
  days: number
  newToday: number
  openCount: number
}

export function fundedView(
  f: FundedState,
  prices: Record<string, number>,
  nowSec: number,
): FundedView {
  const start = pragueDayStart(nowSec)
  const all = [...f.open, ...f.closed]
  const dayStart = f.startMoney + f.closed.reduce((a, t) => a + (t.exitTime < start ? t.pnl : 0), 0)
  const money = fundedMoney(f, prices)
  const dayLoss = Math.max(0, dayStart - money)
  return {
    startMoney: f.startMoney,
    status: f.status,
    statusNote: f.statusNote,
    statusAt: f.statusAt,
    money,
    result: money - f.startMoney,
    dayStart,
    dayLoss,
    dayLimit: (f.startMoney * FUNDED.dailyLossPct) / 100,
    dayStopped: dayLoss >= (f.startMoney * FUNDED.dayStopPct) / 100,
    nextDay: nextPragueDayStart(nowSec),
    maxLoss: Math.max(0, f.startMoney - Math.min(money, f.balance)),
    maxLimit: (f.startMoney * FUNDED.maxLossPct) / 100,
    target: (f.startMoney * FUNDED.targetPct) / 100,
    days: new Set(all.map((t) => pragueDate(t.entryTime))).size,
    // A trade closed in two halves is two rows with one entry: it counts once.
    newToday: new Set(
      all.filter((t) => t.entryTime >= start).map((t) => `${t.market}|${t.entryTime}`),
    ).size,
    openCount: f.open.length,
  }
}

/** Fail or pass the challenge. Once failed or passed it stays that way. */
export function checkFunded(
  f: FundedState,
  prices: Record<string, number>,
  nowSec: number,
): FundedState {
  if (f.status !== 'active') return f
  const v = fundedView(f, prices, nowSec)
  const end = (status: 'passed' | 'failed', statusNote: string): FundedState => ({
    ...f,
    status,
    statusNote,
    statusAt: nowSec,
  })
  if (v.dayLoss >= v.dayLimit)
    return end(
      'failed',
      `daily loss limit: the day lost ${usd(v.dayLoss)} from its ${usd(v.dayStart)} start, the limit is ${usd(v.dayLimit)} (${FUNDED.dailyLossPct}% of ${usd(f.startMoney)})`,
    )
  const floor = f.startMoney - v.maxLimit
  if (v.money < floor || f.balance < floor)
    return end(
      'failed',
      `max loss: money fell under ${usd(floor)} (${FUNDED.maxLossPct}% below the start)`,
    )
  const goal = f.startMoney + v.target
  if (f.balance >= goal && v.money >= goal && v.days >= FUNDED.minDays)
    return end('passed', `+${usd(v.target)} target reached in ${v.days} trading days`)
  return f
}

/** Dollars a trade loses if it hits its stop, both fees included (the exit fee at the stop price). */
export const lossAtStop = (t: FundedTrade) =>
  tradeRisk(t) + t.entryFee + (t.entryFee * t.stop) / t.entry

/**
 * The day's worst case if every open trade hits its stop: the loss already
 * realized since the FTMO day began (0 when the day is up), plus each open
 * trade's loss at its stop with both fees.
 */
export function dayWorstCase(f: FundedState, nowSec: number): number {
  const start = pragueDayStart(nowSec)
  const dayStart = f.startMoney + f.closed.reduce((a, t) => a + (t.exitTime < start ? t.pnl : 0), 0)
  return Math.max(0, dayStart - f.balance) + f.open.reduce((a, t) => a + lossAtStop(t), 0)
}

export interface FundedStep {
  funded: FundedState
  opened: FundedTrade[]
  closed: ClosedFundedTrade[]
  /** Signals it did not take, with the reason. */
  passed: { strategy: string; market: string; reason: string }[]
}

/**
 * A market tick for the funded tests. `strategy` names the race strategy it
 * came from: its exits, news close and first target belong to that
 * strategy's trades. Untagged, it is a plain tick that counts as every
 * strategy's own (the tests use those).
 */
export type FundedTick = MarketTick & { strategy?: string }

/** Price and path only: another strategy's news close, first target, deadline and lone-wick flag left out. */
const plainTick = (m: FundedTick): FundedTick => ({
  ...m,
  closeNow: false,
  target1: undefined,
  deadline: undefined,
  confirm: undefined,
})

/**
 * One check for a funded test:
 * 1. Each open trade closes if a later path candle of its market hit its stop
 *    or target (as in the Lab), on the tick of the strategy that opened it;
 *    then the challenge is checked.
 * 2. The signals of each strategy in `feeds`, in that order, newer than the
 *    last one used from that strategy and market, are offered. The first that
 *    passes every rule opens at the price now, risking 2% of the balance, with
 *    its own strategy's exits. Signals from other strategies are ignored.
 */
export function stepFunded(
  f: FundedState,
  markets: FundedTick[],
  candidates: FundedCandidate[],
  nowSec: number,
  /** Why no new trade may open now (entryWindowBlock in ./session.ts). */
  blockNew: string | null = null,
  /** The race's last price per market, for open trades on markets not in `markets`. */
  lastPrices: Record<string, number> = {},
  /** The strategies whose signals it takes, in order (FUNDED_TESTS). */
  feeds: readonly string[] = [FUNDED_SIGNALS_FROM],
): FundedStep {
  const prices = { ...lastPrices, ...Object.fromEntries(markets.map((m) => [m.market, m.price])) }
  /** The strategy's own tick for the market, else another strategy's as a plain one. */
  const tickOf = (strategy: string, market: string): FundedTick | undefined => {
    const here = markets.filter((m) => m.market === market)
    const own = here.find((m) => m.strategy === strategy) ?? here.find((m) => m.strategy == null)
    return own ?? (here[0] && plainTick(here[0]))
  }
  let balance = f.balance
  const open: FundedTrade[] = []
  const closed: ClosedFundedTrade[] = []
  for (const t of f.open) {
    const m = tickOf(t.strategy, t.market)
    if (!m) {
      open.push(t)
      continue
    }
    // The same exits as the Lab accounts (tradeExits in ./live.ts).
    const r = tradeExits(t, m, nowSec)
    for (const c of r.closed) {
      balance += c.pnl
      closed.push(c)
    }
    if (r.open) open.push(r.open)
  }
  const acc = checkFunded({ ...f, balance, open, closed: [...f.closed, ...closed] }, prices, nowSec)

  const lastSignal = { ...f.lastSignal }
  const opened: FundedTrade[] = []
  const passed: FundedStep['passed'] = []
  // Feed order first (v1 before the breakout), then the order given.
  const offered = feeds.flatMap((s) => candidates.filter((c) => c.strategy === s))
  for (const c of offered) {
    const k = signalKey(c.strategy, c.market)
    if (c.signal.time <= (lastSignal[k] ?? 0)) continue
    lastSignal[k] = c.signal.time
    const no = (reason: string) => passed.push({ strategy: c.strategy, market: c.market, reason })
    if (acc.status !== 'active') {
      no(`the funded test is ${acc.status}`)
      continue
    }
    if (blockNew) {
      no(blockNew)
      continue
    }
    const m = tickOf(c.strategy, c.market)
    if (!m) continue
    const levels = entryLevels(c.signal, m.price, c.reanchor)
    const t1 = m.target1
    const t1Ahead = t1 == null || (c.signal.direction === 'long' ? m.price < t1 : m.price > t1)
    // The price already passed its stop or a target, as in the Lab.
    if (!levels || !t1Ahead) continue
    const taken = open.find((t) => t.market === c.market)
    if (taken) {
      no(`a ${c.market} trade is already open (from ${taken.strategy})`)
      continue
    }
    const v = fundedView({ ...acc, open }, prices, nowSec)
    if (v.dayStopped) {
      no(
        `the day is down ${usd(v.dayLoss)}, ${FUNDED.dayStopPct}% of the start or more: no new trades until the next FTMO day`,
      )
      continue
    }
    if (v.newToday >= FUNDED.maxNewPerDay) {
      no(`${FUNDED.maxNewPerDay} new trades today already`)
      continue
    }
    const block = newTradeBlock({ market: c.market, direction: c.signal.direction }, open)
    if (block) {
      no(block)
      continue
    }
    if (m.usdPerQuote == null) {
      no('no USD rate for its quote currency')
      continue
    }
    const size = sizeRaceTrade({
      balance: acc.balance,
      open: open.map((t) => ({ margin: t.margin, riskUsd: tradeRisk(t) })),
      entry: m.price,
      stop: levels.stop,
      usdPerQuote: m.usdPerQuote,
      leverage: m.leverage,
      sizing: FUNDED.sizing,
    })
    if (!size.ok) {
      no(size.reason)
      continue
    }
    // Down to whole 0.01 lots, as a broker fills it: a small account rounds off more.
    const units = roundToLot(c.market, size.units)
    if (!(units > 0)) {
      no(`${FUNDED.sizing.riskPct}% of the balance buys less than 0.01 lot at this stop`)
      continue
    }
    const valueUsd = units * m.price * m.usdPerQuote
    const riskUsd = units * Math.abs(m.price - levels.stop) * m.usdPerQuote
    // Worst case with this trade too: never past 4.75% of the start ($475 on $10K, the 5% day limit with a margin).
    const fee = valueUsd * m.feeRate
    const worst =
      dayWorstCase({ ...acc, open }, nowSec) + riskUsd + fee + (fee * levels.stop) / m.price
    const cap = (acc.startMoney * FUNDED.worstCasePct) / 100
    if (worst > cap) {
      no(
        `worst case today would be -${usd(worst)} if every open trade and this one hit their stops, over the ${usd(cap)} cap (the ${usd((acc.startMoney * FUNDED.dailyLossPct) / 100)} day limit with a margin)`,
      )
      continue
    }
    const t: FundedTrade = {
      strategy: c.strategy,
      market: c.market,
      direction: c.signal.direction,
      signalTime: c.signal.time,
      entryTime: nowSec,
      entryBucket: m.path[m.path.length - 1]?.time ?? nowSec,
      entry: m.price,
      stop: levels.stop,
      takeProfit: levels.takeProfit,
      units,
      usdPerQuote: m.usdPerQuote,
      margin: valueUsd / m.leverage,
      entryFee: fee,
      ...(c.note ? { note: c.note } : {}),
      // Its own strategy's exits, from that strategy's market tick (as stepStrategy does).
      ...(m.target1 != null ? { target1: m.target1, part1: 0.5 } : {}),
      ...(m.deadline != null ? { deadline: m.deadline } : {}),
      ...(m.confirm ? { confirm: true } : {}),
    }
    open.push(t)
    opened.push(t)
  }
  return { funded: { ...acc, open, lastSignal }, opened, closed, passed }
}
