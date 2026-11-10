import { z } from 'zod'

// Demo ("paper") account persisted in localStorage under `trade-hub-paper-account`.
// Play money only: nothing here talks to a broker.

export const sideSchema = z.enum(['long', 'short'])
export type Side = z.infer<typeof sideSchema>

export const pendingOrderSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  side: sideSchema,
  units: z.number().positive(),
  limitPrice: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  createdAt: z.number(),
  strategyId: z.string().optional(),
})
export type PendingOrder = z.infer<typeof pendingOrderSchema>

export const positionSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  side: sideSchema,
  units: z.number().positive(),
  entryPrice: z.number().positive(),
  /** USD set aside from cash while the position is open. */
  margin: z.number().nonnegative(),
  /** USD fee paid when the position opened. */
  entryFee: z.number().nonnegative(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  openedAt: z.number(),
  strategyId: z.string().optional(),
})
export type Position = z.infer<typeof positionSchema>

export const closedTradeSchema = positionSchema.extend({
  exitPrice: z.number().positive(),
  closedAt: z.number(),
  /** Net USD result after entry and exit fees. */
  pnl: z.number(),
  reason: z.enum(['manual', 'stop', 'target']),
})
export type ClosedTrade = z.infer<typeof closedTradeSchema>

export const equityPointSchema = z.object({ t: z.number(), equity: z.number() })
export type EquityPoint = z.infer<typeof equityPointSchema>

export const paperAccountSchema = z.object({
  version: z.literal(1),
  startingBalance: z.number().positive(),
  cash: z.number(),
  createdAt: z.number(),
  pendingOrders: z.array(pendingOrderSchema),
  positions: z.array(positionSchema),
  history: z.array(closedTradeSchema),
  equity: z.array(equityPointSchema),
})
export type PaperAccount = z.infer<typeof paperAccountSchema>
