import type { OHLCCandle } from '../types/market'
import { getInstrument, type PriceMap } from '../paper/instruments'
import { hasIntraday } from '../feeds'
import { pipSize } from '../sizing/sizing'
import { fundedAccountId, fundedAccounts, fundedLabel, FUNDED_TESTS } from './funded'
import { openPnl, REASON_TEXT, type ClosedLiveTrade, type LiveTrade, type RaceState } from './live'

// The Terminal page (src/app/terminal): a chart on top, trades below, like
// MetaTrader 4. Pure: rows for the tables, lines and trips for the chart,
// the footer sums. Play money only.

/** One play account the filter can pick: a strategy's own account or a funded test. */
export interface Book {
  id: string
  label: string
  balance: number
  open: LiveTrade[]
  closed: ClosedLiveTrade[]
}

export const ALL = 'all'

/** The 18 strategy accounts, then every funded test size (they copy London v1). */
export function allBooks(state: RaceState | null): { strategies: Book[]; funded: Book[] } {
  if (!state) return { strategies: [], funded: [] }
  const strategies = Object.values(state.strategies).map((s) => ({
    id: s.ruleId,
    label: s.name,
    balance: s.balance,
    open: s.open,
    closed: s.closed,
  }))
  const funded = FUNDED_TESTS.flatMap((test) =>
    fundedAccounts(state, test.id).map((f) => ({
      id: fundedAccountId(f.startMoney, test.id),
      label: `${fundedLabel(f.startMoney, test.id)} (copies ${test.id === 'v1' ? 'London v1' : 'London v1 and the breakout'})`,
      balance: f.balance,
      open: f.open,
      closed: f.closed,
    })),
  )
  return { strategies, funded }
}

/** "All accounts" is the strategy accounts only: the funded tests copy v1, so adding them would count its trades twice. */
export function booksFor(state: RaceState | null, account: string): Book[] {
  const { strategies, funded } = allBooks(state)
  if (account === ALL) return strategies
  return [...strategies, ...funded].filter((b) => b.id === account)
}

/** The account picked, or All when the saved one is gone. */
export function validAccount(state: RaceState | null, saved: string): string {
  if (!state) return saved
  const { strategies, funded } = allBooks(state)
  return [...strategies, ...funded].some((b) => b.id === saved) ? saved : ALL
}

/**
 * The price a trade is valued at, like `priceFor` on Today: forex at the
 * race's own last price (the price it opens and closes on), the rest at the
 * live feed first.
 */
export function priceOf(market: string, live: PriceMap, race: PriceMap | undefined) {
  const own = race?.[market]
  if (own && getInstrument(market)?.market === 'forex') return own
  return live[market] ?? own
}

/** Pips from entry in the trade's favour (forex only). */
export function pipsOf(t: Pick<LiveTrade, 'market' | 'direction' | 'entry'>, price: number) {
  const pip = pipSize(getInstrument(t.market))
  if (pip == null) return null
  return ((t.direction === 'long' ? 1 : -1) * (price - t.entry)) / pip
}

export const tradeKey = (
  account: string,
  t: Pick<LiveTrade, 'market' | 'entryTime' | 'signalTime'>,
) => `${account}|${t.market}|${t.entryTime}|${t.signalTime}`

export interface OpenRow {
  key: string
  account: string
  accountLabel: string
  trade: LiveTrade
  price: number | null
  /** Dollars before fees, like `openPnl`. */
  pnl: number | null
  pips: number | null
}

/** Open trades of the books, newest first. */
export function openRows(books: Book[], price: (market: string) => number | undefined): OpenRow[] {
  return books
    .flatMap((b) =>
      b.open.map((t) => {
        const p = price(t.market) ?? null
        return {
          key: tradeKey(b.id, t),
          account: b.id,
          accountLabel: b.label,
          trade: t,
          price: p,
          pnl: p == null ? null : openPnl(t, p),
          pips: p == null ? null : pipsOf(t, p),
        }
      }),
    )
    .sort((a, b) => b.trade.entryTime - a.trade.entryTime)
}

export interface HistoryRow {
  key: string
  account: string
  accountLabel: string
  trade: ClosedLiveTrade
  /** The first half, closed at the first target; the rest is its own row. */
  half: boolean
  reason: string
  pips: number | null
}

/** Closed trades of the books, newest close first. A trade closed in two halves is two rows. */
export function historyRows(books: Book[]): HistoryRow[] {
  return books
    .flatMap((b) =>
      b.closed.map((t) => ({
        key: `${tradeKey(b.id, t)}|${t.exitTime}`,
        account: b.id,
        accountLabel: b.label,
        trade: t,
        half: t.part1Of != null,
        reason: t.part1Of != null ? 'hit first target (half)' : REASON_TEXT[t.reason],
        pips: pipsOf(t, t.exit),
      })),
    )
    .sort((a, b) => b.trade.exitTime - a.trade.exitTime || b.trade.entryTime - a.trade.entryTime)
}

