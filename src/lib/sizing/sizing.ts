import { quoteToUsd, type Instrument, type PriceMap } from '../paper/instruments'

// Trade size the way a trader reads it: units and lots, $ per pip (forex) or
// per $1 move (gold), dollars at the stop and at the target, and R:R.
// Pure, tested. Shared by the Today cards, /race and /demo.

/** 1 standard forex lot = 100,000 units of the base currency (0.01 lot = 1,000). */
export const FOREX_LOT = 100_000
/** 1 gold lot = 100 troy ounces (0.01 lot = 1 oz). */
export const GOLD_LOT_OZ = 100

/** Forex pip: 0.01 on JPY pairs, 0.0001 on the rest. Null for crypto and gold. */
export function pipSize(inst: Instrument | undefined): number | null {
  if (inst?.market !== 'forex') return null
  return inst.quote === 'JPY' ? 0.01 : 0.0001
}

/**
 * USD value of one unit of the quote currency. USD/xxx pairs use their own
 * price (USD/JPY at 158 makes 1 yen worth 1/158 dollars); crosses like EUR/GBP
 * need the quote's USD pair in `prices`. Null when that rate is missing.
 */
export function usdPerQuoteFor(
  inst: Instrument | undefined,
  price: number,
  prices: PriceMap = {},
): number | null {
  if (!inst) return null
  if (inst.quote === 'USD') return 1
  if (inst.symbol.startsWith('USD/')) return price > 0 ? 1 / price : null
  return quoteToUsd(inst.quote, prices)
}

export interface Sizing {
  /** Coins, ounces or forex units of the base currency. */
  units: number
  /** Forex: units / 100,000. Gold: ounces / 100. Crypto: null (coins are the size). */
  lots: number | null
  /** USD the trade gains or loses per pip (forex) or per $1 move (gold). Null for crypto. */
  perMoveUsd: number | null
  perMove: 'pip' | '$1' | null
  /** Forex: pips from entry to the stop. */
  stopPips: number | null
  /** Position value in USD at entry. */
  valueUsd: number | null
  /** Dollars lost at the stop and won at the target, from entry, before fees. */
  riskUsd: number | null
  goalUsd: number | null
  /** Target distance / stop distance (2 means 1:2). */
  rr: number | null
}

export function sizingOf(args: {
  inst: Instrument | undefined
  units: number
  entry: number
  stop?: number
  target?: number
  usdPerQuote: number | null
}): Sizing {
  const { inst, units, entry, stop, target, usdPerQuote: q } = args
  const pip = pipSize(inst)
  const stopDist = stop != null ? Math.abs(entry - stop) : null
  const targetDist = target != null ? Math.abs(target - entry) : null
  const usd = (move: number | null) => (move == null || q == null ? null : units * move * q)
  const market = inst?.market
  return {
    units,
    lots: market === 'forex' ? units / FOREX_LOT : market === 'metals' ? units / GOLD_LOT_OZ : null,
    perMoveUsd: pip != null ? usd(pip) : market === 'metals' ? usd(1) : null,
    perMove: pip != null ? 'pip' : market === 'metals' ? '$1' : null,
    stopPips: pip != null && stopDist != null ? stopDist / pip : null,
    valueUsd: usd(entry),
    riskUsd: usd(stopDist),
    goalUsd: usd(targetDist),
    rr: stopDist && targetDist != null ? targetDist / stopDist : null,
  }
}

// ── Display ──────────────────────────────────────────────────────────────

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 3 significant digits under 100 (0.00153, 12.3), whole numbers with commas above. */
export const qty = (n: number) =>
  n >= 100 ? Math.round(n).toLocaleString('en-US') : String(+n.toPrecision(3))

/** 0.0219, 0.000304, 0.50, 1.25 */
export const fmtLots = (n: number) => (n >= 0.1 ? n.toFixed(2) : n.toPrecision(3))

/** $0.219 per pip, $2.19, $21.86: cents above $10, 3 significant digits below. */
export const perMoney = (n: number) => (n >= 10 ? money(n) : `$${n.toPrecision(3)}`)

/** "0.0219 lots (2,186 units)", "0.0016 lots (0.163 oz)", "0.00153 BTC". */
export function sizeText(inst: Instrument | undefined, s: Sizing): string {
  if (!(s.units > 0)) return '-'
  if (inst?.market === 'forex') return `${fmtLots(s.lots!)} lots (${qty(s.units)} units)`
  if (inst?.market === 'metals') return `${fmtLots(s.lots!)} lots (${qty(s.units)} oz)`
  return `${qty(s.units)} ${inst?.symbol.split('/')[0] ?? 'units'}`
}

/** "$0.219 per pip" or "$0.16 per $1 move"; null for crypto. */
export function perMoveText(s: Sizing): string | null {
  if (s.perMoveUsd == null) return null
  return s.perMove === 'pip'
    ? `${perMoney(s.perMoveUsd)} per pip`
    : `${perMoney(s.perMoveUsd)} per $1 move`
}

export const rrText = (rr: number | null) => (rr == null ? null : `R:R 1:${+rr.toFixed(2)}`)

/** One line for lists: size, $ per pip, risk, goal, R:R. */
export function sizingLine(inst: Instrument | undefined, s: Sizing): string {
  return [
    sizeText(inst, s),
    perMoveText(s),
    s.riskUsd != null ? `risk ${money(s.riskUsd)}` : 'no stop',
    s.goalUsd != null ? `goal ${money(s.goalUsd)}` : null,
    rrText(s.rr),
  ]
    .filter(Boolean)
    .join(' · ')
}
