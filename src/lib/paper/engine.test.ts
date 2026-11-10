import { describe, expect, it } from 'vitest'
import {
  cancelOrder,
  checkBrackets,
  closePosition,
  createAccount,
  equityOf,
  placeOrder,
  sizeByRisk,
  tick,
  FEE_RATE,
} from './engine'
import { quoteToUsd } from './instruments'
import { computeStats, maxDrawdown } from './stats'
import { paperAccountSchema } from './schema'

const T0 = 1_700_000_000_000
const prices = { bitcoin: 50_000, 'EUR-USD': 1.1, 'USD-JPY': 150, 'GBP-USD': 1.25 }

describe('quoteToUsd', () => {
  it('converts quote currencies through the live pairs', () => {
    expect(quoteToUsd('USD', prices)).toBe(1)
    expect(quoteToUsd('GBP', prices)).toBe(1.25)
    expect(quoteToUsd('JPY', prices)).toBeCloseTo(1 / 150)
    expect(quoteToUsd('CHF', prices)).toBeNull()
  })
})

describe('sizeByRisk', () => {
  it('sizes so the stop loses exactly riskPct of equity', () => {
    // 1% of 10k = $100 risk; $1,000 stop distance → 0.1 BTC
    expect(
      sizeByRisk({ equity: 10_000, riskPct: 1, entry: 50_000, stop: 49_000, quoteUsd: 1 }),
    ).toBeCloseTo(0.1)
    // USD/JPY: 0.5 JPY stop = 0.5/150 USD per unit → 100 / (0.5/150) = 30,000 units
    expect(
      sizeByRisk({ equity: 10_000, riskPct: 1, entry: 150, stop: 149.5, quoteUsd: 1 / 150 }),
    ).toBeCloseTo(30_000)
  })
  it('returns 0 for a zero stop distance', () => {
    expect(sizeByRisk({ equity: 10_000, riskPct: 1, entry: 100, stop: 100, quoteUsd: 1 })).toBe(0)
  })
})

describe('checkBrackets', () => {
  it('rejects stops on the wrong side', () => {
    expect(checkBrackets('long', 100, 101)).toMatch(/below/)
    expect(checkBrackets('short', 100, 99)).toMatch(/above/)
    expect(checkBrackets('long', 100, 95, 110)).toBeNull()
  })
})

