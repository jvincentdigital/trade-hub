import { z } from 'zod'
import { bookClose, type ClosedLiveTrade, type LiveTrade, type RaceState } from './live'
import { FUNDED_TESTS, fundedAccountId, fundedAccounts, withFunded } from './funded'

// "Close now" on Today (John, 2026-11-11). The live site cannot write
// race.json (the Mac's race check is its only writer), so a tap stores a close
// request in the race relay worker (race-worker/). The next race check reads
// the requests and books each one at the open of the first Kraken 1-minute
// candle at or after the tap, unless the trade's stop or target was touched
// between the last check and the tap: then the stop or target wins, as it
// would have closed first. Pure, tested.

/**
 * The $10K funded test's account in a trade id; the other sizes are
 * "funded-50k" and so on, the v1 + breakouts test "funded-b-10k" and so on
 * (fundedAccountId in ./funded.ts). Lab trades use their strategy id.
 */
export const FUNDED_ACCOUNT = 'funded'

/** The funded account (and its test) a trade id's account part names, or undefined for a Lab account. */
const fundedById = (state: RaceState, account: string) => {
  for (const { id: test } of FUNDED_TESTS) {
    const f = fundedAccounts(state, test).find(
      (x) => fundedAccountId(x.startMoney, test) === account,
    )
    if (f) return { f, test }
  }
  return undefined
}

/** "<account>|<market>|<entry time, Unix seconds>". The worker checks the same pattern. */
export const CLOSE_ID = /^[a-z0-9-]{1,64}\|[A-Za-z0-9-]{1,32}\|\d{1,12}$/

export const tradeId = (account: string, t: Pick<LiveTrade, 'market' | 'entryTime'>) =>
  `${account}|${t.market}|${t.entryTime}`

export const closeRequestSchema = z.object({
  id: z.string().regex(CLOSE_ID),
  /** Milliseconds: when the tap reached the site. */
  at: z.number(),
})
export type CloseRequest = z.infer<typeof closeRequestSchema>
/** Pending requests by trade id (one per trade: a second tap keeps the first time). */
export const closeRequestsSchema = z.record(z.string(), closeRequestSchema)
export type CloseRequests = z.infer<typeof closeRequestsSchema>

/** The open trade a request names, or null when it is not open (closed already, or unknown). */
export function findOpen(
  state: RaceState,
  id: string,
): { account: string; trade: LiveTrade } | null {
  const [account, market, entry] = id.split('|')
  const list = account.startsWith(FUNDED_ACCOUNT)
    ? fundedById(state, account)?.f.open
    : state.strategies[account]?.open
  const trade = list?.find((t) => t.market === market && t.entryTime === Number(entry))
  return trade ? { account, trade } : null
}

/** One Kraken 1-minute candle: start (Unix seconds), open, high, low. */
export interface Minute {
  t: number
  o: number
  h: number
  l: number
}

export type CloseDecision =
  | { kind: 'wait' }
  | { kind: 'close'; exit: number; time: number; reason: 'stop' | 'target' | 'manual' }

/**
 * Where a tap books. `minutes` are the market's 1-minute candles, oldest
 * first, or null for a market without them (USD/JPY, NZD/USD: the race's
 * daily rate, `fallback`, as in scripts/race-close-all.ts). `fromSec` is the
 * start of what the last check has not seen yet. Waits when the tap's minute
 * is not printed yet.
 */
export function decideClose(
  t: LiveTrade,
  tapMs: number,
  minutes: Minute[] | null,
  fallback: number | undefined,
  fromSec: number,
): CloseDecision {
  const fill = Math.ceil(tapMs / 60_000) * 60
  if (!minutes)
    return fallback && fallback > 0
      ? { kind: 'close', exit: fallback, time: fill, reason: 'manual' }
      : { kind: 'wait' }
  // Not the minute the trade opened in: part of it came before the entry.
  const from = Math.max(fromSec, Math.ceil(t.entryTime / 60) * 60)
  const long = t.direction === 'long'
  for (const r of minutes) {
    if (r.t < from || r.t >= fill) continue
    if (long ? r.l <= t.stop : r.h >= t.stop) {
      const gapped = long ? r.o < t.stop : r.o > t.stop
      return { kind: 'close', exit: gapped ? r.o : t.stop, time: r.t, reason: 'stop' }
    }
    if (long ? r.h >= t.takeProfit : r.l <= t.takeProfit)
      return { kind: 'close', exit: t.takeProfit, time: r.t, reason: 'target' }
  }
  const at = minutes.find((r) => r.t >= fill)
  return at ? { kind: 'close', exit: at.o, time: at.t, reason: 'manual' } : { kind: 'wait' }
}

export interface Booked {
  id: string
  account: string
  closed: ClosedLiveTrade
}

/**
 * Every pending request, in tap order: booked (the trade closes and the
 * request can go), dropped (the trade is not open any more: closed by its
 * stop, target or the 12:45 close first, or never existed) or waiting (its
 * minute is not printed yet, or its 1-minute feed failed: try at the next check).
 */
export function bookCloseRequests(
  state: RaceState,
  requests: CloseRequests,
  /** The market's 1-minute candles; null = it has none; undefined = the fetch failed. */
  minutesOf: (market: string) => Minute[] | null | undefined,
  fromSec: number,
  feeRate: (market: string) => number,
): { state: RaceState; booked: Booked[]; dropped: string[]; waiting: string[] } {
  const booked: Booked[] = []
  const dropped: string[] = []
  const waiting: string[] = []
  let next = state
  for (const req of Object.values(requests).sort((a, b) => a.at - b.at)) {
    const found = findOpen(next, req.id)
    if (!found) {
      dropped.push(req.id)
      continue
    }
    const { account, trade } = found
    const minutes = minutesOf(trade.market)
    const d =
      minutes === undefined
        ? ({ kind: 'wait' } as const)
        : decideClose(trade, req.at, minutes, next.prices[trade.market], fromSec)
    if (d.kind === 'wait') {
      waiting.push(req.id)
      continue
    }
    const fee = feeRate(trade.market)
    // A funded trade closes in its own test and size's account only.
    const inFunded = account.startsWith(FUNDED_ACCOUNT) ? fundedById(next, account) : undefined
    let c: ClosedLiveTrade
    if (inFunded) {
      const { f, test } = inFunded
      const own = bookClose(f.open.find((t) => t === trade)!, d.exit, d.time, d.reason, fee)
      c = own
      const after = {
        ...f,
        balance: f.balance + own.pnl,
        open: f.open.filter((t) => t !== trade),
        closed: [...f.closed, own],
      }
      next = withFunded(
        next,
        fundedAccounts(next, test).map((x) => (x === f ? after : x)),
        test,
      )
    } else {
      const s = next.strategies[account]
      c = bookClose(trade, d.exit, d.time, d.reason, fee)
      next = {
        ...next,
        strategies: {
          ...next.strategies,
          [account]: {
            ...s,
            balance: s.balance + c.pnl,
            open: s.open.filter((t) => t !== trade),
            closed: [...s.closed, c],
          },
        },
      }
    }
    booked.push({ id: req.id, account, closed: c })
  }
  return { state: next, booked, dropped, waiting }
}
