import { z } from 'zod'

// Structured strategy rules. A rule is a list of conditions that must ALL be
// true on a closed candle, plus how to place the stop and target. The same
// rule drives chart signals, backtests and one-tap demo trades.

export const RULE_TIMEFRAMES = ['1h', '4h', '1d'] as const
export type RuleTimeframe = (typeof RULE_TIMEFRAMES)[number]

export const conditionSchema = z.discriminatedUnion('kind', [
  /** Long only above EMA(period); short only below it. The "higher-timeframe bias". */
  z.object({ kind: z.literal('trend'), period: z.number().int().min(2) }),
  /** Long when EMA(fast) > EMA(slow); short when below. */
  z.object({
    kind: z.literal('emaStack'),
    fast: z.number().int().min(2),
    slow: z.number().int().min(3),
  }),
  /** Long when RSI < longBelow; short when RSI > shortAbove. */
  z.object({
    kind: z.literal('rsi'),
    period: z.number().int().min(2),
    longBelow: z.number().min(0).max(100),
    shortAbove: z.number().min(0).max(100),
  }),
  /** W (long) or M (short) formation with a lower-low / higher-high stop hunt in the last 10 candles. */
  z.object({ kind: z.literal('formation') }),
  /** Candle tested EMA(period) within tolerancePct and closed back on the trend side. */
  z.object({
    kind: z.literal('emaTouch'),
    period: z.number().int().min(2),
    tolerancePct: z.number().positive(),
  }),
  /** A candlestick pattern with matching bias in the last `lookback` candles (empty names = any). */
  z.object({
    kind: z.literal('pattern'),
    names: z.array(z.string()),
    lookback: z.number().int().min(1),
  }),
  /** Close is within tolerancePct of the lowest low (long) / highest high (short) of `lookback` candles. */
  z.object({
    kind: z.literal('nearLevel'),
    lookback: z.number().int().min(3),
    tolerancePct: z.number().positive(),
  }),
])
export type Condition = z.infer<typeof conditionSchema>
export type ConditionKind = Condition['kind']

export const stopSchema = z.discriminatedUnion('kind', [
  /** Beyond the lowest low / highest high of the last `lookback` candles, plus a buffer. */
  z.object({
    kind: z.literal('swing'),
    lookback: z.number().int().min(2),
    bufferPct: z.number().min(0),
  }),
  /** Fixed distance from entry. */
  z.object({ kind: z.literal('percent'), pct: z.number().positive() }),
])
export type StopRule = z.infer<typeof stopSchema>

export const sessionWindowSchema = z.object({
  label: z.string(),
  /** Hours in New York time, 0-24, may be fractional (2.5 = 2:30). */
  start: z.number().min(0).max(24),
  end: z.number().min(0).max(24),
})
export type SessionWindow = z.infer<typeof sessionWindowSchema>

export const sourceRefSchema = z.object({ label: z.string(), at: z.string().optional() })

export const ruleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  summary: z.string(),
  market: z.enum(['crypto', 'forex', 'both']),
  /** Instrument ids; empty = every instrument of the market. */
  pairs: z.array(z.string()),
  timeframe: z.enum(RULE_TIMEFRAMES),
  direction: z.enum(['long', 'short', 'both']),
  conditions: z.array(conditionSchema).min(1),
  stop: stopSchema,
  /** Take profit = entry ± rr × stop distance. */
  rr: z.number().positive(),
  riskPct: z.number().positive().max(10),
  /** Only take signals inside these New York time windows (ignored on 1d candles). */
  sessions: z.array(sessionWindowSchema),
  sources: z.array(sourceRefSchema),
  builtIn: z.boolean().optional(),
})
export type Rule = z.infer<typeof ruleSchema>
export const rulesArraySchema = z.array(ruleSchema)
