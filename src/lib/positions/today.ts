import type { OHLCCandle } from '../types/market'
import type { Rule, RuleTimeframe } from '../rules/schema'
import { getInstrument, type PriceMap } from '../paper/instruments'
import {
  periodStarts,
  tally,
  type ClosedRow,
  type OpenPosition,
  type PositionMetrics,
  type PositionStatus,
  type Side,
} from './positions'

// The Today page's plain-language lines and bar positions. Pure, tested.

type Row = { pos: OpenPosition; m: PositionMetrics }

/** "$20" when the cents are zero, "$19.60" otherwise. */
export function usdShort(n: number): string {
  const cents = Math.round(Math.abs(n) * 100)
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/** "+$40", "-$19.60", "$0". */
export const signedShort = (n: number) =>
  Math.round(Math.abs(n) * 100) === 0 ? '$0' : `${n < 0 ? '-' : '+'}${usdShort(n)}`

/** "Gold", "AVAX", "GBP/USD": short enough for a sentence. */
export function shortName(market: string): string {
  const inst = getInstrument(market)
  if (!inst) return market
  if (inst.market === 'metals') return inst.label?.split(' (')[0] ?? inst.symbol
  if (inst.market === 'crypto') return inst.symbol.split('/')[0]
  return inst.symbol
}

export const sideWord = (s: Side) => (s === 'long' ? 'buy' : 'sell')

/**
 * The price a trade is valued at. Race forex trades use the race's own last
 * price: the daily ECB rate they opened on and close on (the live forex feed
 * is another source and would show moves the race never sees). Everything
 * else uses the live feeds first.
 */
export function priceFor(
  p: OpenPosition,
  live: PriceMap,
  race: PriceMap | undefined,
): number | undefined {
  const own = race?.[p.market]
  if (p.source === 'race' && own && getInstrument(p.market)?.market === 'forex') return own
  return live[p.market] ?? own
}

/** Statuses that ask for a look. "No price" is the feed's problem, not the trade's. */
export const needsLook = (s: PositionStatus) =>
  s === 'Near stop' || s === 'Near target' || s === 'No stop'

/** Where the entry and the price sit on a bar from the stop (0) to the target (1). */
export function track(
  p: OpenPosition,
  price: number | null,
): { entryAt: number; nowAt: number | null } | null {
  if (p.stop == null || p.target == null || p.target === p.stop) return null
  const stop = p.stop
  const span = p.target - stop
  const at = (v: number) => Math.min(1, Math.max(0, (v - stop) / span))
  return { entryAt: at(p.entry), nowAt: price != null && price > 0 ? at(price) : null }
}

/** Which way the trade has moved from entry, and what share of the way to that end it is. */
export type Way = { toward: 'entry' } | { toward: 'target' | 'stop'; share: number | null }

export function way(p: OpenPosition, price: number | null): Way | null {
  if (price == null || !(price > 0)) return null
  const move = (p.side === 'long' ? 1 : -1) * (price - p.entry)
  if (Math.abs(move) <= p.entry * 1e-9) return { toward: 'entry' }
  const end = move > 0 ? p.target : p.stop
  const dist = end != null ? Math.abs(end - p.entry) : 0
  return { toward: move > 0 ? 'target' : 'stop', share: dist > 0 ? Math.abs(move) / dist : null }
}

const pctOf = (share: number) => {
  const n = Math.round(share * 100)
  return n < 1 ? 'under 1%' : `${n}%`
}

/** "48% of the way to target", "At entry; forex prices update once a day". */
export function wayText(p: OpenPosition, price: number | null): string {
  const w = way(p, price)
  if (!w) return 'No live price yet'
  if (w.toward === 'entry')
    return getInstrument(p.market)?.market === 'forex'
      ? 'At entry; forex prices update once a day'
      : 'At entry'
  if (w.share == null)
    return w.toward === 'target' ? 'In profit, no target set' : 'In a loss, no stop set'
  const pct = pctOf(w.share)
  return `${pct[0].toUpperCase()}${pct.slice(1)} of the way to ${w.toward}`
}

/** The plain line under a row's bar: "Risk $20 · Goal +$40 · 48% of the way to target". */
export function rowLine(p: OpenPosition, m: PositionMetrics): string {
  return [
    m.atStopUsd != null ? `Risk ${usdShort(m.atStopUsd)}` : p.stop == null ? 'No stop' : null,
    m.atTargetUsd != null ? `Goal ${signedShort(m.atTargetUsd)}` : null,
    wayText(p, m.price),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The trade furthest along toward its target, if any is in profit. */
export function closestToTarget<T extends Row>(rows: T[]): { row: T; share: number } | null {
  let best: { row: T; share: number } | null = null
  for (const row of rows) {
    const w = way(row.pos, row.m.price)
    if (w?.toward === 'target' && w.share != null && (!best || w.share > best.share))
      best = { row, share: w.share }
  }
  return best
}

const LOOK_WORD: Partial<Record<PositionStatus, string>> = {
  'Near stop': 'near stop',
  'Near target': 'near target',
  'No stop': 'has no stop',
}

/**
 * The summary's one plain line: "Nothing needs a look. Closest: Gold buy, 43%
 * to target." or "2 trades need a look: AVAX sell near stop, Gold buy near target."
 */
export function lookLine(rows: Row[]): string | null {
  if (!rows.length) return null
  const name = (p: OpenPosition) => `${shortName(p.market)} ${sideWord(p.side)}`
  const look = rows.filter((r) => needsLook(r.m.status))
  if (look.length) {
    const shown = look.slice(0, 3).map((r) => `${name(r.pos)} ${LOOK_WORD[r.m.status]}`)
    const more = look.length - shown.length
    const verb = look.length === 1 ? 'trade needs' : 'trades need'
    return `${look.length} ${verb} a look: ${shown.join(', ')}${more ? `, and ${more} more` : ''}.`
  }
  if (rows.every((r) => r.m.status === 'No price')) return 'Waiting for live prices.'
  const c = closestToTarget(rows)
  if (!c) return 'Nothing needs a look. No trade is in profit yet.'
  return `Nothing needs a look. Closest: ${name(c.row.pos)}, ${pctOf(c.share)} to target.`
}

/** "Closed today: 2 of 2 won, +$13.45 after fees", or null when nothing closed today. */
export function closedTodayLine(rows: ClosedRow[], now: number): string | null {
  const { today } = periodStarts(now)
  const done = rows.filter((r) => r.closedAt >= today)
  if (!done.length) return null
  const t = tally(done)
  return `Closed today: ${t.wins} of ${done.length} won, ${signedShort(t.net)} after fees`
}

/** "8 open trades from 2 of 9 strategies", with demo trades counted apart. */
export function openCountLine(rows: OpenPosition[], strategies: number): string {
  const race = rows.filter((p) => p.source === 'race')
  const demo = rows.length - race.length
  const used = new Set(race.map((p) => p.by)).size
  const trades = (n: number) => `${n} open trade${n === 1 ? '' : 's'}`
  const from = `from ${used} of ${strategies} strateg${strategies === 1 ? 'y' : 'ies'}`
  if (!demo) return `${trades(race.length)} ${from}`
  if (!race.length) return `${trades(demo)}, all demo`
  return `${trades(rows.length)}: ${race.length} ${from}, ${demo} demo`
}

/**
 * Positions in % on the "Where today could end" bar, from every stop hit
 * (0%) to every target hit (100%): where $0 is and where the open P&L is.
 */
export function goalBar(
  hit: { stop: number; target: number },
  pnl: number,
): { zero: number; now: number } | null {
  const span = hit.target - hit.stop
  if (!(span > 0)) return null
  const at = (v: number) => Math.min(100, Math.max(0, ((v - hit.stop) / span) * 100))
  return { zero: at(0), now: at(pnl) }
}

const HOUR = 3_600_000

/**
 * Open P&L over time for the small "since" chart: the open trades priced at
 * each closed candle since the first one opened (at most 7 days back), ending
 * at `nowPnl`. A trade counts from its entry; before its first candle closes
 * after entry it sits at entry. Candle times are unix seconds.
 */
export function pnlSeries(
  positions: OpenPosition[],
  candles: Record<string, OHLCCandle[]>,
  now: number,
  nowPnl: number,
  maxPoints = 120,
): { t: number; pnl: number }[] {
  const ps = positions.filter((p) => p.usdPerQuote != null && p.openedAt <= now)
  if (!ps.length) return []
  const start = Math.max(Math.min(...ps.map((p) => p.openedAt)), now - 7 * 24 * HOUR)
  const closes = new Map<string, [number, number][]>()
  for (const p of ps) {
    if (closes.has(p.market)) continue
    const cs = candles[p.market] ?? []
    // Candle size = the smallest gap between candles (forex skips weekends).
    let dur = Infinity
    for (let i = 1; i < cs.length; i++) dur = Math.min(dur, cs[i].time - cs[i - 1].time)
    if (!Number.isFinite(dur)) dur = 3600
    closes.set(
      p.market,
      cs.map((c) => [(c.time + dur) * 1000, c.close]),
    )
  }
  const pnlAt = (t: number) =>
    ps.reduce((sum, p) => {
      if (p.openedAt > t) return sum
      let price = p.entry
      for (const [closeAt, close] of closes.get(p.market)!) {
        if (closeAt > t) break
        if (closeAt > p.openedAt) price = close
      }
      return sum + (p.side === 'long' ? 1 : -1) * (price - p.entry) * p.units * p.usdPerQuote!
    }, 0)
  const step = Math.max(HOUR, Math.ceil((now - start) / maxPoints / HOUR) * HOUR)
  const out = [{ t: start, pnl: pnlAt(start) }]
  for (let t = Math.floor(start / step) * step + step; t < now; t += step)
    out.push({ t, pnl: pnlAt(t) })
  out.push({ t: now, pnl: nowPnl })
  return out
}

export const TF_WORD: Record<RuleTimeframe, string> = {
  '1h': '1-hour',
  '4h': '4-hour',
  '1d': 'daily',
}

/** The "Why these levels" note: how the strategy set this stop and target. */
export function whyLevels(p: OpenPosition, rule?: Pick<Rule, 'stop' | 'rr' | 'timeframe'>): string {
  if (!rule) {
    if (p.stop == null) return 'No stop was set in Demo, so the loss is not capped.'
    return 'You set this stop and target when you placed it in Demo.'
  }
  const stop =
    rule.stop.kind === 'swing'
      ? `Stop just past the ${p.side === 'long' ? 'lowest low' : 'highest high'} of the last ${rule.stop.lookback} ${TF_WORD[rule.timeframe]} candles, plus ${rule.stop.bufferPct}%.`
      : `Stop ${rule.stop.pct}% from entry.`
  const rr =
    p.stop != null && p.target != null && p.stop !== p.entry
      ? Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop)
      : null
  const target =
    rr != null && Math.abs(rr - rule.rr) > 0.05
      ? `Target aims for ${rule.rr} times the stop distance; the fill came after the signal, so this one is ${+rr.toFixed(2)} times.`
      : `Target ${rule.rr} times the stop distance.`
  return `${stop} ${target}`
}
