'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronDown, ChevronRight, RefreshCw, Scale, TriangleAlert } from 'lucide-react'
import { DemoBadge } from '@/components/paper/DemoBadge'
import { fetchCryptoCandles, fetchForexOHLC } from '@/lib/data'
import { FEE_RATE, LEVERAGE } from '@/lib/paper/engine'
import { getInstrument, INSTRUMENTS, type PriceMap } from '@/lib/paper/instruments'
import { backtest } from '@/lib/rules/engine'
import { ruleInstrumentIds } from '@/lib/rules/data'
import { BUILT_IN_RULES } from '@/lib/rules/presets'
import { RACE_ONLY_MARKETS } from '@/lib/race/labBots'
import { RACE_SIZING } from '@/lib/race/account'
import {
  rankEntries,
  scoreStrategy,
  type Candidate,
  type RaceEntry,
  type TradeMoney,
  WINDOW_DAYS,
  windowStart,
} from '@/lib/race/leaderboard'
import { openPnl, REASON_TEXT, type ClosedLiveTrade, type RaceState } from '@/lib/race/live'
import {
  compareRows,
  EVIDENCE_TEXT,
  SORT_TEXT,
  sortRows,
  type CompareRow,
  type Evidence,
  type SortKey,
} from '@/lib/race/compare'
import { FUNDED, FUNDED_SIZES, fundedOf, fundedView, sizeLabel } from '@/lib/race/funded'
import { useFundedSize } from '@/lib/hooks/useFundedSize'
import { sizingLine, sizingOf, usdPerQuoteFor } from '@/lib/sizing/sizing'
import type { RuleTimeframe } from '@/lib/rules/schema'
import type { OHLCCandle } from '@/lib/types/market'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Checklist } from '@/components/home/Checklist'
import { CHECKLIST_NOTE, type TradeChecks } from '@/lib/race/checklist'

const RULES = BUILT_IN_RULES.map((rule) => ({
  rule,
  markets: ruleInstrumentIds(rule, INSTRUMENTS),
}))
const NAME = new Map(BUILT_IN_RULES.map((r) => [r.id, r.name]))
const sym = (id: string) =>
  getInstrument(id)?.label ?? getInstrument(id)?.symbol ?? RACE_ONLY_MARKETS[id]?.label ?? id
const TF = new Map(BUILT_IN_RULES.map((r) => [r.id, r.timeframe]))
const isForex = (id: string) => getInstrument(id)?.market === 'forex'
/** Forex loads two years so a one-year window still has a year to warm up the 200 EMA. */
const FOREX_DAYS = 730

const money = (n: number, opts: { sign?: boolean; cents?: boolean } = {}) => {
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })
  const neg = n < 0 && abs.replace(/[0,.]/g, '') !== ''
  return `${neg ? '-' : opts.sign && n > 0 ? '+' : ''}$${abs}`
}
const color = (n: number) =>
  n > 0.004 ? 'var(--green)' : n < -0.004 ? 'var(--red)' : 'var(--text-secondary)'
