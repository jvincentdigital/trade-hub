import { getInstrument } from '../paper/instruments'
import { newTradeBlock, sizeRaceTrade, type RaceSizing } from './account'
import { ownTick, roundToLot, signalKey, type FundedCandidate, type FundedTick } from './funded'
import { RACE_ONLY_MARKETS } from './labBots'
import {
  entryLevels,
  openPnl,
  tradeExits,
  tradeRisk,
  type ClosedFundedTrade,
  type CombinedRefusal,
  type CombinedState,
  type FundedTrade,
} from './live'
import { pragueDayStart } from './session'

// The combined account (owner, 2026-11-20, after race accounts bet against
// each other: one bought GBP/USD while another sold GBP/JPY). One $10,000
// play account that takes the signals of a chosen list of strategies and
// never holds two trades that bet against each other. Each trade keeps its
// own strategy's stop, targets and exits, like the funded tests. Play money
// only. Pure, tested in combined.test.ts.

/**
 * The strategies whose signals the combined account takes, in priority
 * order: when two signal in the same check, the first one here is offered
 * first. For now every strategy whose signals open trades in its own race
 * account at each check. Claude's picks (opened by its own script) and
 * John's calls (his own orders) are not in the check's signals, so they are
 * left out. THE OWNER PICKS THE FINAL LIST in the Saturday 2026-11-21
 * review: edit this one list.
 */
export const COMBINED_SIGNALS_FROM: readonly string[] = [
  // John's London v1
  'johns-london-v1',
  // The strategy lab's top 5
  'lab-rsi-us30',
  'lab-fib-eurusd-4h',
  'lab-ema1236-gold-4h',
  'lab-fib-london-us30',
  'lab-stophunt-gold-1h',
  // London breakout
  'london-breakout',
  // The built-in rules
  'mm-confluence-v2',
  'ema50-pullback',
  'rsi-range-reversal',
  'mm-stop-hunt-reversal',
  'mm-three-level-exhaustion',
  'mfx-level3-peak-reversal',
  'mfx-ema-12-36-pullback',
  'mfx-second-leg-day-extreme',
  'mfx-ema800-pin',
]

export const COMBINED = {
  /** The name in the tick log. */
  name: 'Combined',
  /** The name on the pages. */
  label: 'Combined, no contradicting trades',
  /** Its account id on the Terminal page. */
  id: 'combined',
  startMoney: 10_000,
  /** 2% of the balance per trade, at most 4 open (so at most 8% at risk). */
  sizing: { riskPct: 2, maxOpen: 4, maxOpenRiskPct: 8 } satisfies RaceSizing,
  /** At most this many open trades the same way on any one currency, the dollar too. */
  maxSameWay: 2,
  /** No new trade once the day is down this % of its opening balance (FTMO's day). */
  dayStopPct: 4,
  /** Refused signals are kept this many days. */
  refusedDays: 7,
} as const

/**
 * Markets that are close to the same bet, from the daily changes 2019 to
 * 2025 (levels check, Part 5, `~/.local/share/trade-hub/levels-results/check/check.md`):
 * a buy of `a` is the same bet as a buy of `b` when `corr` is above 0, as a
 * sell of `b` when it is below 0. Holding them the other way round is refused.
 */
export const SAME_BET: readonly { a: string; b: string; corr: number }[] = [
  { a: 'EUR-USD', b: 'GBP-USD', corr: 0.7 },
  { a: 'EUR-JPY', b: 'GBP-JPY', corr: 0.76 },
  { a: 'USD-JPY', b: 'EUR-USD', corr: -0.49 },
]

type Side = 'long' | 'short'
/** One currency of a trade: +1 held long, -1 held short. */
export interface Leg {
  currency: string
  side: 1 | -1
}

/**
 * The two currencies a market trades: EUR/USD is EUR against USD, gold is XAU
 * against USD, bitcoin BTC against USD, US30 against USD. Null for a market
 * the race does not know.
 */
export function currenciesOf(market: string): [string, string] | null {
  const inst = getInstrument(market)
  if (inst) {
    const [base, quote] = inst.symbol.split('/')
    return base && quote ? [base, quote] : null
  }
  const only = RACE_ONLY_MARKETS[market]
  if (only) return [market, only.quote]
  // A cross with no instrument here (EUR/JPY): its two currencies from the id.
  const m = /^([A-Z]{3})-([A-Z]{3})$/.exec(market)
  return m ? [m[1], m[2]] : null
}

/** A buy is long the first currency and short the second; a sell the other way. */
export function legsOf(market: string, direction: Side): [Leg, Leg] | null {
  const c = currenciesOf(market)
  if (!c) return null
  const s = direction === 'long' ? 1 : -1
  return [
    { currency: c[0], side: s },
    { currency: c[1], side: -s as 1 | -1 },
  ]
}

