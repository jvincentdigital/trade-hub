import { getInstrument } from '../paper/instruments'
import { FEE_RATE, LEVERAGE } from '../paper/engine'
import { KRAKEN_PAIRS } from '../kraken'
import { usdPerQuoteFor } from '../sizing/sizing'
import { NOT_LIVE } from './account'
import { forexClosed } from './candles'
import { roundToLot } from './funded'
import { JOHNS_CALLS, type Call, type CallOrder } from './callSchema'
import type { TradeChecks } from './checklist'
import type { Minute } from './closeRequests'
import {
  bookClose,
  tradeRisk,
  type ClosedLiveTrade,
  type LiveTrade,
  type RaceState,
  type RaceStrategy,
} from './live'

// John's calls (John, 2026-11-12): trades John calls by chat, recorded by
// Claude on the Mac (scripts/race-call.ts) and tracked live like a strategy's
// in their own $10,000 Lab account. A call is a ladder of limit orders with
// one shared stop and one or more targets. The race tick fills them on
// Kraken's 1-minute candles after the call (never before it), charges the
// same fees and manages the stop and targets like other trades. Not for his
// calls: the 02:00 to 12:30 AST entry window and the 12:45 daily close (they
// are his own trades). Play money only. Pure, tested.

export { JOHNS_CALLS }

export const CALL_DEFAULTS = { riskPct: 2, expiresHours: 72 } as const
/** One call may risk at most this, and all open and waiting calls together too (the race's open-risk cap). */
export const MAX_CALL_RISK_PCT = 10

/** The account, added with $10,000 when the race does not have it yet (the first tick after the merge). */
export function withJohnsCalls(state: RaceState): { state: RaceState; added: boolean } {
  if (state.strategies[JOHNS_CALLS.id]) return { state, added: false }
  const account: RaceStrategy = {
    ruleId: JOHNS_CALLS.id,
    name: JOHNS_CALLS.name,
    balance: JOHNS_CALLS.startMoney,
    open: [],
    lastSignal: {},
    closed: [],
  }
  return {
    state: { ...state, strategies: { ...state.strategies, [JOHNS_CALLS.id]: account } },
    added: true,
  }
}

/** A call with orders still waiting or a trade still open. */
export const callLive = (c: Call, open: LiveTrade[]) =>
  c.orders.some((o) => o.status === 'pending') || open.some((t) => t.call?.id === c.id)

// ── Making a call ────────────────────────────────────────────────────────

/** What John said, as typed (make race-call MARKET=... SIDE=...). */
export interface CallInput {
  market?: string
  side?: string
  entries?: string
  stop?: string
  targets?: string
  risk?: string
  split?: string
  note?: string
  expires?: string
}

const numbers = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number)
const positive = (n: number) => Number.isFinite(n) && n > 0

/** % per target: "half at first, rest at last" unless given (SPLIT=50,25,25). */
function splitOf(raw: string | undefined, targets: number): number[] | string {
  if (!raw?.trim() || raw.trim() === 'half') {
    if (targets === 1) return [100]
    return Array.from({ length: targets }, (_, i) => (i === 0 || i === targets - 1 ? 50 : 0))
  }
  const s = numbers(raw)
  if (s.length !== targets) return `SPLIT needs one % per target (${targets}), like 50,50`
  if (s.some((x) => !Number.isFinite(x) || x < 0)) return 'SPLIT: every share must be 0 or more'
  if (Math.abs(s.reduce((a, x) => a + x, 0) - 100) > 0.01) return 'SPLIT must add up to 100'
  return s
}

/** Units closed at each target: every share but the last rounded down to the lot step, the last takes the rest. */
export function legsOf(market: string, units: number, split: number[]): number[] {
  const legs = split.slice(0, -1).map((p) => roundToLot(market, (units * p) / 100))
  return [...legs, units - legs.reduce((a, x) => a + x, 0)]
}