const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`)
/** Size line for a race trade: lots or coins, $ per pip, risk, goal, R:R. */
const sizeOf = (
  t: {
    market: string
    units: number
    entry: number
    stop: number
    takeProfit: number
    usdPerQuote: number
  },
  scale = 1,
) => {
  const inst = getInstrument(t.market)
  return sizingLine(
    inst,
    sizingOf({
      inst,
      units: t.units * scale,
      entry: t.entry,
      stop: t.stop,
      target: t.takeProfit,
      usdPerQuote: t.usdPerQuote,
    }),
  )
}
const limitsText = `at most ${RACE_SIZING.maxOpen} trades open, total open risk at most ${RACE_SIZING.maxOpenRiskPct}% of the balance, and a position can only use the free balance times its leverage (crypto 1:1, gold 20:1, forex 30:1)`
const when = (sec: number) =>
  new Date(sec * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const CANDLE_SEC = { '1h': 3_600, '4h': 14_400, '1d': 86_400 } as const

export default function ComparePage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Scale size={20} color="var(--indigo)" aria-hidden />
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Compare</h1>
        <DemoBadge />
      </div>
      <p style={{ fontSize: 15, fontWeight: 500, marginTop: 6 }}>
        Which strategy is worth backing.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
        The funded test first, then every strategy side by side: how it does live and what its past
        tests showed. The rules behind each one are on{' '}
        <Link href="/strategies" style={{ color: 'var(--indigo)', padding: '14px 0' }}>
          Strategies
        </Link>
        .
      </p>

      <div role="note" style={warn}>
        <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
        <span>
          Play money only, nothing here touches a broker or real money. A few weeks to a year of
          past candles and a few weeks of live ticks are mostly luck: a winner here can lose next
          month.
        </span>
      </div>

      <FundedLive />
      <Comparison />
      <PastResults />
    </div>
  )
}

// ── Past results ─────────────────────────────────────────────────────────

type Load =
  | { state: 'loading'; done: number; total: number; what: string }
  | {
      state: 'done'
      runs: Record<string, { markets: string[]; candidates: Candidate[] }>
      skipped: string[]
      at: number
    }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Last daily close at or before `time`. */
function closeAt(candles: OHLCCandle[] | undefined, time: number): number | undefined {
  if (!candles) return undefined
  for (let i = candles.length - 1; i >= 0; i--) if (candles[i].time <= time) return candles[i].close
  return undefined
}

/**
 * USD per quote unit at a past entry: USD/xxx pairs use their own price,
 * EUR/GBP uses GBP/USD that day. Only the units shown depend on it, not the dollars.
 */
function pastUsdPerQuote(id: string, price: number, time: number, data: Map<string, OHLCCandle[]>) {
  const inst = getInstrument(id)
  const rates: PriceMap = {}
  for (const k of [`${inst?.quote}-USD`, `USD-${inst?.quote}`]) {
    const c = closeAt(data.get(k), time)
    if (c) rates[k] = c
  }
  return usdPerQuoteFor(inst, price, rates) ?? 1
}

/** One fetch per forex pair, and one per coin and candle size some rule uses. */
type Job = { id: string; tf: RuleTimeframe | null }
function loadJobs(): Job[] {
  const markets = [...new Set(RULES.flatMap((r) => r.markets))]
  return markets.flatMap((id): Job[] => {
    if (isForex(id)) return [{ id, tf: null }]
    const tfs = new Set(RULES.filter((r) => r.markets.includes(id)).map((r) => r.rule.timeframe))
    return [...tfs].map((tf) => ({ id, tf }))
  })
}
const jobName = (j: Job) => (j.tf ? `${sym(j.id)} ${j.tf}` : sym(j.id))
const keyName = (k: string) =>
  k
    .split(':')
    .map((x, i) => (i ? x : sym(x)))
    .join(' ')
const dataKey = (id: string, tf: RuleTimeframe) => (isForex(id) ? id : `${id}:${tf}`)

function Backtests({ start }: { start: number }) {
  const markets = useMemo(() => [...new Set(RULES.flatMap((r) => r.markets))], [])
  const jobs = useMemo(() => loadJobs(), [])
  const first: Load = { state: 'loading', done: 0, total: jobs.length, what: jobName(jobs[0]) }
  const [load, setLoad] = useState<Load>(first)
  const [open, setOpen] = useState<string | null>(null)
  const run = useRef(0)

  const go = useCallback(async () => {
    const me = ++run.current
    const data = new Map<string, OHLCCandle[]>()
    const skipped: string[] = []
    // One fetch at a time: Kraken's free public feed allows about one call a
    // second (our route spaces and caches them too). Crypto and gold get real
    // candles per size a rule uses; strategies on the same size share them.
    for (const [n, { id, tf }] of jobs.entries()) {
      const get = () => (tf ? fetchCryptoCandles(id, tf) : fetchForexOHLC(id, FOREX_DAYS))
      try {
        data.set(
          tf ? dataKey(id, tf) : id,
          await get().catch(async () => {
            await sleep(5000)
            return get()
          }),
        )
      } catch {
        skipped.push(tf ? dataKey(id, tf) : id)
      }
      if (tf) await sleep(1100)
      if (run.current !== me) return
      // State only changes after an await, never synchronously inside the effect.
      const next = jobs[n + 1]
      if (next) setLoad({ state: 'loading', done: n + 1, total: jobs.length, what: jobName(next) })
    }
    if (run.current !== me) return
    const nowSec = Math.floor(Date.now() / 1000)
    // Each market's backtest gives the trades the rule would take there; the
    // shared account (scoreStrategy) then decides which it can take.
    const runs: Record<string, { markets: string[]; candidates: Candidate[] }> = {}
    for (const { rule, markets: ids } of RULES) {
      const ran: string[] = []
      const candidates: Candidate[] = []
      for (const id of ids) {
        const candles = data.get(dataKey(id, rule.timeframe))
        if (!candles?.length) continue
        const market = getInstrument(id)?.market ?? 'crypto'
        const result = backtest(
          { ...rule, timeframe: market === 'forex' ? '1d' : rule.timeframe },
          candles,
          {
            startEquity: 1,
            feeRate: FEE_RATE[market],
            leverage: LEVERAGE[market],
            // Every market trades only the rule's window; older candles warm up the indicators.
            tradeFrom: windowStart(rule.timeframe, nowSec),
          },
        )
        ran.push(id)
        for (const t of result.trades)
          candidates.push({
            ...t,
            market: id,
            usdPerQuote: pastUsdPerQuote(id, t.entry, t.entryTime, data),
            feeRate: FEE_RATE[market],
            leverage: LEVERAGE[market],
            candleSec: market === 'forex' ? 86_400 : CANDLE_SEC[rule.timeframe],
          })
      }
      runs[rule.id] = { markets: ran, candidates }
    }
    setLoad({ state: 'done', runs, skipped, at: Date.now() })
  }, [jobs])

  useEffect(() => {
    // Kick off once on open; a newer run (or leaving the page) stops the old loop.
    const runs = run
    const t = setTimeout(() => void go(), 0)
    return () => {
      clearTimeout(t)
      runs.current++
    }
  }, [go])

  const entries = useMemo(() => {
    if (load.state !== 'done') return []
    return rankEntries(
      RULES.map(({ rule, markets: ids }) =>
        scoreStrategy({
          ruleId: rule.id,
          start,
          markets: load.runs[rule.id]?.markets ?? [],
          candidates: load.runs[rule.id]?.candidates ?? [],
          skipped: ids.filter((id) => load.skipped.includes(dataKey(id, rule.timeframe))),
          days: WINDOW_DAYS[rule.timeframe],
        }),
      ),
    )
  }, [load, start])

  const winner = entries[0]

  return (
    <div>
      <div style={{ ...sectionHead, marginTop: 12 }}>
        <button
          style={ghost}
          onClick={() => {
            setLoad(first)
            void go()
          }}
          disabled={load.state === 'loading'}
          aria-label="Run the past results again"
        >
          <RefreshCw size={14} /> {load.state === 'loading' ? 'Running…' : 'Run again'}
        </button>
      </div>
      <p style={small}>
        Backtest on past candles, fees included. Each strategy trades one {money(start)} account
        across every market it can trade (up to {markets.length}): the trades from all its markets
        go into that one account in time order, and each one risks {RACE_SIZING.riskPct}% of the
        balance at that moment (about {money((start * RACE_SIZING.riskPct) / 100)} at the start).
        Like a real account: {limitsText}. A market whose data did not load is left out. Each
        strategy trades only as far back as real candles of its size go: {WINDOW_DAYS['1h']} days
        for 1h rules, {WINDOW_DAYS['4h']} days for 4h rules, {WINDOW_DAYS['1d']} days for daily
        rules. Windows differ, so compare the a-month column too.
      </p>
      <CandleNote />

      {load.state === 'loading' ? (
        <div style={{ marginTop: 14 }} role="status" aria-live="polite">
          <p style={{ fontSize: 13 }}>
            Loading candles for {load.what} ({load.done + 1} of {load.total})…
          </p>
          <div style={barTrack}>
            <div style={{ ...barFill, width: `${(load.done / load.total) * 100}%` }} />
          </div>
          <p style={{ ...small, marginTop: 6 }}>
            One at a time so the free data feeds do not block us. About a minute.
          </p>
        </div>
      ) : (
        <>
          {winner && (
            <p style={{ fontSize: 15, marginTop: 14, lineHeight: 1.5 }}>
              {winner.trades === 0 ? (
                'No strategy traded in its window.'
              ) : (
                <>
                  Most money: <b>{NAME.get(winner.ruleId)}</b> turned {money(start)} into{' '}
                  <b style={{ color: color(winner.profit) }}>{money(winner.end)}</b> in the past{' '}
                  {winner.days} days ({money(winner.profit, { sign: true })}, about{' '}
                  {money(winner.perMonth, { sign: true, cents: Math.abs(winner.perMonth) < 10 })} a
                  month).
                  {winner.profit <= 0 && ' Even the best one lost money after fees.'}
                </>
              )}
            </p>
          )}
          <ol style={list} aria-label="Past results leaderboard">
            {entries.map((e, i) => (
              <li key={e.ruleId} style={{ borderTop: '0.5px solid var(--border)' }}>
                <button
                  style={rowBtn}
                  aria-expanded={open === e.ruleId}
                  onClick={() => setOpen(open === e.ruleId ? null : e.ruleId)}
                >
                  <RowTop
                    rank={i + 1}
                    name={NAME.get(e.ruleId) ?? e.ruleId}
                    value={money(e.end)}
                    delta={e.profit}
                    expanded={open === e.ruleId}
                  />
                  <span style={rowStats}>
                    <span>
                      past {e.days} days ({TF.get(e.ruleId)} candles)
                    </span>
                    <span>
                      {money(e.perMonth, { sign: true, cents: Math.abs(e.perMonth) < 10 })}/mo
                    </span>
                    <span>
                      {e.trades} trade{e.trades === 1 ? '' : 's'}
                    </span>
                    {e.passed > 0 && <span>{e.passed} left out by the limits</span>}
                    <span>{pct(e.winRate)} wins</span>
                    <span>max drop {(e.maxDrawdown * 100).toFixed(1)}%</span>
                    <span>best {e.best ? sym(e.best) : '-'}</span>
                  </span>
                </button>
                {open === e.ruleId && <BacktestDetail entry={e} />}
              </li>
            ))}
          </ol>
          {load.skipped.length > 0 && (
            <p style={{ ...small, color: 'var(--amber)' }}>
              Skipped after a retry (free data feed busy): {load.skipped.map(keyName).join(', ')}.
              Their share stayed as cash. Press Run again in a minute.
            </p>
          )}
          <p style={small}>
            Ran {when(load.at / 1000)}. In 1h and 4h windows the first candles only warm up the
            indicators. Forex daily highs and lows are estimated, so its stops are rough.
          </p>
        </>
      )}
    </div>
  )
}

function RowTop({
  rank,
  name,
  value,
  delta,
  expanded,
}: {
  rank: number
  name: string
  value: string
  delta: number
  expanded: boolean
}) {
  const Icon = expanded ? ChevronDown : ChevronRight
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span style={rankBadge(rank)}>{rank}</span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 14 }}>{name}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{value}</span>
        <span style={{ display: 'block', fontSize: 12, color: color(delta) }}>
          {money(delta, { sign: true })}
        </span>
      </span>
      <Icon size={16} color="var(--text-secondary)" aria-hidden />
    </span>
  )
}

function BacktestDetail({ entry }: { entry: RaceEntry }) {
  const [all, setAll] = useState(false)
  const trades = [...entry.markets.flatMap((m) => m.trades)].sort((a, b) => b.exitTime - a.exitTime)
  const shown = all ? trades : trades.slice(0, 20)
  return (
    <div style={detail}>
      <div style={{ overflowX: 'auto' }}>
        <table style={table}>
          <caption style={caption}>Per market (all in one {money(entry.start)} account)</caption>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Market</th>
              <th style={th}>Candles</th>
              <th style={th}>Trades</th>
              <th style={th}>Profit</th>
            </tr>
          </thead>
          <tbody>
            {[...entry.markets]
              .sort((a, b) => b.profit - a.profit)
              .map((m) => (
                <tr key={m.id}>
                  <td style={{ ...td, textAlign: 'left' }}>{sym(m.id)}</td>
                  <td style={td}>{candleKind(m.id, TF.get(entry.ruleId))}</td>
                  <td style={td}>{m.trades.length}</td>
                  <td style={{ ...td, color: color(m.profit) }}>
                    {money(m.profit, { sign: true, cents: true })}
                  </td>
                </tr>
              ))}
            {entry.skipped.map((id) => (
              <tr key={id}>
                <td style={{ ...td, textAlign: 'left' }}>{sym(id)}</td>
                <td style={td} colSpan={3}>
                  skipped, no data
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TradeList
        title={`Trades, newest first (${trades.length})`}
        trades={shown.map((t) => ({
          key: `${t.market}-${t.entryTime}`,
          market: t.market,
          direction: t.direction,
          time: t.exitTime,
          how: reasonText(t),
          pnl: t.pnl,
          size: `${sizeOf(t)} · from a ${money(t.balanceAtEntry)} balance`,
        }))}
        empty="No trades in this window."
      />
      {trades.length > 20 && (
        <button style={{ ...ghost, marginTop: 8 }} onClick={() => setAll(!all)}>
          {all ? 'Show the latest 20' : `Show all ${trades.length} trades`}
        </button>
      )}
    </div>
  )
}

/** Why a live race trade closed, in plain words. */
const liveHow = (t: Pick<ClosedLiveTrade, 'reason' | 'part1Of'>) =>
  t.part1Of ? `first target, ${Math.round(t.part1Of * 100)}% closed` : REASON_TEXT[t.reason]

const reasonText = (t: TradeMoney) =>
  t.reason === 'target' ? 'hit target' : t.reason === 'stop' ? 'hit stop' : 'still open at the end'

function TradeList({
  title,
  trades,
  empty,
  checklist = false,
}: {
  title: string
  trades: {
    key: string
    market: string
    direction: 'long' | 'short'
    time: number
    how: string
    pnl: number
    /** Size line: lots or coins, $ per pip, risk, goal, R:R. */
    size?: string
    /** Live race trades: the confidence checklist at entry. */
    checks?: TradeChecks
  }[]
  empty: string
  /** Live race trades: show each one's checklist (older ones say "not checked"). */
  checklist?: boolean
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{title}</p>
      {trades.length === 0 ? (
        <p style={small}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {trades.map((t) => (
            <li
              key={t.key}
              // Taller rows with a checklist: the side and P&L stay level with the market.
              style={checklist ? { ...tradeRow, alignItems: 'flex-start' } : tradeRow}
            >
              <span
                style={{
                  color: t.direction === 'long' ? 'var(--green)' : 'var(--red)',
                  fontWeight: 600,
                  width: 34,
                }}
              >
                {t.direction === 'long' ? 'BUY' : 'SELL'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {sym(t.market)}{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {t.how}, {when(t.time)}
                </span>
                {t.size && <span style={sizeLine}>{t.size}</span>}
                {checklist && (
                  <div style={{ marginTop: 4 }}>
                    <Checklist checks={t.checks} fontSize={11} note={false} />
                  </div>
                )}
              </div>
              <span style={{ color: color(t.pnl), fontVariantNumeric: 'tabular-nums' }}>
                {money(t.pnl, { sign: true, cents: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {checklist && trades.some((t) => t.checks) && <p style={small}>{CHECKLIST_NOTE}</p>}
    </div>
  )
}

const candleKind = (id: string, tf: RuleTimeframe | undefined) =>
  isForex(id) ? 'daily' : (tf ?? '-')

/** Which candles each market group uses, so fewer forex trades make sense. */
function CandleNote() {
  const count = (m: string) => INSTRUMENTS.filter((i) => i.market === m).length
  const forex =
    'past results: daily candles only (free ECB rates), so forex rules trade far less and 1h/4h rules run on daily candles there. The live race uses real Kraken candles for GBP/USD, EUR/GBP, EUR/USD, USD/CAD, USD/CHF and AUD/USD, and GBP/JPY computed from GBP/USD; USD/JPY and NZD/USD stay daily'
  const items = [
    {
      k: `Crypto (${count('crypto')})`,
      v: "real 1h, 4h and 1d candles from Kraken (free public data), in each rule's own size",
    },
    { k: 'Gold (1)', v: 'real Kraken candles too, price tracked by PAX Gold' },
    { k: `Forex (${count('forex')})`, v: forex },
  ]
  return (
    <ul aria-label="Candles per market" style={candleList}>
      {items.map((i) => (
        <li key={i.k}>
          <b style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{i.k}:</b> {i.v}
        </li>
      ))}
    </ul>
  )
}

// ── Live from today ──────────────────────────────────────────────────────

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`race ${res.status}`)
  return res.json() as Promise<{ state: RaceState | null; installed: boolean }>
}

/** The funded test (src/lib/race/funded.ts): the account Today follows. */
function FundedLive() {
  const { data } = useSWR('/api/race', fetcher, { refreshInterval: 60_000 })
  const [now] = useState(() => Date.now())
  const [size, setSize] = useFundedSize()
  const state = data?.state ?? null
  if (!state) return null
  const nowSec = Math.floor(now / 1000)
  const f = fundedOf(state, size)
  const v = f ? fundedView(f, state.prices, nowSec) : null
  const nameOf = (id: string) => state.strategies[id]?.name ?? id
  const cell: React.CSSProperties = { minWidth: 0, textAlign: 'right' }
  const cols = '3.4em minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 0.9fr) 4.2em'
  return (
    <section style={{ ...card, marginTop: 16 }} aria-labelledby="funded-title">
      <div style={sectionHead}>
        <h2 id="funded-title" style={h2}>
          {FUNDED.name}: four sizes
        </h2>
      </div>
      {/* One string: JSX text with entities can lose a space here (docs/dashboard.md, Gotcha). */}
      <p style={small}>
        {`Four play accounts, ${FUNDED_SIZES.map(sizeLabel).join(', ')}, with the same rules: each takes only John's London v1 signals (GBP/USD and gold) at the same moment, with v1's own exits, and every limit is the same share of its size. ${FUNDED.sizing.riskPct}% risk per trade, rounded down to 0.01 lot, at most ${FUNDED.sizing.maxOpen} open and ${FUNDED.maxNewPerDay} new a day. FTMO 2-Step limits: a day that loses ${FUNDED.dailyLossPct}% of the start (counted from the day's opening balance) or money ${FUNDED.maxLossPct}% under the start fails it; +${FUNDED.targetPct}% after at least ${FUNDED.minDays} trading days passes it. A new trade opens only if the day's worst case, every open trade hitting its stop, stays under ${FUNDED.worstCasePct}% of the start. Every other strategy trades only in its own play account, compared below. Tap a size for its trades; Today shows the same size.`}
      </p>
      <div role="group" aria-label="Funded test sizes" style={{ marginTop: 12, fontSize: 13 }}>
        <div
          aria-hidden
          style={{
            display: 'grid',
            gridTemplateColumns: cols,
            gap: 6,
            padding: '0 10px 4px',
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          <span>Size</span>
          <span style={cell}>Balance</span>
          <span style={cell}>P&amp;L</span>
          <span style={cell}>Day loss</span>
          <span style={cell}>Status</span>
        </div>
        {FUNDED_SIZES.map((s) => {
          const a = fundedOf(state, s)
          const av = a ? fundedView(a, state.prices, nowSec) : null
          const on = s === size
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              aria-label={
                av
                  ? `${sizeLabel(s)}: balance ${money(a!.balance)}, ${money(av.result, { sign: true })}, day loss ${((av.dayLoss / s) * 100).toFixed(1)}% of ${FUNDED.dailyLossPct}%, ${av.status}`
                  : `${sizeLabel(s)}: starts at the next race check`
              }
              onClick={() => setSize(s)}
              style={{
                display: 'grid',
                gridTemplateColumns: cols,
                gap: 6,
                alignItems: 'center',
                width: '100%',
                minHeight: 44,
                padding: '0 10px',
                marginTop: 4,
                borderRadius: 8,
                border: `1px solid ${on ? 'var(--text-primary)' : 'var(--border)'}`,
                background: on ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-primary)',
                font: 'inherit',
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <b style={{ fontWeight: 600 }}>{sizeLabel(s)}</b>
              {a && av ? (
                <>
                  <span style={cell}>{money(a.balance)}</span>
                  <span style={{ ...cell, color: color(av.result) }}>
                    {money(av.result, { sign: true })}
                  </span>
                  <span style={cell}>{`${((av.dayLoss / s) * 100).toFixed(1)}%`}</span>
                  <span
                    style={{
                      ...cell,
                      color:
                        av.status === 'failed'
                          ? 'var(--red)'
                          : av.status === 'passed'
                            ? 'var(--green)'
                            : 'var(--text-secondary)',
                    }}
                  >
                    {av.status === 'active'
                      ? 'Active'
                      : av.status === 'passed'
                        ? 'Passed'
                        : 'Failed'}
                  </span>
                </>
              ) : (
                <span style={{ ...cell, gridColumn: '2 / -1', color: 'var(--text-secondary)' }}>
                  Starts at the next check
                </span>
              )}
            </button>
          )
        })}
        <p style={{ ...small, marginTop: 6 }}>
          {`Balance counts closed trades; P&L adds the open ones at the last check. Day loss is the share of the start lost since the day began (the limit is ${FUNDED.dailyLossPct}%).`}
        </p>
      </div>
      {!f || !v ? (
        <p style={{ fontSize: 13, marginTop: 12 }}>
          {`The ${sizeLabel(size)} account starts with ${money(size)} at the next race check.`}
        </p>
      ) : (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 16 }}>
            {`${sizeLabel(size)}, started ${when(f.startedAt / 1000)}`}
          </h3>
          <p style={{ fontSize: 13, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            <b>{money(v.money, { cents: true })}</b>{' '}
            <span style={{ color: color(v.result) }}>
              {money(v.result, { sign: true, cents: true })}
            </span>
            {` · ${v.status} · ${v.days} of ${FUNDED.minDays} trading days · day loss ${money(v.dayLoss)} of ${money(v.dayLimit)}`}
          </p>
          {v.statusNote && (
            <p style={{ ...small, color: v.status === 'failed' ? 'var(--red)' : 'var(--green)' }}>
              {v.status === 'failed' ? 'Failed' : 'Passed'}: {v.statusNote}.
            </p>
          )}
          <TradeList
            title={`Open trades (${f.open.length}), P&L at the last check`}
            trades={f.open.map((t) => ({
              key: `${t.market}-${t.entryTime}`,
              market: t.market,
              direction: t.direction,
              time: t.entryTime,
              how: `opened from ${nameOf(t.strategy)}`,
              pnl: openPnl(t, state.prices[t.market]),
              size: sizeOf(t),
              checks: t.checks,
            }))}
            empty="No open trades."
            checklist
          />
          <TradeList
            title={`Closed trades (${f.closed.length}), fees included`}
            trades={[...f.closed].reverse().map((t) => ({
              key: `${t.market}-${t.entryTime}${t.part1Of ? '-part' : ''}`,
              market: t.market,
              direction: t.direction,
              time: t.exitTime,
              how: `${liveHow(t)}, from ${nameOf(t.strategy)}`,
              pnl: t.pnl,
              size: sizeOf(t),
              checks: t.checks,
            }))}
            empty="No closed trades yet."
            checklist
          />
        </>
      )}
    </section>
  )
}

// ── Every strategy, side by side ─────────────────────────────────────────

const rText = (r: number | null) =>
  r == null ? '-' : `${r > 0.004 ? '+' : r < -0.004 ? '-' : ''}${Math.abs(r).toFixed(2)}R`
const dropText = (d: number) => `${(d * 100).toFixed(1)}%`
const daysText = (d: number) => (d < 1 ? 'under 1' : String(Math.floor(d)))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const EVIDENCE_STYLE: Record<Evidence, React.CSSProperties> = {
  passed: { color: 'var(--green)', background: 'var(--green-dim)' },
  live: { color: 'var(--text-secondary)', background: 'var(--bg-hover)' },
  lost: { color: 'var(--red)', background: 'var(--red-dim)' },
}

function EvidenceTag({ evidence }: { evidence: Evidence }) {
  return (
    <span className="cmp-tag" style={{ ...tag, ...EVIDENCE_STYLE[evidence] }}>
      {EVIDENCE_TEXT[evidence]}
    </span>
  )
}

function Comparison() {
  const { data, error, isLoading } = useSWR('/api/race', fetcher, { refreshInterval: 60_000 })
  const [now] = useState(() => Date.now())
  const [sort, setSort] = useState<SortKey>('evidence')
  const [open, setOpen] = useState<string | null>(null)
  const state = data?.state ?? null
  const rows = useMemo(
    () => (state ? sortRows(compareRows(state, now), sort) : []),
    [state, now, sort],
  )
  const lastTick = state?.ticks.at(-1)

  return (
    <section style={{ ...card, marginTop: 16 }} aria-labelledby="cmp-title">
      <h2 id="cmp-title" style={h2}>
        Every strategy, side by side
      </h2>
      <p style={small}>
        {`Each strategy trades its own ${money(state?.startMoney ?? 10_000)} play account on its own signals, ${RACE_SIZING.riskPct}% risk a trade, new trades only from 02:00 to 12:30 AST on weekdays. Live numbers count closed trades, fees included; P&L also adds open trades at the last check. R is what a trade risked at its stop: +1R won that much, -1R lost a full stop.`}
      </p>

      <div
        role="group"
        aria-label="Sort by"
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Sort by</span>
        <span style={segment}>
          {(Object.keys(SORT_TEXT) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={sort === k}
              onClick={() => setSort(k)}
              style={{
                ...segmentBtn,
                background: sort === k ? 'var(--text-primary)' : 'transparent',
                color: sort === k ? 'var(--bg-primary)' : 'var(--text-secondary)',
              }}
            >
              {SORT_TEXT[k]}
            </button>
          ))}
        </span>
      </div>

      {isLoading ? (
        <p style={{ ...small, marginTop: 12 }}>Loading the live race…</p>
      ) : error ? (
        <p style={{ ...small, color: 'var(--red)', marginTop: 12 }}>
          Could not read the live race file. Run <code>make race-tick</code> again.
        </p>
      ) : !state ? (
        <p style={{ fontSize: 13, marginTop: 12 }}>
          Not started on this computer yet. Run <code>make race-tick</code> on the Mac Mini to start
          it.
        </p>
      ) : (
        <>
          <div className="cmp-scroll" style={{ marginTop: 12 }}>
            <div className="cmp-table">
              <div className="cmp-head" aria-hidden style={headRow}>
                <span style={{ gridArea: 'name' }}>Strategy</span>
                <span style={{ gridArea: 'pnl', textAlign: 'right' }}>Live P&amp;L</span>
                <span style={{ gridArea: 'c1', textAlign: 'right' }}>Trades</span>
                <span style={{ gridArea: 'c2', textAlign: 'right' }}>Win rate</span>
                <span style={{ gridArea: 'c3', textAlign: 'right' }}>Avg R</span>
                <span style={{ gridArea: 'c4', textAlign: 'right' }}>Loss streak</span>
                <span style={{ gridArea: 'c5', textAlign: 'right' }}>Max drop</span>
                <span style={{ gridArea: 'c6', textAlign: 'right' }}>Days</span>
              </div>
              <ol style={{ ...list, margin: 0 }} aria-label="Strategies compared">
                {rows.map((r) => (
                  <CompareItem
                    key={r.id}
                    row={r}
                    open={open === r.id}
                    onToggle={() => setOpen(open === r.id ? null : r.id)}
                  />
                ))}
              </ol>
            </div>
          </div>
          <p style={{ ...small, borderTop: '0.5px dashed var(--border)', paddingTop: 10 }}>
            John&apos;s video method gets its row here once its rules are written down and it joins
            the race.
          </p>
          <p style={small}>
            {`${plural(state.tickCount, 'check')} so far${lastTick ? `, last one ${when(lastTick.at / 1000)}` : ''}. A few days of live trades say almost nothing: give it weeks and dozens of trades before trusting any order here.`}
          </p>
          {!data?.installed && (
            <p style={{ ...small, color: 'var(--amber)' }}>
              The hourly job is not installed yet, so checks only run by hand with{' '}
              <code>make race-tick</code>. Install steps are in docs/strategy-race.md.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function CompareItem({
  row: r,
  open,
  onToggle,
}: {
  row: CompareRow
  open: boolean
  onToggle: () => void
}) {
  const s = r.stats
  const Icon = open ? ChevronDown : ChevronRight
  const label = `${r.name}, ${EVIDENCE_TEXT[r.past.evidence]}, live ${money(r.pnl, { sign: true, cents: true })}, ${plural(s.trades, 'closed trade')}, ${pct(s.winRate)} won, average ${rText(s.avgR)}, worst losing streak ${s.worstStreak}, max drop ${dropText(s.maxDrawdown)}, ${daysText(r.days)} days live`
  return (
    <li style={{ borderTop: '0.5px solid var(--border)' }}>
      <button
        type="button"
        className="cmp-row"
        // .cmp-row (globals.css) sets the grid, so no display here.
        style={{ ...rowBtn, display: undefined }}
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
      >
        <span style={{ gridArea: 'name', minWidth: 0, fontWeight: 500, fontSize: 14 }}>
          {r.name}
        </span>
        <EvidenceTag evidence={r.past.evidence} />
        <span style={{ ...numCell, gridArea: 'pnl', fontWeight: 600, color: color(r.pnl) }}>
          {money(r.pnl, { sign: true, cents: true })}
        </span>
        <span className="cmp-col" style={{ ...numCell, gridArea: 'c1' }}>
          {s.trades}
        </span>
        <span className="cmp-col" style={{ ...numCell, gridArea: 'c2' }}>
          {pct(s.winRate)}
        </span>
        <span className="cmp-col" style={{ ...numCell, gridArea: 'c3' }}>
          {rText(s.avgR)}
        </span>
        <span className="cmp-col" style={{ ...numCell, gridArea: 'c4' }}>
          {s.worstStreak}
        </span>
        <span className="cmp-col" style={{ ...numCell, gridArea: 'c5' }}>
          {dropText(s.maxDrawdown)}
        </span>
        <span className="cmp-col" style={{ ...numCell, gridArea: 'c6' }}>
          {daysText(r.days)}
        </span>
        <span className="cmp-brief" style={brief}>
          {s.trades
            ? `${plural(s.trades, 'trade')} · ${pct(s.winRate)} won · ${rText(s.avgR)} avg`
            : 'No closed trades yet'}
        </span>
        <Icon size={16} color="var(--text-secondary)" aria-hidden style={{ gridArea: 'chev' }} />
      </button>
      {open && <CompareDetail row={r} />}
    </li>
  )
}

function CompareDetail({ row: r }: { row: CompareRow }) {
  const s = r.stats
  const cells: [string, string, string?][] = [
    ['Live P&L', money(r.pnl, { sign: true, cents: true }), color(r.pnl)],
    ['Closed trades', String(s.trades)],
    ['Win rate', pct(s.winRate)],
    ['Average R per trade', rText(s.avgR)],
    ['Worst losing streak', s.worstStreak ? `${s.worstStreak} in a row` : 'none'],
    ['Max drop', dropText(s.maxDrawdown)],
    ['Days live', daysText(r.days)],
  ]
  return (
    <div style={detail}>
      <dl className="cmp-narrow" style={statGrid}>
        {cells.map(([dt, dd, c]) => (
          <div key={dt}>
            <dt style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{dt}</dt>
            <dd
              style={{ margin: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c }}
            >
              {dd}
            </dd>
          </div>
        ))}
      </dl>
      <p style={{ fontSize: 12, lineHeight: 1.5 }}>
        <b style={{ fontWeight: 600 }}>Past test: </b>
        {r.past.text}
      </p>
      <p style={small}>
        {`Live since ${when(r.since / 1000)}: ${money(r.money, { cents: true })} now, ${r.open.length} open.`}
      </p>
      <TradeList
        title={`Open trades (${r.open.length}), P&L at the last check`}
        trades={r.open.map((t) => ({
          key: `${t.market}-${t.entryTime}`,
          market: t.market,
          direction: t.direction,
          time: t.entryTime,
          how: 'opened',
          pnl: t.pnl,
          size: sizeOf(t),
          checks: t.checks,
        }))}
        empty="No open trades."
        checklist
      />
      <TradeList
        title={`Closed trades (${r.closed.length}), fees included`}
        trades={[...r.closed].reverse().map((t) => ({
          key: `${t.market}-${t.entryTime}${t.part1Of ? '-part' : ''}`,
          market: t.market,
          direction: t.direction,
          time: t.exitTime,
          how: liveHow(t),
          pnl: t.pnl,
          size: sizeOf(t),
          checks: t.checks,
        }))}
        empty="No closed trades yet."
        checklist
      />
    </div>
  )
}

// ── Past results, folded ─────────────────────────────────────────────────

/** The old backtest leaderboard, last and folded: it loads about a minute of candles when opened. */
function PastResults() {
  const [open, setOpen] = useState(false)
  // The past-results accounts start at $10,000 like the race (John, 2026-11-11); the box rescales.
  const [start, setStart] = useState(10_000)
  const safeStart = start > 0 ? start : 10_000
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <section style={{ ...card, marginTop: 16 }} aria-labelledby="past-title">
      <h2 id="past-title" style={{ margin: 0 }}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="past-body"
          onClick={() => setOpen(!open)}
          style={foldBtn}
        >
          <span style={h2}>Past results</span>
          <Icon size={16} color="var(--text-secondary)" aria-hidden />
        </button>
      </h2>
      <p style={{ ...small, marginTop: 2 }}>
        Each strategy on weeks to a year of recent candles, settings picked by hand: mostly luck, so
        it comes last. Opening it loads the candles (about a minute).
      </p>
      {open && (
        <div id="past-body">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 4px' }}>
            <span style={{ fontSize: 13 }}>Starting money per strategy</span>
            <span style={{ color: 'var(--text-secondary)' }}>$</span>
            <MoneyInput
              value={start}
              onChange={setStart}
              label="Starting money per strategy in dollars"
              style={input}
            />
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            The same for every strategy, so the comparison is fair. Practice money, not real.
          </p>
          <Backtests start={safeStart} />
        </div>
      )}
    </section>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 0,
}
const sectionHead: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const small: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  marginTop: 8,
  lineHeight: 1.5,
}
const warn: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--amber)',
  background: 'var(--amber-dim)',
  border: '0.5px solid var(--amber)',
}
const input: React.CSSProperties = {
  width: 110,
  minHeight: 44,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
}
const ghost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 44,
  padding: '0 14px',
  borderRadius: 8,
  border: '0.5px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  fontSize: 13,
  cursor: 'pointer',
}
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '12px 0 0' }
const rowBtn: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: 44,
  padding: '10px 2px',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}
const rowStats: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2px 12px',
  marginTop: 4,
  paddingLeft: 32,
  fontSize: 12,
  color: 'var(--text-secondary)',
  fontVariantNumeric: 'tabular-nums',
}
const rankBadge = (rank: number): React.CSSProperties => ({
  width: 24,
  height: 24,
  flexShrink: 0,
  borderRadius: 12,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 600,
  color: rank === 1 ? 'var(--bg-primary)' : 'var(--text-secondary)',
  background: rank === 1 ? 'var(--amber)' : 'var(--bg-hover)',
})
const detail: React.CSSProperties = {
  margin: '0 0 12px',
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  fontSize: 12,
}
const barTrack: React.CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: 'var(--bg-hover)',
  marginTop: 8,
  overflow: 'hidden',
}
const barFill: React.CSSProperties = {
  height: '100%',
  background: 'var(--indigo)',
  transition: 'width 0.3s',
}
const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
}
const caption: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  paddingBottom: 4,
}
const th: React.CSSProperties = {
  textAlign: 'right',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  padding: '3px 0 3px 10px',
}
const td: React.CSSProperties = { textAlign: 'right', padding: '4px 0 4px 10px' }
const candleList: React.CSSProperties = {
  listStyle: 'none',
  padding: '8px 10px',
  margin: '8px 0 0',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  display: 'grid',
  gap: 2,
}
const sizeLine: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  fontSize: 11,
  color: 'var(--text-secondary)',
  fontVariantNumeric: 'tabular-nums',
}
const tradeRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderTop: '0.5px solid var(--border)',
}
const tag: React.CSSProperties = {
  gridArea: 'tag',
  justifySelf: 'start',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  whiteSpace: 'nowrap',
}
const segment: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  padding: 4,
  borderRadius: 999,
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
}
const segmentBtn: React.CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  border: 0,
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
}
const headRow: React.CSSProperties = {
  padding: '0 2px 6px',
  fontSize: 11,
  color: 'var(--text-secondary)',
}
const numCell: React.CSSProperties = {
  justifySelf: 'end',
  textAlign: 'right',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
}
const brief: React.CSSProperties = {
  gridArea: 'brief',
  minWidth: 0,
  fontSize: 12,
  color: 'var(--text-secondary)',
  fontVariantNumeric: 'tabular-nums',
}
const statGrid: React.CSSProperties = {
  // display comes from .cmp-narrow (globals.css): a grid on a phone, hidden from 768px.
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px 12px',
  margin: '0 0 10px',
}
const foldBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  minHeight: 44,
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}
