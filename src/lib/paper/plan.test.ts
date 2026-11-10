import { describe, expect, it } from 'vitest'
import { createAccount, placeOrder } from './engine'
import { openRiskUsd, planWarnings } from './plan'

const T0 = new Date(2026, 10, 10, 12).getTime()
const prices = { bitcoin: 50_000 }

describe('plan checks', () => {
  it('warns about a missing stop and a trade not from a rule', () => {
    const w = planWarnings(
      createAccount(10_000, T0),
      prices,
      { riskUsd: null, fromStrategy: false },
      T0,
    )
    expect(w.join(' ')).toMatch(/No stop loss/)
    expect(w.join(' ')).toMatch(/backtested/)
  })

  it('sums open risk to the stops and flags more than 5R', () => {
    const r = placeOrder(
      createAccount(10_000, T0),
      { instrumentId: 'bitcoin', side: 'long', type: 'market', units: 0.1, stopLoss: 48_000 },
      prices,
      T0,
    )
    if (!r.ok) throw new Error(r.error)
    expect(openRiskUsd(r.account, prices)).toBeCloseTo(200)
    // 200 open + 400 new = 600 = ~6R of a ~$100 unit
    const w = planWarnings(r.account, prices, { riskUsd: 400, fromStrategy: true }, T0)
    expect(w.some((x) => /Open risk would be/.test(x))).toBe(true)
    expect(planWarnings(r.account, prices, { riskUsd: 100, fromStrategy: true }, T0)).toEqual([])
  })

  it('flags the 4th trade of the day', () => {
    let acc = createAccount(10_000, T0)
    for (let i = 0; i < 3; i++) {
      const r = placeOrder(
        acc,
        { instrumentId: 'bitcoin', side: 'long', type: 'market', units: 0.01, stopLoss: 49_000 },
        prices,
        T0,
      )
      if (!r.ok) throw new Error(r.error)
      acc = r.account
    }
    expect(planWarnings(acc, prices, { riskUsd: 10, fromStrategy: true }, T0).join(' ')).toMatch(
      /3 trades already today/,
    )
  })
})