describe('market orders', () => {
  it('opens a crypto long, charges the fee and locks the notional', () => {
    const acc = createAccount(10_000, T0)
    const r = placeOrder(
      acc,
      { instrumentId: 'bitcoin', side: 'long', type: 'market', units: 0.1 },
      prices,
      T0,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const fee = 5_000 * FEE_RATE.crypto
    expect(r.account.cash).toBeCloseTo(10_000 - 5_000 - fee)
    expect(r.account.positions).toHaveLength(1)
    // Equity marks to market: +$1,000 move on 0.1 BTC = +$100
    expect(equityOf(r.account, { ...prices, bitcoin: 51_000 })).toBeCloseTo(10_000 - fee + 100)
  })

  it('refuses orders larger than the demo cash', () => {
    const acc = createAccount(1_000, T0)
    const r = placeOrder(
      acc,
      { instrumentId: 'bitcoin', side: 'long', type: 'market', units: 1 },
      prices,
      T0,
    )
    expect(r.ok).toBe(false)
  })

  it('uses 30:1 margin for forex and values JPY P&L in USD', () => {
    const acc = createAccount(10_000, T0)
    const r = placeOrder(
      acc,
      { instrumentId: 'USD-JPY', side: 'short', type: 'market', units: 30_000 },
      prices,
      T0,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Notional = 30,000 USD → margin $1,000
    expect(r.account.positions[0].margin).toBeCloseTo(1_000)
    const closed = closePosition(
      r.account,
      r.account.positions[0].id,
      { ...prices, 'USD-JPY': 149 },
      'manual',
      undefined,
      T0 + 1,
    )
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    const t = closed.account.history[0]
    // 30,000 units × 1 JPY = 30,000 JPY ≈ $201.34 at 149, minus two small fees
    expect(t.pnl).toBeGreaterThan(195)
    expect(t.pnl).toBeLessThan(202)
    expect(closed.account.positions).toHaveLength(0)
  })

  it('round trip with no price move costs exactly the two fees', () => {
    const acc = createAccount(10_000, T0)
    const r = placeOrder(
      acc,
      { instrumentId: 'bitcoin', side: 'short', type: 'market', units: 0.1 },
      prices,
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    const c = closePosition(r.account, r.account.positions[0].id, prices, 'manual', undefined, T0)
    if (!c.ok) throw new Error(c.error)
    expect(c.account.cash).toBeCloseTo(10_000 - 2 * 5_000 * FEE_RATE.crypto)
    expect(c.account.history[0].pnl).toBeCloseTo(-10)
  })
})

describe('limit orders and tick', () => {
  it('rests a buy limit below the market and fills when crossed', () => {
    const acc = createAccount(10_000, T0)
    const r = placeOrder(
      acc,
      {
        instrumentId: 'bitcoin',
        side: 'long',
        type: 'limit',
        units: 0.1,
        limitPrice: 48_000,
        stopLoss: 47_000,
      },
      prices,
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.account.pendingOrders).toHaveLength(1)
    expect(tick(r.account, prices, T0).account.positions).toHaveLength(0)
    const filled = tick(r.account, { ...prices, bitcoin: 47_900 }, T0 + 1)
    expect(filled.account.pendingOrders).toHaveLength(0)
    expect(filled.account.positions[0].entryPrice).toBe(47_900)
    expect(filled.events[0].kind).toBe('filled')
  })

  it('can cancel a resting order', () => {
    const acc = createAccount(10_000, T0)
    const r = placeOrder(
      acc,
      { instrumentId: 'bitcoin', side: 'short', type: 'limit', units: 0.1, limitPrice: 55_000 },
      prices,
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    expect(cancelOrder(r.account, r.account.pendingOrders[0].id).pendingOrders).toHaveLength(0)
  })

  it('closes on stop at the observed (gapped) price and on target at the target', () => {
    const acc = createAccount(10_000, T0)
    const a = placeOrder(
      acc,
      {
        instrumentId: 'bitcoin',
        side: 'long',
        type: 'market',
        units: 0.1,
        stopLoss: 49_000,
        takeProfit: 52_000,
      },
      prices,
      T0,
    )
    if (!a.ok) throw new Error(a.error)
    const gapped = tick(a.account, { ...prices, bitcoin: 48_500 }, T0 + 1)
    expect(gapped.events[0].kind).toBe('stop')
    expect(gapped.account.history[0].exitPrice).toBe(48_500)

    const won = tick(a.account, { ...prices, bitcoin: 53_000 }, T0 + 1)
    expect(won.events[0].kind).toBe('target')
    expect(won.account.history[0].exitPrice).toBe(52_000)
    expect(won.account.history[0].pnl).toBeCloseTo(200 - 5 - 5.2)
  })
})

describe('stats', () => {
  it('computes win rate, profit factor and drawdown', () => {
    const s = computeStats([100, -50, 200, -50], [10_000, 10_100, 10_050, 10_250, 10_200])
    expect(s.winRate).toBe(0.5)
    expect(s.profitFactor).toBe(3)
    expect(s.net).toBe(200)
    expect(s.maxDrawdown).toBeCloseTo(50 / 10_100)
  })
  it('handles no trades and no losses', () => {
    expect(computeStats([], [10_000]).winRate).toBeNull()
    expect(computeStats([10], [1, 2]).profitFactor).toBeNull()
    expect(maxDrawdown([100, 80, 120, 60])).toBeCloseTo(0.5)
  })
})

describe('schema', () => {
  it('round-trips a fresh account through JSON', () => {
    const acc = createAccount(10_000, T0)
    expect(paperAccountSchema.parse(JSON.parse(JSON.stringify(acc)))).toEqual(acc)
  })
})
