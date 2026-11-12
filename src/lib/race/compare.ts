import { JOHNS_LONDON } from './johnsLondonLive'
import { LAB_BOTS } from './labBots'
import { LONDON_BREAKOUT } from './londonBreakout'
import { summarize, tradeRisk, type ClosedLiveTrade, type LiveTrade, type RaceState } from './live'

// The Compare page (was Race, John 2026-11-12): "which strategy is worth
// backing". One row per strategy account in the live race, with its live
// play results from closed trades (fees included, since every closed trade's
// pnl is net) and what its past tests showed. Pure, tested.

export type Evidence = 'passed' | 'live' | 'lost'

/** The tag each row shows, in plain words. */
export const EVIDENCE_TEXT: Record<Evidence, string> = {
  passed: 'Passed an unseen-data test',
  live: 'Testing live only',
  lost: 'Lost its past test',
}

/** Sort order for "Evidence": a pass first, no test next, a lost test last. */
const EVIDENCE_RANK: Record<Evidence, number> = { passed: 0, live: 1, lost: 2 }

export interface PastTest {
  evidence: Evidence
  /** What the past test showed, in plain words. */
  text: string
}

const NO_PAST_TEST: PastTest = {
  evidence: 'live',
  text: 'No fair past test yet. Only its live play trades count.',
}

const lab = (test: string, older: string): PastTest => ({
  evidence: 'lost',
  text: `Made money in the lab's test months (April to November 2026): ${test}. Lost on the older history it was never tuned on (2019 to 2024, same settings): ${older}. Source: strategy lab report, 2026-11-11.`,
})

/**
 * Past tests we have (sources in ~/jvd-outputs/2026-11-11: london-strategy
 * FINAL.md and HOLDOUT.md for v1, strategy-lab REPORT.md for the lab bots).
 * A strategy not listed here (the 11 originals, and any new one such as
 * John's video method once it joins the race) is "Testing live only".
 */
export const PAST_TESTS: Record<string, PastTest> = {
  [JOHNS_LONDON.id]: {
    evidence: 'passed',
    text: 'Passed its one-time test on a clean year it had never seen (November 2024 to November 2025): $10,000 became $16,896 on 97 trades, 58% won, +0.28R a trade, worst drop 9.6%. One good year is a good sign, not proof. Source: London strategy report, 2026-11-11.',
  },
  'lab-rsi-us30': lab('+$4,986 on 59 trades', '-$5,649 on 462 trades'),
  'lab-fib-eurusd-4h': lab('+$2,648 on 37 trades', '-$8,588 on 305 trades'),
  'lab-ema1236-gold-4h': lab('+$1,953 on 32 trades', '-$3,388 on 310 trades'),
  'lab-fib-london-us30': lab('+$1,201 on 39 trades', '-$5,909 on 332 trades'),
  'lab-stophunt-gold-1h': lab('+$952 on 34 trades', '-$8,374 on 286 trades'),
  [LONDON_BREAKOUT.id]: {
    ...NO_PAST_TEST,
    text: `${NO_PAST_TEST.text} The strategy lab saw it lose in winter months on past data (-$5,116 on both markets), and UK winter time started on 2026-10-25.`,
  },
}

/**
 * When accounts that joined a running race got their money: the five lab
 * bots and John's London v1 joined at the check of 2026-11-11 17:43:43 AST
 * (race.log). Every other account started with the race (state.startedAt).
 */
const JOINED_2026_11_11 = Date.parse('2026-11-11T21:43:43Z')
export const JOINED_AT: Record<string, number> = Object.fromEntries(
  [...LAB_BOTS.map((b) => b.id), JOHNS_LONDON.id].map((id) => [id, JOINED_2026_11_11]),
)

/** One whole trade: a half closed at the first target and the rest are one trade. */
export interface TradeResult {
  market: string
  entryTime: number
  /** When the last part closed. */
  exitTime: number
  /** Net dollars, both fees of every part included. */
  pnl: number
  /** Dollars it risked at its stop, from entry, before fees. */
  risk: number
  /** pnl / risk, or null when it had no risk to measure (stop at entry). */
  r: number | null
}

const tradeKey = (t: Pick<LiveTrade, 'market' | 'entryTime' | 'signalTime'>) =>
  `${t.market}|${t.entryTime}|${t.signalTime}`

/**
 * Closed parts grouped into whole trades, oldest exit first. A trade with a
 * part still open (half off at the first target, the rest running) is left
 * out until the rest closes.
 */
