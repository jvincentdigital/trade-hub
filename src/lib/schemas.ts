import { z } from 'zod'

// CoinGecko /simple/price?include_24hr_change=true&include_24hr_vol=true&include_market_cap=true
export const cryptoPricesResponseSchema = z.record(
  z.string(),
  // CoinGecko sends null for fields it can't compute (e.g. a stale coin); one
  // null must not take down the whole price feed, so null becomes "missing".
  z.object({
    usd: z
      .number()
      .nullish()
      .transform((v) => v ?? undefined),
    usd_24h_change: z
      .number()
      .nullish()
      .transform((v) => v ?? undefined),
    usd_24h_vol: z
      .number()
      .nullish()
      .transform((v) => v ?? undefined),
    usd_market_cap: z
      .number()
      .nullish()
      .transform((v) => v ?? undefined),
  }),
)
export type CryptoPricesResponse = z.infer<typeof cryptoPricesResponseSchema>

// CoinGecko /coins/{id}/ohlc — array of [time, open, high, low, close] tuples.
export const ohlcRowSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])
export const ohlcResponseSchema = z.array(ohlcRowSchema)
export type OHLCResponse = z.infer<typeof ohlcResponseSchema>

// CoinGecko /coins/{id}/market_chart — `prices` powers the intraday bucketer;
// `total_volumes` powers the scanner. Both optional so either caller can ignore.
export const marketChartResponseSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])).optional(),
  total_volumes: z.array(z.tuple([z.number(), z.number()])).optional(),
})
export type MarketChartResponse = z.infer<typeof marketChartResponseSchema>

// ExchangeRate API /latest/USD
export const forexRatesResponseSchema = z.object({
  rates: z.record(z.string(), z.number()),
})
export type ForexRatesResponse = z.infer<typeof forexRatesResponseSchema>

// Frankfurter /v1/{start}..{end}?base=X&symbols=Y — for synthesized forex OHLC.
export const frankfurterResponseSchema = z.object({
  rates: z.record(z.string(), z.record(z.string(), z.number())),
})
export type FrankfurterResponse = z.infer<typeof frankfurterResponseSchema>

// Twelve Data /time_series — real intraday forex OHLC (requires API key).
const twelveDataCandleSchema = z.object({
  datetime: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
})
export const twelveDataResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    values: z.array(twelveDataCandleSchema),
  }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    code: z.number().optional(),
  }),
])
export type TwelveDataResponse = z.infer<typeof twelveDataResponseSchema>

// Persistent user data — used both to validate on localStorage read and
// to validate imported export bundles.
export const strategySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  signalType: z.enum(['bullish-reversal', 'bearish-reversal', 'continuation', 'breakout', 'scalp']),
  marketType: z.enum(['crypto', 'forex', 'both']),
  patterns: z.array(z.string()),
  entryRules: z.string(),
  exitRules: z.string(),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const strategiesArraySchema = z.array(strategySchema)
export const watchlistArraySchema = z.array(z.string())

export const exportBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  strategies: strategiesArraySchema,
  watchlist: watchlistArraySchema,
})
export type ExportBundle = z.infer<typeof exportBundleSchema>

// Trade-plan strategies — the new model on /strategies (entry/stop/target,
// pattern watch, auto-trigger on live pattern detection).
export const TRADE_PLAN_TIMEFRAMES = ['1D', '7D', '30D', '90D', '180D', '1Y'] as const
export type TradePlanTimeframe = (typeof TRADE_PLAN_TIMEFRAMES)[number]

export const tradePlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  pair: z.string(),
  market: z.enum(['crypto', 'forex']),
  pattern: z.string(),
  timeframe: z.enum(TRADE_PLAN_TIMEFRAMES),
  direction: z.enum(['long', 'short']),
  entry: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  notes: z.string(),
  status: z.enum(['active', 'triggered', 'closed']),
  createdAt: z.number(),
  triggeredAt: z.number().optional(),
})
export const tradePlansArraySchema = z.array(tradePlanSchema)
export type TradePlan = z.infer<typeof tradePlanSchema>
