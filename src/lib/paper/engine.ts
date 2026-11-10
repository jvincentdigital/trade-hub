import {
  getInstrument,
  quoteToUsd,
  type Instrument,
  type Market,
  type PriceMap,
} from './instruments'
import type { ClosedTrade, PaperAccount, PendingOrder, Position, Side } from './schema'

// Pure demo-account engine. Every function takes an account and returns a new
// one; nothing here touches storage, the network or real money.

export const DEFAULT_BALANCE = 10_000

/**
 * Notional / margin. Crypto is spot-style (no leverage); forex uses 30:1, the
 * EU/UK retail cap; gold uses 20:1, the EU/UK retail cap for gold CFDs.
 */
export const LEVERAGE: Record<Market, number> = { crypto: 1, forex: 30, metals: 20 }

/**
 * Cost charged on each side (open and close) as a fraction of notional.
 * Crypto 0.1% is a typical exchange taker fee; forex 0.007% is roughly a
 * 0.7 pip spread on EUR/USD. Gold 0.02% is about a 40-80 cent spread per ounce
 * at $2,000-4,000, typical for retail XAU/USD. Keeps demo results from looking better than real.
 */
export const FEE_RATE: Record<Market, number> = { crypto: 0.001, forex: 0.00007, metals: 0.0002 }

const MAX_EQUITY_POINTS = 500
const EQUITY_POINT_EVERY_MS = 15 * 60_000

export type Result = { ok: true; account: PaperAccount } | { ok: false; error: string }

export interface OrderRequest {
  instrumentId: string
  side: Side
  type: 'market' | 'limit'
  units: number
  limitPrice?: number
  stopLoss?: number
  takeProfit?: number
  strategyId?: string
}

export function createAccount(startingBalance = DEFAULT_BALANCE, now = Date.now()): PaperAccount {
  return {
    version: 1,
    startingBalance,
    cash: startingBalance,
    createdAt: now,
    pendingOrders: [],
    positions: [],
    history: [],
    equity: [{ t: now, equity: startingBalance }],
  }
}

const dir = (side: Side) => (side === 'long' ? 1 : -1)

/** Gross unrealized P&L in USD (before the exit fee). */
export function positionPnl(pos: Position, price: number, quoteUsd: number): number {
  return pos.units * (price - pos.entryPrice) * dir(pos.side) * quoteUsd
}

/** Cash plus everything locked in open positions, marked to market. */
export function equityOf(account: PaperAccount, prices: PriceMap): number {
  let total = account.cash
  for (const pos of account.positions) {
    const inst = getInstrument(pos.instrumentId)
    const price = prices[pos.instrumentId]
    const q = inst ? quoteToUsd(inst.quote, prices) : null
    total += pos.margin + (price && q ? positionPnl(pos, price, q) : 0)
  }
  return total
}

/**
 * Units to trade so that hitting the stop loses `riskPct` % of equity.
 * Returns 0 when the inputs can't produce a sensible size.
 */
export function sizeByRisk(args: {
  equity: number
  riskPct: number
  entry: number
  stop: number
  quoteUsd: number
}): number {
  const { equity, riskPct, entry, stop, quoteUsd } = args
  const perUnit = Math.abs(entry - stop) * quoteUsd
  if (!(equity > 0) || !(riskPct > 0) || !(perUnit > 0)) return 0
  return (equity * riskPct) / 100 / perUnit
}

/** Long: stop below entry, target above. Short: the reverse. */
export function checkBrackets(
  side: Side,
  entry: number,
  stopLoss?: number,
  takeProfit?: number,
): string | null {
  if (side === 'long') {
    if (stopLoss !== undefined && stopLoss >= entry)
      return 'Stop loss must be below the entry for a buy'
    if (takeProfit !== undefined && takeProfit <= entry)
      return 'Take profit must be above the entry for a buy'
  } else {
    if (stopLoss !== undefined && stopLoss <= entry)
      return 'Stop loss must be above the entry for a sell'
    if (takeProfit !== undefined && takeProfit >= entry)
      return 'Take profit must be below the entry for a sell'
  }
  return null
}

