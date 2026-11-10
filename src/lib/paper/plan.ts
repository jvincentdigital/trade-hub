import { equityOf } from './engine'
import { getInstrument, quoteToUsd, type PriceMap } from './instruments'
import type { PaperAccount } from './schema'

// Plan checks: soft warnings on the order ticket, written from John's own
// Trading Plan (max 5R open risk, 3 day trades a day, every trade has a stop
// and comes from a tested strategy) and the MM Confluence daily -2% stop.
// They warn instead of block: this is where the habits get practiced.

export const PLAN = { maxOpenR: 5, maxTradesPerDay: 3, dailyLossPct: 2, riskUnitPct: 1 }

const startOfDay = (now: number) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** USD lost if every open stop is hit; null when a position has no stop. */
export function openRiskUsd(account: PaperAccount, prices: PriceMap): number | null {
  let total = 0
  for (const p of account.positions) {
    if (p.stopLoss === undefined) return null
    const inst = getInstrument(p.instrumentId)
    const q = inst ? quoteToUsd(inst.quote, prices) : null
    if (!q) continue
    total += Math.max(
      0,
      (p.side === 'long' ? p.entryPrice - p.stopLoss : p.stopLoss - p.entryPrice) * p.units * q,
    )
  }
  return total
}

export function planWarnings(
  account: PaperAccount,
  prices: PriceMap,
  order: { riskUsd: number | null; fromStrategy: boolean },
  now = Date.now(),
): string[] {
  const out: string[] = []
  const equity = equityOf(account, prices)
  const unit = (equity * PLAN.riskUnitPct) / 100
  const today = startOfDay(now)

  if (order.riskUsd === null) out.push('No stop loss. The plan says every trade has one.')
  const open = openRiskUsd(account, prices)
  if (open !== null && order.riskUsd !== null && unit > 0) {
    const r = (open + order.riskUsd) / unit
    if (r > PLAN.maxOpenR)
      out.push(`Open risk would be ${r.toFixed(1)}R; the plan caps it at ${PLAN.maxOpenR}R.`)
  }
  const openedToday =
    account.positions.filter((p) => p.openedAt >= today).length +
    account.history.filter((t) => t.openedAt >= today).length
  if (openedToday >= PLAN.maxTradesPerDay)
    out.push(`${openedToday} trades already today; the plan allows ${PLAN.maxTradesPerDay}.`)
  const realizedToday = account.history
    .filter((t) => t.closedAt >= today)
    .reduce((a, t) => a + t.pnl, 0)
  if (equity > 0 && realizedToday <= -(equity * PLAN.dailyLossPct) / 100)
    out.push(
      `Down $${Math.abs(realizedToday).toFixed(0)} today (over ${PLAN.dailyLossPct}%): the plan says stop for the day.`,
    )
  if (!order.fromStrategy)
    out.push('Not from a backtested strategy rule. Fine for practice; the plan wants one.')
  return out
}
