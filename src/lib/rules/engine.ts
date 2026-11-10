import type { OHLCCandle } from '../types/market'
import { detectAll } from '../patterns/detector'
import { detectMWFormation, ema, rsiSeries } from '../scanner/mmConfluence'
import { computeStats, type PerformanceStats } from '../paper/stats'
import type { Condition, Rule, RuleTimeframe, SessionWindow } from './schema'

export type Direction = 'long' | 'short'

export interface Signal {
  index: number
  time: number
  direction: Direction
  entry: number
  stop: number
  takeProfit: number
}

const TF_SECONDS: Record<RuleTimeframe, number> = { '1h': 3600, '4h': 14_400, '1d': 86_400 }

/**
 * Indicator series computed once per candle array and aligned to candle
 * indexes (NaN where not enough history). Signals at index i only ever read
 * values at or before i, so backtests have no look-ahead.
 */
class Indicators {
  private emas = new Map<number, number[]>()
  private rsis = new Map<number, number[]>()
  private patterns: Map<number, { name: string; type: string }[]> | null = null
  constructor(private candles: OHLCCandle[]) {}

  ema(period: number): number[] {
    let s = this.emas.get(period)
    if (!s) {
      const raw = ema(
        this.candles.map((c) => c.close),
        period,
      )
      s = [...Array<number>(this.candles.length - raw.length).fill(NaN), ...raw]
      this.emas.set(period, s)
    }
    return s
  }

  rsi(period: number): number[] {
    let s = this.rsis.get(period)
    if (!s) {
      const raw = rsiSeries(
        this.candles.map((c) => c.close),
        period,
      )
      s = [...Array<number>(this.candles.length - raw.length).fill(NaN), ...raw]
      this.rsis.set(period, s)
    }
    return s
  }

  patternsAt(i: number) {
    if (!this.patterns) {
      this.patterns = new Map()
      for (const h of detectAll(this.candles)) {
        const arr = this.patterns.get(h.index) ?? []
        arr.push({ name: h.name, type: h.type })
        this.patterns.set(h.index, arr)
      }
    }
    return this.patterns.get(i) ?? []
  }
}

function conditionPasses(
  c: Condition,
  d: Direction,
  candles: OHLCCandle[],
  i: number,
  ind: Indicators,
): boolean {
  const bar = candles[i]
  const long = d === 'long'
  switch (c.kind) {
    case 'trend': {
      const e = ind.ema(c.period)[i]
      return Number.isFinite(e) && (long ? bar.close > e : bar.close < e)
    }
    case 'emaStack': {
      const f = ind.ema(c.fast)[i]
      const s = ind.ema(c.slow)[i]
      return Number.isFinite(f) && Number.isFinite(s) && (long ? f > s : f < s)
    }
    case 'rsi': {
      const r = ind.rsi(c.period)[i]
      return Number.isFinite(r) && (long ? r < c.longBelow : r > c.shortAbove)
    }
    case 'formation': {
      if (i < 9) return false
      const f = detectMWFormation(candles.slice(i - 9, i + 1))
      return long ? f === 'W' : f === 'M'
    }
    case 'emaTouch': {
      const e = ind.ema(c.period)[i]
      if (!Number.isFinite(e)) return false
      const tol = c.tolerancePct / 100
      return long
        ? bar.low <= e * (1 + tol) && bar.close > e
        : bar.high >= e * (1 - tol) && bar.close < e
    }
    case 'pattern': {
      const want = long ? 'bullish' : 'bearish'
      for (let k = Math.max(0, i - c.lookback + 1); k <= i; k++) {
        if (
          ind
            .patternsAt(k)
            .some((p) => p.type === want && (c.names.length === 0 || c.names.includes(p.name)))
        )
          return true
      }
      return false
    }
    case 'nearLevel': {
      if (i < c.lookback - 1) return false
      const win = candles.slice(i - c.lookback + 1, i + 1)
      const level = long ? Math.min(...win.map((x) => x.low)) : Math.max(...win.map((x) => x.high))
      return level > 0 && Math.abs(bar.close - level) / level <= c.tolerancePct / 100
    }
  }
}