/** Dollars at the stop and margin of what is open or waiting in John's calls, for the caps. */
function committed(state: RaceState) {
  const account = state.strategies[JOHNS_CALLS.id]
  const q = (market: string, price: number) =>
    usdPerQuoteFor(getInstrument(market), price, state.prices) ?? 1
  const lev = (market: string) => LEVERAGE[getInstrument(market)?.market ?? 'crypto']
  let risk = 0
  let margin = 0
  for (const t of account?.open ?? []) {
    risk += tradeRisk(t)
    margin += t.margin
  }
  for (const c of state.calls ?? [])
    for (const o of c.orders)
      if (o.status === 'pending') {
        risk += o.units * Math.abs(o.entry - c.stop) * q(c.market, o.entry)
        margin += (o.units * o.entry * q(c.market, o.entry)) / lev(c.market)
      }
  return { risk, margin }
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Checks a call and sizes its orders. Every entry gets an equal share of the
 * risk (2% over 3 entries: about 0.67% each, if the stop is hit), rounded
 * DOWN to the market's lot step, so the call never risks more than RISK %
 * even if every entry fills. Errors are listed all at once.
 */
export function planCall(
  input: CallInput,
  state: RaceState,
  nowSec: number,
): { ok: true; call: Call } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const market = (input.market ?? '').trim()
  const inst = getInstrument(market)
  const price = state.prices[market]
  if (!inst)
    errors.push(
      `MARKET: ${market || '(none)'} is not a market here (like pax-gold, bitcoin, GBP-USD)`,
    )
  else if (NOT_LIVE.includes(market))
    errors.push(
      `MARKET: no new trades on ${market}, the race prices it from a once-a-day rate, not live`,
    )
  else if (!KRAKEN_PAIRS[market] || !(price > 0))
    errors.push(`MARKET: the race has no live price for ${market}`)

  const side = (input.side ?? '').trim().toLowerCase()
  if (side !== 'long' && side !== 'short') errors.push('SIDE must be long or short')
  const long = side === 'long'

  const entries = numbers(input.entries)
  const stop = Number(input.stop)
  const targets = numbers(input.targets)
  if (!entries.length || !entries.every(positive))
    errors.push('ENTRIES: give one or more limit prices, like 3905,3895,3885')
  if (!positive(stop)) errors.push('STOP: give one stop price, like 3855')
  if (!targets.length || !targets.every(positive))
    errors.push('TARGETS: give one or more target prices, like 4134,4200')
  const ready = errors.length === 0
  if (ready) {
    const hi = Math.max(...entries)
    const lo = Math.min(...entries)
    if (long ? stop >= lo : stop <= hi)
      errors.push(`STOP must be ${long ? 'below' : 'above'} every entry for a ${side}`)
    if (long ? targets.some((x) => x <= hi) : targets.some((x) => x >= lo))
      errors.push(`TARGETS must all be ${long ? 'above' : 'below'} every entry for a ${side}`)
    if (targets.some((x, i) => i > 0 && (long ? x <= targets[i - 1] : x >= targets[i - 1])))
      errors.push('TARGETS go nearest first')
  }

  const riskPct = input.risk?.trim() ? Number(input.risk) : CALL_DEFAULTS.riskPct
  if (!positive(riskPct) || riskPct > MAX_CALL_RISK_PCT)
    errors.push(`RISK is a % of the balance, more than 0 and at most ${MAX_CALL_RISK_PCT}`)
  const hours = input.expires?.trim() ? Number(input.expires) : CALL_DEFAULTS.expiresHours
  if (!positive(hours)) errors.push('EXPIRES is in hours, more than 0')
  const split = splitOf(input.split, Math.max(1, targets.length))
  if (typeof split === 'string') errors.push(split)
  const note = (input.note ?? '').trim()
  if (note.length > 500) errors.push('NOTE: 500 characters at most')
  if (errors.length || typeof split === 'string' || !inst) return { ok: false, errors }

  // Sizes: an equal share of the risk per entry, rounded down to the lot step.
  const q = usdPerQuoteFor(inst, price, state.prices)
  if (q == null) return { ok: false, errors: ['MARKET: no USD rate for its quote currency'] }
  const balance = state.strategies[JOHNS_CALLS.id]?.balance ?? JOHNS_CALLS.startMoney
  const each = (balance * riskPct) / 100 / entries.length
  const orders: CallOrder[] = []
  for (const entry of entries) {
    const units = roundToLot(market, each / (Math.abs(entry - stop) * q))
    if (!(units > 0)) {
      errors.push(
        `entry ${entry}: ${+(riskPct / entries.length).toFixed(2)}% of the balance buys less than 0.01 lot at this stop`,
      )
      continue
    }
    orders.push({ entry, units, legs: legsOf(market, units, split), status: 'pending' })
  }
  if (errors.length) return { ok: false, errors }

  // The account's caps, as if every entry fills: open risk and margin.
  const risk = orders.reduce((a, o) => a + o.units * Math.abs(o.entry - stop) * q, 0)
  const value = orders.reduce((a, o) => a + o.units * o.entry * q, 0)
  const now = committed(state)
  const riskCap = (balance * MAX_CALL_RISK_PCT) / 100
  if (now.risk + risk > riskCap * (1 + 1e-9))
    errors.push(
      `open risk would pass ${MAX_CALL_RISK_PCT}% of the balance: ${usd(now.risk)} already open or waiting, this call adds ${usd(risk)}`,
    )
  const margin = value / LEVERAGE[inst.market]
  if (now.margin + margin > balance)
    errors.push(
      `not enough free margin if every entry fills: it needs ${usd(margin)}, ${usd(Math.max(0, balance - now.margin))} is free`,
    )
  if (errors.length) return { ok: false, errors }

  const id = String(1 + Math.max(0, ...(state.calls ?? []).map((c) => Number(c.id) || 0)))
  return {
    ok: true,
    call: {
      id,
      market,
      direction: long ? 'long' : 'short',
      stop,
      targets,
      split,
      riskPct,
      note,
      madeAt: nowSec,
      expiresAt: nowSec + Math.round(hours * 3600),
      // The minute the call was made in started before it: the next full one is the first that counts.
      checkedTo: Math.ceil(nowSec / 60) * 60,
      orders,
    },
  }
}

