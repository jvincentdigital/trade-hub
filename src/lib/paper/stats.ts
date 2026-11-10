export interface PerformanceStats {
  trades: number
  wins: number
  losses: number
  /** 0..1, null with no trades. */
  winRate: number | null
  /** Gross wins / gross losses. Null when there are no losing trades yet. */
  profitFactor: number | null
  net: number
  avgWin: number
  avgLoss: number
  /** Largest peak-to-trough drop of the equity curve, as a fraction (0.12 = 12%). */
  maxDrawdown: number
}

/** Shared by the demo account (results in USD) and backtests (results in R). */
export function computeStats(results: number[], equityCurve: number[]): PerformanceStats {
  const wins = results.filter((r) => r > 0)
  const losses = results.filter((r) => r < 0)
  const grossWin = wins.reduce((a, b) => a + b, 0)
  const grossLoss = -losses.reduce((a, b) => a + b, 0)
  return {
    trades: results.length,
    wins: wins.length,
    losses: losses.length,
    winRate: results.length ? wins.length / results.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    net: results.reduce((a, b) => a + b, 0),
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    maxDrawdown: maxDrawdown(equityCurve),
  }
}

export function maxDrawdown(curve: number[]): number {
  let peak = -Infinity
  let worst = 0
  for (const v of curve) {
    if (v > peak) peak = v
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak)
  }
  return worst
}