const sideWord = (d: Side) => (d === 'long' ? 'buy' : 'sell')
const legWord = (l: Leg) => `${l.side === 1 ? 'long' : 'short'} ${l.currency}`
const corrText = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`

type Open = Pick<FundedTrade, 'market' | 'direction' | 'strategy'>

/**
 * Why the combined account may not add `next` to its `open` trades, or null
 * when it may. In order: the same market, a "same bet" the other way round
 * (SAME_BET), any currency on the opposite side of an open trade, more than 2
 * open the same way on one currency, more than 4 open in all.
 */
export function contradiction(
  next: { market: string; direction: Side },
  open: Open[],
  groups: readonly { a: string; b: string; corr: number }[] = SAME_BET,
): string | null {
  const same = open.find((t) => t.market === next.market)
  if (same)
    return `a ${next.market} trade is already open (a ${sideWord(same.direction)} from ${same.strategy})`
  const dir = (d: Side) => (d === 'long' ? 1 : -1)
  for (const t of open) {
    const g = groups.find(
      (x) => (x.a === t.market && x.b === next.market) || (x.b === t.market && x.a === next.market),
    )
    if (g && dir(next.direction) * Math.sign(g.corr) === -dir(t.direction))
      return `the same bet as the open ${t.market} ${sideWord(t.direction)}, the other way round: ${g.a} and ${g.b} move ${g.corr > 0 ? 'together' : 'opposite'} (${corrText(g.corr)} on daily changes, 2019 to 2025)`
  }
  const legs = legsOf(next.market, next.direction)
  if (!legs) return `no currencies known for ${next.market}`
  for (const leg of legs)
    for (const t of open) {
      const theirs = legsOf(t.market, t.direction)?.find((l) => l.currency === leg.currency)
      if (theirs && theirs.side === -leg.side)
        return `${legWord(leg)} against the open ${t.market} ${sideWord(t.direction)}`
    }
  for (const leg of legs) {
    const n = open.filter((t) =>
      legsOf(t.market, t.direction)?.some(
        (l) => l.currency === leg.currency && l.side === leg.side,
      ),
    ).length
    if (n >= COMBINED.maxSameWay)
      return `${legWord(leg)} is already in ${n} open trades (at most ${COMBINED.maxSameWay} the same way on one currency)`
  }
  if (open.length >= COMBINED.sizing.maxOpen)
    return `${open.length} trades already open (at most ${COMBINED.sizing.maxOpen})`
  return null
}

/** A fresh $10,000 account. `seen` marks the signals out there now as used, so it only takes later ones. */
export function createCombined(nowMs: number, seen: FundedCandidate[] = []): CombinedState {
  return {
    startMoney: COMBINED.startMoney,
    startedAt: nowMs,
    balance: COMBINED.startMoney,
    open: [],
    closed: [],
    lastSignal: Object.fromEntries(
      seen.map((c) => [signalKey(c.strategy, c.market), c.signal.time]),
    ),
    refused: [],
  }
}

const usd = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface CombinedView {
  /** Balance plus open P&L, minus the entry fees open trades still owe. */
  money: number
  result: number
  /** Balance at the start of today's FTMO day (midnight in Prague) and the loss since then (0 when up). */
  dayStart: number
  dayLoss: number
  /** True once the day is down 4% of its opening balance: no new trades until the next FTMO day. */
  dayStopped: boolean
  openCount: number
}

export function combinedView(
  c: Pick<CombinedState, 'startMoney' | 'balance' | 'open' | 'closed'>,
  prices: Record<string, number>,
  nowSec: number,
): CombinedView {
  const start = pragueDayStart(nowSec)
  const dayStart = c.startMoney + c.closed.reduce((a, t) => a + (t.exitTime < start ? t.pnl : 0), 0)
  const money =
    c.balance + c.open.reduce((a, t) => a + openPnl(t, prices[t.market]) - t.entryFee, 0)
  const dayLoss = Math.max(0, dayStart - money)
  return {
    money,
    result: money - c.startMoney,
    dayStart,
    dayLoss,
    dayStopped: dayLoss >= (dayStart * COMBINED.dayStopPct) / 100,
    openCount: c.open.length,
  }
}

export interface CombinedStep {
  combined: CombinedState
  opened: FundedTrade[]
  closed: ClosedFundedTrade[]
  /** Signals refused at this check (also added to `combined.refused`). */
  refused: CombinedRefusal[]
}

/**
 * One check for the combined account:
 * 1. Each open trade closes if a later path candle hit its stop or target, on
 *    the tick of the strategy that opened it (its own exits, as the funded tests).
 * 2. New signals of the strategies in `feeds`, in that order, are offered once
 *    each. One opens at the price now, risking 2% of the balance with its own
 *    strategy's levels and exits, unless the entry window, the day stop, the
 *    contradiction guard, the race's market rules or the sizing says no.
 */
export function stepCombined(
  c: CombinedState,
  markets: FundedTick[],
  candidates: FundedCandidate[],
  nowSec: number,
  /** Why no new trade may open now (entryWindowBlock in ./session.ts). */
  blockNew: string | null = null,
  /** The race's last price per market, for open trades on markets not in `markets`. */
  lastPrices: Record<string, number> = {},
  feeds: readonly string[] = COMBINED_SIGNALS_FROM,
): CombinedStep {
  const prices = { ...lastPrices, ...Object.fromEntries(markets.map((m) => [m.market, m.price])) }
  let balance = c.balance
  const open: FundedTrade[] = []
  const closed: ClosedFundedTrade[] = []
  for (const t of c.open) {
    const m = ownTick(markets, t.strategy, t.market)
    if (!m) {
      open.push(t)
      continue
    }
    const r = tradeExits(t, m, nowSec)
    for (const x of r.closed) {
      balance += x.pnl
      closed.push(x)
    }
    if (r.open) open.push(r.open)
  }
  const allClosed = [...c.closed, ...closed]

  const lastSignal = { ...c.lastSignal }
  const opened: FundedTrade[] = []
  const refused: CombinedRefusal[] = []
  const offered = feeds.flatMap((s) => candidates.filter((x) => x.strategy === s))
  for (const cand of offered) {
    const k = signalKey(cand.strategy, cand.market)
    if (cand.signal.time <= (lastSignal[k] ?? 0)) continue
    lastSignal[k] = cand.signal.time
    const direction = cand.signal.direction
    const no = (reason: string) =>
      refused.push({ at: nowSec, strategy: cand.strategy, market: cand.market, direction, reason })
    if (blockNew) {
      no(blockNew)
      continue
    }
    const m = ownTick(markets, cand.strategy, cand.market)
    if (!m) continue
    const levels = entryLevels(cand.signal, m.price, cand.reanchor)
    const t1 = m.target1
    const t1Ahead = t1 == null || (direction === 'long' ? m.price < t1 : m.price > t1)
    // The price already passed its stop or a target, as in the Lab.
    if (!levels || !t1Ahead) continue
    const v = combinedView({ ...c, balance, open, closed: allClosed }, prices, nowSec)
    if (v.dayStopped) {
      no(
        `the day is down ${usd(v.dayLoss)}, ${COMBINED.dayStopPct}% of its ${usd(v.dayStart)} opening balance or more: no new trades until the next FTMO day`,
      )
      continue
    }
    const against = contradiction({ market: cand.market, direction }, open)
    if (against) {
      no(against)
      continue
    }
    // The race's market rules (Bitcoin only among crypto, no once-a-day
    // prices). With no open trades passed, only those two can answer.
    const block = newTradeBlock({ market: cand.market, direction }, [])
    if (block) {
      no(block)
      continue
    }
    if (m.usdPerQuote == null) {
      no('no USD rate for its quote currency')
      continue
    }
    const size = sizeRaceTrade({
      balance,
      open: open.map((t) => ({ margin: t.margin, riskUsd: tradeRisk(t) })),
      entry: m.price,
      stop: levels.stop,
      usdPerQuote: m.usdPerQuote,
      leverage: m.leverage,
      sizing: COMBINED.sizing,
    })
    if (!size.ok) {
      no(size.reason)
      continue
    }
    const units = roundToLot(cand.market, size.units)
    if (!(units > 0)) {
      no(`${COMBINED.sizing.riskPct}% of the balance buys less than 0.01 lot at this stop`)
      continue
    }
    const valueUsd = units * m.price * m.usdPerQuote
    const t: FundedTrade = {
      strategy: cand.strategy,
      market: cand.market,
      direction,
      signalTime: cand.signal.time,
      entryTime: nowSec,
      entryBucket: m.path[m.path.length - 1]?.time ?? nowSec,
      entry: m.price,
      stop: levels.stop,
      takeProfit: levels.takeProfit,
      units,
      usdPerQuote: m.usdPerQuote,
      margin: valueUsd / m.leverage,
      entryFee: valueUsd * m.feeRate,
      ...(cand.note ? { note: cand.note } : {}),
      // Its own strategy's exits, from that strategy's market tick.
      ...(m.target1 != null ? { target1: m.target1, part1: 0.5 } : {}),
      ...(m.confirm ? { confirm: true } : {}),
    }
    open.push(t)
    opened.push(t)
  }
  const keepFrom = nowSec - COMBINED.refusedDays * 86_400
  return {
    combined: {
      ...c,
      balance,
      open,
      closed: allClosed,
      lastSignal,
      refused: [...c.refused, ...refused].filter((r) => r.at >= keepFrom),
    },
    opened,
    closed,
    refused,
  }
}

/** "REFUSED Combined: GBP-JPY sell from london-breakout: short GBP against the open GBP-USD buy". */
export const refusalLine = (r: CombinedRefusal) =>
  `REFUSED ${COMBINED.name}: ${r.market} ${sideWord(r.direction)} from ${r.strategy}: ${r.reason}`
