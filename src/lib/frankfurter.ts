import type { OHLCCandle } from './types/market'

/**
 * Frankfurter (ECB) gives one close per day. Each candle opens at the previous
 * close; high and low are synthesized at ±0.1%. Shared by the forex OHLC route
 * and the strategy race script so both see the same candles.
 */
export function frankfurterToCandles(
  rates: Record<string, Record<string, number>>,
  quote: string,
): OHLCCandle[] {
  const dates = Object.keys(rates).sort()
  return dates.map((d, i) => {
    const close = rates[d][quote]
    const open = i > 0 ? rates[dates[i - 1]][quote] : close
    return {
      time: Math.floor(new Date(d).getTime() / 1000),
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
    }
  })
}

export function frankfurterUrl(
  base: string,
  quote: string,
  days: number,
  now = new Date(),
): string {
  const start = new Date(now)
  start.setDate(now.getDate() - days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(now)}?base=${base}&symbols=${quote}`
}