function context(instrumentId: string, prices: PriceMap) {
  const inst = getInstrument(instrumentId)
  if (!inst) return { error: 'Unknown instrument' as const }
  const price = prices[instrumentId]
  if (!price || !(price > 0)) return { error: `No live price for ${inst.symbol} yet` as const }
  const q = quoteToUsd(inst.quote, prices)
  if (!q) return { error: `No ${inst.quote}/USD rate to value ${inst.symbol}` as const }
  return { inst, price, q }
}

function openPosition(
  account: PaperAccount,
  inst: Instrument,
  q: number,
  o: {
    side: Side
    units: number
    price: number
    stopLoss?: number
    takeProfit?: number
    strategyId?: string
  },
  now: number,
): Result {
  const notional = o.units * o.price * q
  const margin = notional / LEVERAGE[inst.market]
  const fee = notional * FEE_RATE[inst.market]
  if (margin + fee > account.cash + 1e-9) {
    return {
      ok: false,
      error: `Not enough demo cash: needs $${(margin + fee).toFixed(2)}, have $${account.cash.toFixed(2)}`,
    }
  }
  const pos: Position = {
    id: crypto.randomUUID(),
    instrumentId: inst.id,
    side: o.side,
    units: o.units,
    entryPrice: o.price,
    margin,
    entryFee: fee,
    stopLoss: o.stopLoss,
    takeProfit: o.takeProfit,
    openedAt: now,
    strategyId: o.strategyId,
  }
  return {
    ok: true,
    account: {
      ...account,
      cash: account.cash - margin - fee,
      positions: [...account.positions, pos],
    },
  }
}

export function placeOrder(
  account: PaperAccount,
  req: OrderRequest,
  prices: PriceMap,
  now = Date.now(),
): Result {
  if (!(req.units > 0) || !Number.isFinite(req.units))
    return { ok: false, error: 'Size must be above 0' }
  const ctx = context(req.instrumentId, prices)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const { inst, price, q } = ctx

  if (req.type === 'limit') {
    const limit = req.limitPrice
    if (!limit || !(limit > 0)) return { ok: false, error: 'Limit price is required' }
    const bracketErr = checkBrackets(req.side, limit, req.stopLoss, req.takeProfit)
    if (bracketErr) return { ok: false, error: bracketErr }
    // Already marketable: fill now at the (better or equal) live price.
    const marketable = req.side === 'long' ? price <= limit : price >= limit
    if (!marketable) {
      const order: PendingOrder = {
        id: crypto.randomUUID(),
        instrumentId: inst.id,
        side: req.side,
        units: req.units,
        limitPrice: limit,
        stopLoss: req.stopLoss,
        takeProfit: req.takeProfit,
        createdAt: now,
        strategyId: req.strategyId,
      }
      return { ok: true, account: { ...account, pendingOrders: [...account.pendingOrders, order] } }
    }
  }

  const bracketErr = checkBrackets(req.side, price, req.stopLoss, req.takeProfit)
  if (bracketErr) return { ok: false, error: bracketErr }
  return openPosition(account, inst, q, { ...req, price }, now)
}

export function cancelOrder(account: PaperAccount, orderId: string): PaperAccount {
  return { ...account, pendingOrders: account.pendingOrders.filter((o) => o.id !== orderId) }
}

