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

// The funded test (John, 2026-11-11): "instead of every account having
// $10,000, it would be a total account of $10,000". One play account with the
// limits of FTMO's 2-Step challenge (the best fit in
// ~/jvd-outputs/2026-11-11/funded-accounts/), so we can see whether a
// strategy would pass one. Since the evening of 2026-11-11 it takes the
// signals of ONE strategy only, John's London v1 (FUNDED_SIGNALS_FROM): it
// passed its clean-year test. Every strategy, v1 too, keeps its own Lab
// account. Play money only. Pure, tested.

/**
 * The only race strategy whose signals the funded test takes (John,
 * 2026-11-11 evening): John's London v1. A signal from any other strategy is
 * ignored here; it still trades in that strategy's own Lab account. Its
 * trades keep v1's own exits (half at TP1, the forced close, the news close,
 * the lone-wick rule on GBP/USD), taken from v1's market tick.
 */
export const FUNDED_SIGNALS_FROM: string = JOHNS_LONDON.id

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

/** The account in a Close now id: "funded" for the $10K (its id since 2026-11-11), "funded-50k" for the others. */
export const fundedAccountId = (startMoney: number) =>
  startMoney === FUNDED.startMoney ? 'funded' : `funded-${startMoney / 1000}k`

type FundedParts = Pick<RaceState, 'funded' | 'fundedSizes'>

/** Every funded account in the state, smallest first. */
export const fundedAccounts = (state: FundedParts | null | undefined): FundedState[] =>
  [state?.funded, ...(state?.fundedSizes ?? [])]
    .filter((f): f is FundedState => !!f)
    .sort((a, b) => a.startMoney - b.startMoney)

/** The funded account of one size, if it has started. */
export const fundedOf = (state: FundedParts | null | undefined, startMoney: number) =>
  fundedAccounts(state).find((f) => f.startMoney === startMoney)

/** The accounts written back: the $10K into `funded`, the rest into `fundedSizes`. */
export function withFunded<S extends FundedParts>(state: S, accounts: FundedState[]): S {
  const small = accounts.find((f) => f.startMoney === FUNDED.startMoney)
  const rest = accounts
    .filter((f) => f.startMoney !== FUNDED.startMoney)
    .sort((a, b) => a.startMoney - b.startMoney)
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

/** A signal from one race strategy, offered to the funded test (only FUNDED_SIGNALS_FROM's are taken). */
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
 * One check for the funded test:
 * 1. Each open trade closes if a later path candle of its market hit its stop
 *    or target (as in the Lab); then the challenge is checked.
 * 2. Every candidate signal newer than the last one used from that strategy
 *    and market is offered in the given order. The first that passes every
 *    rule opens at the price now, risking 2% of the balance.
 */
export function stepFunded(
  f: FundedState,
  markets: MarketTick[],
  candidates: FundedCandidate[],
  nowSec: number,
  /** Why no new trade may open now (entryWindowBlock in ./session.ts). */
  blockNew: string | null = null,
  /** The race's last price per market, for open trades on markets not in `markets`. */
  lastPrices: Record<string, number> = {},
): FundedStep {
  const byMarket = new Map(markets.map((m) => [m.market, m]))
  const prices = { ...lastPrices, ...Object.fromEntries(markets.map((m) => [m.market, m.price])) }
  let balance = f.balance
  const open: FundedTrade[] = []
  const closed: ClosedFundedTrade[] = []
  for (const t of f.open) {
    const m = byMarket.get(t.market)
    if (!m) {
      open.push(t)
      continue
    }
    // The same exits as the Lab accounts (tradeExits in ./live.ts). The tick is
    // v1's, so its news close only applies to v1's own trades.
    const r = tradeExits(
      t,
      t.strategy === FUNDED_SIGNALS_FROM ? m : { ...m, closeNow: false },
      nowSec,
    )
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
  for (const c of candidates) {
    if (c.strategy !== FUNDED_SIGNALS_FROM) continue // other strategies trade only in the Lab
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
    const m = byMarket.get(c.market)
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
      // v1's own exits, from its market tick (as stepStrategy does).
      ...(m.target1 != null ? { target1: m.target1, part1: 0.5 } : {}),
      ...(m.deadline != null ? { deadline: m.deadline } : {}),
      ...(m.confirm ? { confirm: true } : {}),
    }
    open.push(t)
    opened.push(t)
  }
  return { funded: { ...acc, open, lastSignal }, opened, closed, passed }
}
