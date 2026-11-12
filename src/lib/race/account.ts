import { z } from 'zod'
import { COIN_MAP } from '../coingecko'
import { getInstrument } from '../paper/instruments'

// How the race sizes a new trade, like one real account per strategy (John,
// 2026-11-10, the course's rule): every trade risks 2% of the current balance,
// at most 5 trades open, total open risk at most 10% of the balance, and the
// position value at most the free balance x the market's leverage (balance
// minus the margin open trades already use). Shared by the live race and the
// past-results backtest. Pure, tested.

export const sizingSchema = z.object({
  riskPct: z.number().positive(),
  maxOpen: z.number().int().positive(),
  maxOpenRiskPct: z.number().positive(),
})
export type RaceSizing = z.infer<typeof sizingSchema>

export const RACE_SIZING: RaceSizing = { riskPct: 2, maxOpen: 5, maxOpenRiskPct: 10 }

/** What an open trade ties up: margin (value / leverage) and dollars at its stop. */
export interface Exposure {
  margin: number
  riskUsd: number
}

export type SizeResult =
  | { ok: true; units: number; valueUsd: number; margin: number; riskUsd: number; capped: boolean }
  | { ok: false; reason: string }

export function sizeRaceTrade(args: {
  /** Closed-trade cash: start money plus every closed trade's net P&L. */
  balance: number
  open: Exposure[]
  entry: number
  stop: number
  /** USD per unit of the quote currency (1 for USD-quoted markets). */
  usdPerQuote: number
  leverage: number
  sizing?: RaceSizing
}): SizeResult {
  const { balance, open, entry, stop, usdPerQuote: q, leverage } = args
  const s = args.sizing ?? RACE_SIZING
  if (open.length >= s.maxOpen) return { ok: false, reason: `${s.maxOpen} trades already open` }
  const perUnit = Math.abs(entry - stop) * q
  if (!(balance > 0) || !(entry > 0) || !(q > 0) || !(perUnit > 0))
    return { ok: false, reason: 'nothing to size' }
  const want = (balance * s.riskPct) / 100 / perUnit
  const freeMargin = balance - open.reduce((a, t) => a + t.margin, 0)
  const maxUnits = (Math.max(0, freeMargin) * leverage) / (entry * q)
  const units = Math.min(want, maxUnits)
  if (!(units > 0)) return { ok: false, reason: 'no free margin' }
  const riskUsd = units * perUnit
  const openRisk = open.reduce((a, t) => a + t.riskUsd, 0)
  // Relative tolerance so five 2% trades on the same balance make exactly 10%.
  if (openRisk + riskUsd > ((balance * s.maxOpenRiskPct) / 100) * (1 + 1e-9))
    return { ok: false, reason: `open risk would pass ${s.maxOpenRiskPct}%` }
  const valueUsd = units * entry * q
  return { ok: true, units, valueUsd, margin: valueUsd / leverage, riskUsd, capped: units < want }
}

/**
 * Smallest stop distance (in price) at which a trade risking `riskPct` of the
 * balance still fits the margin cap with nothing else open: the position value
 * is risk x entry / distance, and it may be at most balance x leverage. A
 * closer stop gets cut down below `riskPct` (GBP/USD at 1.334, 2%, 30:1: 8.9
 * pips; gold at $4,000, 20:1: $4.00).
 */
export const minStopForFullRisk = (entry: number, leverage: number, riskPct: number) =>
  (entry * riskPct) / 100 / leverage

// ── Which new trades an account may open (John, 2026-11-11) ──────────────
// Checked by stepStrategy (./live.ts) before sizing, so every strategy (the
// built-in rules, London breakout, Claude's picks) passes through them. Only
// new trades: open ones keep running and close as before.

/** Crypto the race may open new trades on. Add a COIN_MAP id to allow another coin. */
export const ALLOWED_CRYPTO: readonly string[] = ['bitcoin']