/** MT4's footer: balance, equity (balance + open P&L) and open P&L, summed over the books. */
export function footer(books: Book[], rows: OpenRow[]) {
  const balance = books.reduce((a, b) => a + b.balance, 0)
  const open = rows.reduce((a, r) => a + (r.pnl ?? 0), 0)
  return { balance, equity: balance + open, openPnl: open, accounts: books.length }
}

/** The market of the newest open trade, else gold. */
export function defaultMarket(rows: OpenRow[]): string {
  return rows[0]?.trade.market ?? 'pax-gold'
}

export type Tf = '15m' | '1h' | '4h'
export const TFS: readonly Tf[] = ['15m', '1h', '4h']

/**
 * Where a market's chart candles come from: Kraken (or GBP/JPY computed from
 * it) has 15m, 1h and 4h; the other forex pairs only the ECB's daily rate;
 * the lab's US30 has no candle route.
 */
export function candleUrl(market: string, tf: Tf): { url: string; daily: boolean } | null {
  const inst = getInstrument(market)
  if (!inst) return null
  if (inst.market === 'forex' && !hasIntraday(market))
    return { url: `/api/forex/ohlc/${market}?days=90`, daily: true }
  return { url: `/api/crypto/candles/${market}?tf=${tf}`, daily: false }
}

export type LevelKind = 'entry' | 'stop' | 'target'
export interface Level {
  key: string
  kind: LevelKind
  price: number
  title: string
  /** The trade picked in the table. */
  picked: boolean
}

/** Entry, stop and target lines of the open trades in one market (two targets when it has a first target). */
export function chartLevels(rows: OpenRow[], market: string, picked: string | null): Level[] {
  return rows
    .filter((r) => r.trade.market === market)
    .flatMap((r) => {
      const t = r.trade
      const p = r.key === picked
      const side = t.direction === 'long' ? 'Buy' : 'Sell'
      const two = t.target1 != null
      return [
        { key: r.key, kind: 'entry' as const, price: t.entry, title: side, picked: p },
        { key: r.key, kind: 'stop' as const, price: t.stop, title: 'Stop', picked: p },
        ...(two
          ? [{ key: r.key, kind: 'target' as const, price: t.target1!, title: 'T1', picked: p }]
          : []),
        {
          key: r.key,
          kind: 'target' as const,
          price: t.takeProfit,
          title: two ? 'T2' : 'Target',
          picked: p,
        },
      ]
    })
}

export interface Trip {
  key: string
  side: 'long' | 'short'
  /** Candle start times (unix seconds) the entry and exit fall in. */
  entryTime: number
  exitTime: number
  entry: number
  exit: number
  won: boolean
}

/** Start of the candle a time falls in, or null when it is outside the candles. */
function candleAt(candles: OHLCCandle[], t: number): number | null {
  if (!candles.length || t < candles[0].time) return null
  const step = candles.length > 1 ? candles[1].time - candles[0].time : 86_400
  if (t >= candles[candles.length - 1].time + step) return null
  let lo = 0
  let hi = candles.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (candles[mid].time <= t) lo = mid
    else hi = mid - 1
  }
  return candles[lo].time
}

/** Closed trades in one market whose entry and exit both fall inside the candles, newest first, at most `max`. */
export function chartTrips(
  rows: HistoryRow[],
  market: string,
  candles: OHLCCandle[],
  max = 30,
): Trip[] {
  const out: Trip[] = []
  for (const r of rows) {
    if (out.length >= max) break
    const t = r.trade
    if (t.market !== market) continue
    const entryTime = candleAt(candles, t.entryTime)
    const exitTime = candleAt(candles, t.exitTime)
    if (entryTime == null || exitTime == null) continue
    out.push({
      key: r.key,
      side: t.direction,
      entryTime,
      exitTime,
      entry: t.entry,
      exit: t.exit,
      won: t.pnl > 0,
    })
  }
  return out
}

/** Change of the price against the close about 24 hours (or one daily candle) earlier. */
export function changeOf(candles: OHLCCandle[], price: number | undefined) {
  const last = candles[candles.length - 1]
  if (!last || !price) return null
  const back = last.time - 86_400
  const ref = [...candles].reverse().find((c) => c.time <= back)
  if (!ref) return null
  return { abs: price - ref.close, pct: ((price - ref.close) / ref.close) * 100 }
}

/** Puerto Rico time (UTC-4, no summer time): "Nov 18, 9:15 AM". */
const PR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Puerto_Rico',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
export const prTime = (sec: number) => PR.format(new Date(sec * 1000))

/** "9:15 AM" in Puerto Rico time. */
const PR_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Puerto_Rico',
  hour: 'numeric',
  minute: '2-digit',
})
export const prClock = (ms: number) => PR_CLOCK.format(new Date(ms))

/** The chart's time axis shows Puerto Rico time: lightweight-charts draws UTC, so times move back 4 hours. */
export const PR_OFFSET_SEC = 4 * 3600
