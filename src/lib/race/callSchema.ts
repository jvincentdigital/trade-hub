import { z } from 'zod'

// John's calls (John, 2026-11-12): a $10,000 Lab account for trades John
// calls by chat. Claude records each call on the Mac (scripts/race-call.ts)
// as limit orders; the race tick fills and manages them (./johnsCalls.ts).
// The shapes live here, apart from ./johnsCalls.ts, so ./live.ts can use them
// without an import loop. Play money only.

export const JOHNS_CALLS = {
  id: 'johns-calls',
  name: "John's calls",
  startMoney: 10_000,
} as const

/** On a filled call trade: its call, its size at the fill, and what closes at each target still ahead. */
export const tradeCallSchema = z.object({
  id: z.string(),
  /** Units when it filled, so a target's share reads against the whole entry. */
  size: z.number(),
  /** Targets still ahead, nearest first, with the units each closes (the last one closes what is left). */
  legs: z.array(z.object({ price: z.number(), units: z.number() })),
})

/** One limit order of a call: one of its entries. */
export const callOrderSchema = z.object({
  entry: z.number(),
  /** Size, rounded down to the market's lot step. */
  units: z.number(),
  /** Units to close at each of the call's targets, in order (0 = none there). */
  legs: z.array(z.number()),
  status: z.enum(['pending', 'filled', 'cancelled']),
  /** Unix seconds it filled or was cancelled. */
  at: z.number().optional(),
  /** Fill price: the entry, or the minute's open when the price was already past it. */
  fill: z.number().optional(),
  /** Why it was cancelled, in plain words. */
  why: z.string().optional(),
})
export type CallOrder = z.infer<typeof callOrderSchema>

export const callSchema = z.object({
  /** "1", "2": what race-call-cancel ID= names. */
  id: z.string(),
  market: z.string(),
  direction: z.enum(['long', 'short']),
  /** One stop for every entry. */
  stop: z.number(),
  /** Nearest first. */
  targets: z.array(z.number()).min(1),
  /** % of each entry's size closed at each target (adds up to 100). */
  split: z.array(z.number()),
  /** % of the balance at risk if every entry fills. */
  riskPct: z.number(),
  note: z.string(),
  /** Unix seconds. Only prices after this count. */
  madeAt: z.number(),
  /** Unix seconds: orders still waiting then are cancelled. */
  expiresAt: z.number(),
  /** Start of the first 1-minute candle not looked at yet. */
  checkedTo: z.number(),
  orders: z.array(callOrderSchema).min(1),
})
export type Call = z.infer<typeof callSchema>