/** Cancel a call's waiting orders (race-call-cancel). Trades it already filled keep running. */
export function cancelCall(
  calls: Call[],
  id: string,
  nowSec: number,
): { ok: true; calls: Call[]; cancelled: number } | { ok: false; error: string } {
  const c = calls.find((x) => x.id === id)
  if (!c) return { ok: false, error: `no call #${id}` }
  const waiting = c.orders.filter((o) => o.status === 'pending').length
  if (!waiting) return { ok: false, error: `call #${id} has no orders waiting` }
  const orders = c.orders.map(
    (o): CallOrder =>
      o.status === 'pending'
        ? { ...o, status: 'cancelled', at: nowSec, why: 'cancelled by you' }
        : o,
  )
  return {
    ok: true,
    calls: calls.map((x) => (x === c ? { ...c, orders } : x)),
    cancelled: waiting,
  }
}

// ── The race tick ────────────────────────────────────────────────────────

export interface CallStepInput {
  account: RaceStrategy
  calls: Call[]
  /** Kraken 1-minute candles per market, oldest first; undefined when not loaded (the call waits). */
  minutes: (market: string) => Minute[] | undefined
  /** Only minutes that closed by now count. */
  nowSec: number
  /** USD per unit of the quote currency now; null when that rate is missing. */
  usdPerQuote: (market: string) => number | null
  /** The checklist for a new fill (info only); a failure leaves it off. */
  checks?: (t: LiveTrade) => TradeChecks
}

export interface CallStep {
  account: RaceStrategy
  calls: Call[]
  filled: LiveTrade[]
  closed: ClosedLiveTrade[]
  cancelled: { call: string; entry: number; why: string }[]
  /** Anything worth a log line (minutes not loaded, a gap in the feed). */
  notes: string[]
}

const feeOf = (market: string) => FEE_RATE[getInstrument(market)?.market ?? 'forex']
const leverageOf = (market: string) => LEVERAGE[getInstrument(market)?.market ?? 'crypto']

/**
 * One race check for John's calls. For each call with orders waiting or
 * trades open, every 1-minute candle since its last look that has closed, in
 * order:
 * 1. At or after EXPIRES: orders still waiting are cancelled.
 * 2. A minute that opens past the stop: waiting orders are cancelled (the stop
 *    came first) and open trades close at that open.
 * 3. A waiting order fills when the minute reaches its price: at the price,
 *    or at the open when the open is already past it (a buy limit above the
 *    price fills at the next minute's open). The entry fee is charged.
 * 4. The stop: every open trade of the call closes there, ones filled this
 *    minute too (the price went through their entry to get there), and
 *    orders still waiting are cancelled.
 * 5. Targets, nearest first, only for trades filled before this minute (the
 *    stop wins a minute that reaches both): each closes its share.
 * Forex minutes while the real market is shut are skipped, as in the race.
 */