export function closePosition(
  account: PaperAccount,
  positionId: string,
  prices: PriceMap,
  reason: ClosedTrade['reason'] = 'manual',
  exitPrice?: number,
  now = Date.now(),
): Result {
  const pos = account.positions.find((p) => p.id === positionId)
  if (!pos) return { ok: false, error: 'Position not found' }
  const ctx = context(pos.instrumentId, prices)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const exit = exitPrice ?? ctx.price
  const gross = positionPnl(pos, exit, ctx.q)
  const exitFee = pos.units * exit * ctx.q * FEE_RATE[ctx.inst.market]
  const trade: ClosedTrade = {
    ...pos,
    exitPrice: exit,
    closedAt: now,
    pnl: gross - pos.entryFee - exitFee,
    reason,
  }
  const next: PaperAccount = {
    ...account,
    cash: account.cash + pos.margin + gross - exitFee,
    positions: account.positions.filter((p) => p.id !== positionId),
    history: [...account.history, trade],
  }
  return { ok: true, account: addEquityPoint(next, equityOf(next, prices), now, true) }
}

export function updateBrackets(
  account: PaperAccount,
  positionId: string,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
): Result {
  const pos = account.positions.find((p) => p.id === positionId)
  if (!pos) return { ok: false, error: 'Position not found' }
  const err = checkBrackets(pos.side, pos.entryPrice, stopLoss, takeProfit)
  if (err) return { ok: false, error: err }
  return {
    ok: true,
    account: {
      ...account,
      positions: account.positions.map((p) =>
        p.id === positionId ? { ...p, stopLoss, takeProfit } : p,
      ),
    },
  }
}

function addEquityPoint(
  account: PaperAccount,
  equity: number,
  now: number,
  force = false,
): PaperAccount {
  const last = account.equity[account.equity.length - 1]
  if (!force && last && now - last.t < EQUITY_POINT_EVERY_MS) return account
  const points = [...account.equity, { t: now, equity }]
  return { ...account, equity: points.slice(-MAX_EQUITY_POINTS) }
}

export interface TickEvent {
  kind: 'filled' | 'stop' | 'target'
  instrumentId: string
  price: number
}

/**
 * Apply a fresh set of prices: fill limit orders that were crossed, close
 * positions whose stop or target was touched, and sample the equity curve.
 * Stops fill at the observed price (which may be worse than the stop, like a
 * real gap); targets fill at the target. Returns the same object when nothing changed.
 */
export function tick(
  account: PaperAccount,
  prices: PriceMap,
  now = Date.now(),
): { account: PaperAccount; events: TickEvent[] } {
  let acc = account
  const events: TickEvent[] = []

  for (const order of account.pendingOrders) {
    const price = prices[order.instrumentId]
    if (!price) continue
    const crossed = order.side === 'long' ? price <= order.limitPrice : price >= order.limitPrice
    if (!crossed) continue
    const ctx = context(order.instrumentId, prices)
    if ('error' in ctx) continue
    const fillPrice =
      order.side === 'long' ? Math.min(price, order.limitPrice) : Math.max(price, order.limitPrice)
    const opened = openPosition(
      cancelOrder(acc, order.id),
      ctx.inst,
      ctx.q,
      { ...order, price: fillPrice },
      now,
    )
    // Not enough cash at fill time: drop the order rather than retry forever.
    acc = opened.ok ? opened.account : cancelOrder(acc, order.id)
    if (opened.ok)
      events.push({ kind: 'filled', instrumentId: order.instrumentId, price: fillPrice })
  }

  for (const pos of acc.positions) {
    const price = prices[pos.instrumentId]
    if (!price) continue
    const isLong = pos.side === 'long'
    const stopHit =
      pos.stopLoss !== undefined && (isLong ? price <= pos.stopLoss : price >= pos.stopLoss)
    const targetHit =
      pos.takeProfit !== undefined && (isLong ? price >= pos.takeProfit : price <= pos.takeProfit)
    if (!stopHit && !targetHit) continue
    const reason = stopHit ? 'stop' : 'target'
    const exit = stopHit ? price : pos.takeProfit!
    const closed = closePosition(acc, pos.id, prices, reason, exit, now)
    if (closed.ok) {
      acc = closed.account
      events.push({ kind: reason, instrumentId: pos.instrumentId, price: exit })
    }
  }

  if (acc.positions.length > 0) acc = addEquityPoint(acc, equityOf(acc, prices), now)
  return { account: acc, events }
}