export function tradeResults(closed: ClosedLiveTrade[], open: LiveTrade[] = []): TradeResult[] {
  const stillOpen = new Set(open.map(tradeKey))
  const byKey = new Map<string, TradeResult>()
  for (const t of closed) {
    const key = tradeKey(t)
    if (stillOpen.has(key)) continue
    const risk = tradeRisk(t)
    const prev = byKey.get(key)
    byKey.set(key, {
      market: t.market,
      entryTime: t.entryTime,
      exitTime: Math.max(prev?.exitTime ?? 0, t.exitTime),
      pnl: (prev?.pnl ?? 0) + t.pnl,
      risk: (prev?.risk ?? 0) + risk,
      r: null,
    })
  }
  return [...byKey.values()]
    .map((t) => ({ ...t, r: t.risk > 0 ? t.pnl / t.risk : null }))
    .sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime)
}

export interface LiveStats {
  /** Whole closed trades. */
  trades: number
  wins: number
  /** Share of closed trades that made money after fees; null with no trades. */
  winRate: number | null
  /** Average R per closed trade (net of fees); null with none to measure. */
  avgR: number | null
  /** Most losing (or $0) trades in a row, by exit time. */
  worstStreak: number
  /** Biggest drop of the balance from a high, as a share of that high, closed parts only. */
  maxDrawdown: number
}

/** Live stats from an account's closed trades. `startMoney` is where its balance began. */
export function liveStats(
  closed: ClosedLiveTrade[],
  startMoney: number,
  open: LiveTrade[] = [],
): LiveStats {
  const trades = tradeResults(closed, open)
  const wins = trades.filter((t) => t.pnl > 0).length
  const rs = trades.flatMap((t) => (t.r == null ? [] : [t.r]))
  let streak = 0
  let worstStreak = 0
  for (const t of trades) {
    streak = t.pnl > 0 ? 0 : streak + 1
    worstStreak = Math.max(worstStreak, streak)
  }
  // The balance moves at every booked close, a first-target half too.
  let balance = startMoney
  let peak = startMoney
  let maxDrawdown = 0
  for (const c of [...closed].sort((a, b) => a.exitTime - b.exitTime)) {
    balance += c.pnl
    peak = Math.max(peak, balance)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - balance) / peak)
  }
  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : null,
    avgR: rs.length ? rs.reduce((a, r) => a + r, 0) / rs.length : null,
    worstStreak,
    maxDrawdown,
  }
}

export interface CompareRow {
  id: string
  name: string
  past: PastTest
  /** Balance plus open trades at the last check, minus the start money. */
  pnl: number
  money: number
  open: (LiveTrade & { pnl: number })[]
  closed: ClosedLiveTrade[]
  stats: LiveStats
  /** When its account got its money (ms). */
  since: number
  /** Days since then, as a decimal. */
  days: number
}

/** One row per strategy account in the race. */
export function compareRows(state: RaceState, nowMs: number): CompareRow[] {
  return summarize(state).map((s) => {
    const since = Math.max(state.startedAt, JOINED_AT[s.ruleId] ?? 0)
    return {
      id: s.ruleId,
      name: s.name,
      past: PAST_TESTS[s.ruleId] ?? NO_PAST_TEST,
      pnl: s.pnl,
      money: s.money,
      open: s.open,
      closed: s.closed,
      stats: liveStats(s.closed, state.startMoney, s.open),
      since,
      days: Math.max(0, (nowMs - since) / 86_400_000),
    }
  })
}

export type SortKey = 'evidence' | 'pnl' | 'winRate'

export const SORT_TEXT: Record<SortKey, string> = {
  evidence: 'Evidence',
  pnl: 'Live P&L',
  winRate: 'Win rate',
}

/** Nulls (no trades yet) go last. */
const desc = (a: number | null, b: number | null) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a

/**
 * Evidence: a passed test first, then live only, then a lost test; inside
 * each, the best live average R first. Live P&L: most money first. Win rate:
 * best first, more trades first on a tie. Ties end on the name.
 */
export function sortRows(rows: CompareRow[], key: SortKey): CompareRow[] {
  const by: Record<SortKey, (a: CompareRow, b: CompareRow) => number> = {
    evidence: (a, b) =>
      EVIDENCE_RANK[a.past.evidence] - EVIDENCE_RANK[b.past.evidence] ||
      desc(a.stats.avgR, b.stats.avgR) ||
      b.pnl - a.pnl,
    pnl: (a, b) => b.pnl - a.pnl,
    winRate: (a, b) => desc(a.stats.winRate, b.stats.winRate) || b.stats.trades - a.stats.trades,
  }
  return [...rows].sort((a, b) => by[key](a, b) || a.name.localeCompare(b.name))
}
