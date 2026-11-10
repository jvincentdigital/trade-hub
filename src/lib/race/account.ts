import { z } from 'zod'

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