/** New York wall-clock hour (fractional) for a unix-seconds timestamp. */
export function nyHour(unixSec: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(unixSec * 1000))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h + m / 60
}

/** True when the candle [time, time + tf) overlaps any window. Daily candles always pass. */
export function inSession(windows: SessionWindow[], time: number, tf: RuleTimeframe): boolean {
  if (windows.length === 0 || tf === '1d') return true
  const startH = nyHour(time)
  const endH = startH + TF_SECONDS[tf] / 3600
  return windows.some((w) => {
    // Check the candle span on today's clock and shifted by a day for wrap-around.
    return [0, 24].some((shift) => startH < w.end + shift && endH > w.start + shift)
  })
}

export function stopFor(
  rule: Rule,
  d: Direction,
  candles: OHLCCandle[],
  i: number,
  entry: number,
): number {
  const s = rule.stop
  if (s.kind === 'percent')
    return d === 'long' ? entry * (1 - s.pct / 100) : entry * (1 + s.pct / 100)
  const win = candles.slice(Math.max(0, i - s.lookback + 1), i + 1)
  const buf = s.bufferPct / 100
  return d === 'long'
    ? Math.min(...win.map((c) => c.low)) * (1 - buf)
    : Math.max(...win.map((c) => c.high)) * (1 + buf)
}

function directions(rule: Rule): Direction[] {
  return rule.direction === 'both' ? ['long', 'short'] : [rule.direction]
}

function evaluate(rule: Rule, candles: OHLCCandle[], i: number, ind: Indicators): Signal | null {
  const bar = candles[i]
  if (!bar || !inSession(rule.sessions, bar.time, rule.timeframe)) return null
  for (const d of directions(rule)) {
    if (!rule.conditions.every((c) => conditionPasses(c, d, candles, i, ind))) continue
    const entry = bar.close
    const stop = stopFor(rule, d, candles, i, entry)
    const risk = Math.abs(entry - stop)
    if (!(risk > 0) || (d === 'long' ? stop >= entry : stop <= entry)) continue
    const takeProfit = d === 'long' ? entry + rule.rr * risk : entry - rule.rr * risk
    if (!(takeProfit > 0)) continue
    return { index: i, time: bar.time, direction: d, entry, stop, takeProfit }
  }
  return null
}

/** Every candle where the rule fires. */
export function findSignals(rule: Rule, candles: OHLCCandle[]): Signal[] {
  const ind = new Indicators(candles)
  const out: Signal[] = []
  for (let i = 0; i < candles.length; i++) {
    const s = evaluate(rule, candles, i, ind)
    if (s) out.push(s)
  }
  return out
}

/** Signal on one of the last `lookback` candles, newest first. */
export function latestSignal(rule: Rule, candles: OHLCCandle[], lookback = 2): Signal | null {
  const ind = new Indicators(candles)
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - lookback); i--) {
    const s = evaluate(rule, candles, i, ind)
    if (s) return s
  }
  return null
}

export interface BacktestTrade {
  direction: Direction
  entryTime: number
  exitTime: number
  entry: number
  exit: number
  stop: number
  takeProfit: number
  /** Result in R (multiples of the initial risk), after fees. */
  r: number
  reason: 'stop' | 'target' | 'end'
}

export interface BacktestResult {
  trades: BacktestTrade[]
  signals: Signal[]
  stats: PerformanceStats
  totalR: number
  startEquity: number
  endEquity: number
  /** Candles in the test and the span they cover. */
  candles: number
  from: number | null
  to: number | null
}

/**
 * Walk the candles once. A signal on candle i enters at the next candle's
 * open; stop and target are the signal's levels. If a candle touches both,
 * the stop is assumed first (conservative). One position at a time.
 * Equity compounds at `rule.riskPct` per trade from `startEquity`.
 */
