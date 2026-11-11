import type { Signal } from '../rules/engine'
import { newTradeBlock, sizeRaceTrade, type RaceSizing } from './account'
import {
  bookClose,
  entryLevels,
  exitOf,
  openPnl,
  tradeRisk,
  type ClosedFundedTrade,
  type FundedState,
  type FundedTrade,
  type MarketTick,
} from './live'
import { nextPragueDayStart, pragueDate, pragueDayStart } from './session'

// The funded test (John, 2026-11-11): "instead of every account having
// $10,000, it would be a total account of $10,000". One play account fed by
// the signals of every race strategy, with the limits of FTMO's 2-Step
// challenge (the best fit in ~/jvd-outputs/2026-11-11/funded-accounts/), so
// we can see whether the strategies would pass one. The strategy accounts
// keep running as the Lab. Play money only. Pure, tested.

export const FUNDED = {
  name: 'Funded test',
  startMoney: 10_000,
  /** 2% of the balance per trade ($200 at the start), at most 2 open. */
  sizing: { riskPct: 2, maxOpen: 2, maxOpenRiskPct: 4 } satisfies RaceSizing,
  maxNewPerDay: 3,
  /** Pass: +10% ($1,000) and at least 4 trading days. */
  targetPct: 10,
  minDays: 4,
  /** Fail: the day loses 5% of the day-start balance (FTMO's day starts at midnight in Prague). */
  dailyLossPct: 5,
  /** Our own buffer: no new trades for the day once it is down 4%. */
  dayStopPct: 4,
  /** Fail: balance or money under $9,000 (10% of the start, static). */
  maxLossPct: 10,
} as const

/**
 * Markets the race prices only from a once-a-day ECB rate (USD/JPY, NZD/USD)
 * or half from one (GBP/JPY = GBP/USD x the daily USD/JPY): not live prices,
 * so the funded test never opens them.
 */
export const FUNDED_SKIP: readonly string[] = ['USD-JPY', 'NZD-USD', 'GBP-JPY']

export const signalKey = (strategy: string, market: string) => `${strategy}:${market}`

/** A signal from one race strategy, offered to the funded test in a fixed order. */
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
 * A fresh $10,000 account. `seen` marks the signals already out there as used,
 * so it only trades signals that come after it starts (no stale entries).
 */
export function createFunded(nowMs: number, seen: FundedCandidate[] = []): FundedState {
  return {
    startMoney: FUNDED.startMoney,
    startedAt: nowMs,
    balance: FUNDED.startMoney,
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
  status: FundedState['status']
  statusNote?: string
  statusAt?: number
  /** Money now and the result against the start. */
  money: number
  result: number
  /** Balance at the start of today's FTMO day and the loss since then (0 when up). */
  dayStart: number
  dayLoss: number
  /** 5% of the day start: reaching it fails the test. */
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
    status: f.status,
    statusNote: f.statusNote,
    statusAt: f.statusAt,
    money,
    result: money - f.startMoney,
    dayStart,
    dayLoss,
    dayLimit: (dayStart * FUNDED.dailyLossPct) / 100,
    dayStopped: dayLoss >= (dayStart * FUNDED.dayStopPct) / 100,
    nextDay: nextPragueDayStart(nowSec),
    maxLoss: Math.max(0, f.startMoney - Math.min(money, f.balance)),
    maxLimit: (f.startMoney * FUNDED.maxLossPct) / 100,
    target: (f.startMoney * FUNDED.targetPct) / 100,
    days: new Set(all.map((t) => pragueDate(t.entryTime))).size,
    newToday: all.filter((t) => t.entryTime >= start).length,
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
      `daily loss limit: the day lost ${usd(v.dayLoss)}, ${FUNDED.dailyLossPct}% of the ${usd(v.dayStart)} day start is ${usd(v.dayLimit)}`,
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
    const hit = m ? exitOf(t, m.path) : null
    if (!m || !hit) {
      open.push(t)
      continue
    }
    const c = bookClose(t, hit.exit, hit.time, hit.reason, m.feeRate)
    balance += c.pnl
    closed.push(c)
  }
  const acc = checkFunded({ ...f, balance, open, closed: [...f.closed, ...closed] }, prices, nowSec)

  const lastSignal = { ...f.lastSignal }
  const opened: FundedTrade[] = []
  const passed: FundedStep['passed'] = []
  for (const c of candidates) {
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
    if (FUNDED_SKIP.includes(c.market)) {
      no('priced from a once-a-day rate, not live')
      continue
    }
    const m = byMarket.get(c.market)
    const levels = m && entryLevels(c.signal, m.price, c.reanchor)
    if (!m || !levels) continue // the price already passed its stop or target, as in the Lab
    const taken = open.find((t) => t.market === c.market)
    if (taken) {
      no(`a ${c.market} trade is already open (from ${taken.strategy})`)
      continue
    }
    const v = fundedView({ ...acc, open }, prices, nowSec)
    if (v.dayStopped) {
      no(`the day is down ${FUNDED.dayStopPct}%: no new trades until the next FTMO day`)
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
      units: size.units,
      usdPerQuote: m.usdPerQuote,
      margin: size.margin,
      entryFee: size.valueUsd * m.feeRate,
      ...(c.note ? { note: c.note } : {}),
    }
    open.push(t)
    opened.push(t)
  }
  return { funded: { ...acc, open, lastSignal }, opened, closed, passed }
}