export function stepCalls(input: CallStepInput): CallStep {
  const { nowSec } = input
  let balance = input.account.balance
  let open = [...input.account.open]
  const closed: ClosedLiveTrade[] = []
  const filled: LiveTrade[] = []
  const cancelled: CallStep['cancelled'] = []
  const notes: string[] = []
  const used = new Set([...open, ...input.account.closed].map((t) => `${t.market}|${t.entryTime}`))

  /** Close `units` of an open trade; a target's share keeps the rest open with the targets after it. */
  const close = (
    t: LiveTrade,
    units: number,
    exit: number,
    time: number,
    reason: 'stop' | 'target',
  ) => {
    const all = units >= t.units * (1 - 1e-9)
    const share = all ? 1 : units / t.units
    const piece = all ? t : { ...t, units, margin: t.margin * share, entryFee: t.entryFee * share }
    const c = bookClose(piece, exit, time, reason, feeOf(t.market))
    closed.push(all || !t.call ? c : { ...c, part1Of: units / t.call.size })
    balance += c.pnl
    const rest: LiveTrade | null =
      all || !t.call
        ? null
        : {
            ...t,
            units: t.units - units,
            margin: t.margin - piece.margin,
            entryFee: t.entryFee - piece.entryFee,
            call: { ...t.call, legs: t.call.legs.slice(1) },
          }
    open = open.flatMap((x) => (x === t ? (rest ? [rest] : []) : [x]))
    return rest
  }

  const calls = input.calls.map((c0): Call => {
    if (!callLive(c0, open)) return c0
    const rows = input.minutes(c0.market)
    if (!rows) {
      notes.push(`#${c0.id} ${c0.market}: no 1-minute candles this check, it waits for the next`)
      return c0
    }
    const c: Call = { ...c0, orders: c0.orders.map((o) => ({ ...o })) }
    const long = c.direction === 'long'
    const forex = getInstrument(c.market)?.market === 'forex'
    const pastStop = (p: number) => (long ? p <= c.stop : p >= c.stop)
    /** The minute reached `level` coming down (a long's entries and stop) or going up. */
    const reached = (r: Minute, level: number, down: boolean) =>
      down ? r.l <= level : r.h >= level
    const mine = () => open.filter((t) => t.call?.id === c.id)
    const cancel = (why: string, at: number) => {
      for (const o of c.orders)
        if (o.status === 'pending') {
          o.status = 'cancelled'
          o.at = at
          o.why = why
          cancelled.push({ call: c.id, entry: o.entry, why })
        }
    }
    const todo = rows.filter((r) => r.t >= c.checkedTo && r.t + 60 <= nowSec)
    if (todo.length && todo[0].t - c.checkedTo > 15 * 60)
      notes.push(
        `#${c.id} ${c.market}: no 1-minute candles from ${new Date(c.checkedTo * 1000).toISOString().slice(0, 16)}Z to ${new Date(todo[0].t * 1000).toISOString().slice(0, 16)}Z (Kraken keeps 12 hours)`,
      )
    for (const r of todo) {
      if (forex && forexClosed(r.t)) continue
      if (r.t >= c.expiresAt) cancel('expired before it filled', r.t)
      if (pastStop(r.o)) {
        cancel('the stop was hit before it filled', r.t)
        for (const t of mine()) close(t, t.units, r.o, r.t, 'stop')
        continue
      }
      for (const o of c.orders) {
        if (o.status !== 'pending' || !reached(r, o.entry, long)) continue
        const q = input.usdPerQuote(c.market)
        if (q == null) {
          notes.push(
            `#${c.id} ${c.market} ${o.entry}: no USD rate for its quote currency, it waits`,
          )
          continue
        }
        const fill = long ? Math.min(o.entry, r.o) : Math.max(o.entry, r.o)
        // A trade's id is market + entry time: two fills in one minute get one second apart.
        let entryTime = r.t
        while (used.has(`${c.market}|${entryTime}`)) entryTime++
        used.add(`${c.market}|${entryTime}`)
        const legs = c.targets
          .map((price, i) => ({ price, units: o.legs[i] ?? 0 }))
          .filter((l) => l.units > 0)
        const value = o.units * fill * q
        let t: LiveTrade = {
          market: c.market,
          direction: c.direction,
          signalTime: c.madeAt,
          entryTime,
          entryBucket: r.t,
          entry: fill,
          stop: c.stop,
          takeProfit: legs[legs.length - 1].price,
          units: o.units,
          usdPerQuote: q,
          margin: value / leverageOf(c.market),
          entryFee: value * feeOf(c.market),
          ...(c.note ? { note: c.note } : {}),
          call: { id: c.id, size: o.units, legs },
        }
        try {
          if (input.checks) t = { ...t, checks: input.checks(t) }
        } catch {
          // info only: a trade without its checklist still counts
        }
        o.status = 'filled'
        o.at = r.t
        o.fill = fill
        open.push(t)
        filled.push(t)
      }
      if (reached(r, c.stop, long)) {
        for (const t of mine()) close(t, t.units, c.stop, r.t, 'stop')
        cancel('the stop was hit before it filled', r.t)
        continue
      }
      for (const t0 of mine()) {
        if (t0.entryBucket >= r.t) continue
        let t: LiveTrade | null = t0
        while (t?.call?.legs.length) {
          const leg: { price: number; units: number } = t.call.legs[0]
          if (!reached(r, leg.price, !long)) break
          t = close(t, t.call.legs.length === 1 ? t.units : leg.units, leg.price, r.t, 'target')
        }
      }
    }
    if (todo.length) c.checkedTo = todo[todo.length - 1].t + 60
    return c
  })

  return {
    account: { ...input.account, balance, open, closed: [...input.account.closed, ...closed] },
    calls,
    filled,
    closed,
    cancelled,
    notes,
  }
}