export function backtest(
  rule: Rule,
  candles: OHLCCandle[],
  opts: { startEquity?: number; feeRate?: number } = {},
): BacktestResult {
  const startEquity = opts.startEquity ?? 10_000
  const feeRate = opts.feeRate ?? 0
  const ind = new Indicators(candles)
  const trades: BacktestTrade[] = []
  const signals: Signal[] = []
  const curve = [startEquity]
  let equity = startEquity
  let pending: Signal | null = null
  let pos: (Signal & { entryTime: number; fill: number }) | null = null

  const finish = (exit: number, exitTime: number, reason: BacktestTrade['reason']) => {
    if (!pos) return
    const risk = Math.abs(pos.fill - pos.stop)
    const move = (exit - pos.fill) * (pos.direction === 'long' ? 1 : -1)
    const fees = (feeRate * (pos.fill + exit)) / risk
    const r = move / risk - fees
    equity *= 1 + (r * rule.riskPct) / 100
    curve.push(equity)
    trades.push({
      direction: pos.direction,
      entryTime: pos.entryTime,
      exitTime,
      entry: pos.fill,
      exit,
      stop: pos.stop,
      takeProfit: pos.takeProfit,
      r,
      reason,
    })
    pos = null
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (pending) {
      const s: Signal = pending
      pending = null
      const valid =
        s.direction === 'long'
          ? c.open > s.stop && c.open < s.takeProfit
          : c.open < s.stop && c.open > s.takeProfit
      if (valid) pos = { ...s, entryTime: c.time, fill: c.open }
    }
    if (pos) {
      const long = pos.direction === 'long'
      const stopHit = long ? c.low <= pos.stop : c.high >= pos.stop
      const tpHit = long ? c.high >= pos.takeProfit : c.low <= pos.takeProfit
      if (stopHit) {
        // Gap through the stop fills at the open, otherwise at the stop.
        const gapped = long ? c.open < pos.stop : c.open > pos.stop
        finish(gapped && pos.entryTime !== c.time ? c.open : pos.stop, c.time, 'stop')
      } else if (tpHit) {
        finish(pos.takeProfit, c.time, 'target')
      }
    }
    const s = evaluate(rule, candles, i, ind)
    if (s) {
      signals.push(s)
      if (!pos && i < candles.length - 1) pending = s
    }
  }
  if (pos) {
    const last = candles[candles.length - 1]
    finish(last.close, last.time, 'end')
  }

  const rs = trades.map((t) => t.r)
  return {
    trades,
    signals,
    stats: computeStats(rs, curve),
    totalR: rs.reduce((a, b) => a + b, 0),
    startEquity,
    endEquity: equity,
    candles: candles.length,
    from: candles[0]?.time ?? null,
    to: candles[candles.length - 1]?.time ?? null,
  }
}

/** Plain-English line for each condition (shown on cards and in docs). */
export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case 'trend':
      return `Trend filter: buys only above the ${c.period} EMA, sells only below it`
    case 'emaStack':
      return `EMA ${c.fast} above EMA ${c.slow} for buys (below for sells)`
    case 'rsi':
      return `RSI(${c.period}) under ${c.longBelow} for buys, over ${c.shortAbove} for sells`
    case 'formation':
      return 'W bottom (buys) or M top (sells) with a stop hunt in the last 10 candles'
    case 'emaTouch':
      return `Candle tests the ${c.period} EMA (within ${c.tolerancePct}%) and closes back on the trend side`
    case 'pattern':
      return `${c.names.length ? c.names.join(' / ') : 'Any matching reversal candle'} in the last ${c.lookback} candle${c.lookback > 1 ? 's' : ''}`
    case 'nearLevel':
      return `Price within ${c.tolerancePct}% of the ${c.lookback}-candle low (buys) or high (sells)`
  }
}

export function describeStop(rule: Rule): string {
  const s = rule.stop
  return s.kind === 'percent'
    ? `Stop ${s.pct}% from entry`
    : `Stop beyond the last ${s.lookback} candles' extreme + ${s.bufferPct}% buffer`
}