/**
 * One pound/dollar bet per account. These markets move together, so they
 * count as one bet: the sign of a long (+1 = pound up or dollar down), a
 * short is the negative. Never opposite sides, at most 2 the same way.
 */
export const POUND_DOLLAR: Record<string, 1 | -1> = {
  'GBP-USD': 1, // pound up, dollar down
  'GBP-JPY': 1, // pound up
  'EUR-GBP': -1, // pound down
  'pax-gold': 1, // gold up, dollar down
}
export const MAX_POUND_DOLLAR = 2
/**
 * GBP/JPY here is GBP/USD x a frozen daily USD/JPY (src/lib/feeds.ts): never both
 * open. New GBP/JPY trades are off (NOT_LIVE); this still keeps a new GBP/USD out
 * of an account that holds an older GBP/JPY trade.
 */
const COPY_OF: Record<string, string> = { 'GBP-JPY': 'GBP-USD', 'GBP-USD': 'GBP-JPY' }

/**
 * At most 2 bets the same way on the dollar per account (John, 2026-11-11):
 * the sign of a long (+1 = dollar down), a short is the negative. Opposite
 * dollar bets are allowed. GBP/JPY counts: here it moves with GBP/USD (see COPY_OF).
 */
export const DOLLAR: Record<string, 1 | -1> = {
  'EUR-USD': 1,
  'GBP-USD': 1,
  'GBP-JPY': 1,
  'AUD-USD': 1,
  'NZD-USD': 1,
  'pax-gold': 1,
  'USD-JPY': -1,
  'USD-CHF': -1,
  'USD-CAD': -1,
}
export const MAX_DOLLAR = 2

type Side = { market: string; direction: 'long' | 'short' }
const signOf = (map: Record<string, 1 | -1>, t: Side) =>
  map[t.market] && map[t.market] * (t.direction === 'long' ? 1 : -1)
const poundDollarSign = (t: Side) => signOf(POUND_DOLLAR, t)
const dollarSign = (t: Side) => signOf(DOLLAR, t)

/**
 * Markets the race prices only from a once-a-day ECB rate (USD/JPY, NZD/USD)
 * or half from one (GBP/JPY = GBP/USD x the daily USD/JPY, src/lib/feeds.ts):
 * not live prices, so no account opens new trades on them (John, 2026-11-11:
 * "until a live price exists"). Trades already open run to their stop or
 * target as before.
 */
export const NOT_LIVE: readonly string[] = ['USD-JPY', 'NZD-USD', 'GBP-JPY']

/** Why this account may not open `next` now, or null when it may. */
export function newTradeBlock(next: Side, open: Side[]): string | null {
  if (getInstrument(next.market)?.market === 'crypto' && !ALLOWED_CRYPTO.includes(next.market))
    return `no new crypto trades except ${ALLOWED_CRYPTO.map((id) => COIN_MAP[id]?.name ?? id).join(', ')}`
  if (NOT_LIVE.includes(next.market))
    return `no new trades on ${next.market}: priced from a once-a-day rate, not live`
  const sign = poundDollarSign(next)
  if (sign) {
    const group = open.filter((t) => POUND_DOLLAR[t.market])
    const against = group.find((t) => poundDollarSign(t) === -sign)
    if (against)
      return `against the open ${against.market} ${against.direction} (one pound/dollar bet per account)`
    const copy = group.find((t) => t.market === COPY_OF[next.market])
    if (copy)
      return `${next.market} is a copy of the open ${copy.market} trade (one pound/dollar bet per account)`
    if (group.length >= MAX_POUND_DOLLAR)
      return `${MAX_POUND_DOLLAR} pound/dollar trades already open the same way`
  }
  const usd = dollarSign(next)
  if (usd && open.filter((t) => dollarSign(t) === usd).length >= MAX_DOLLAR)
    return `${MAX_DOLLAR} trades already bet the dollar ${usd === 1 ? 'falls' : 'rises'}`
  return null
}
