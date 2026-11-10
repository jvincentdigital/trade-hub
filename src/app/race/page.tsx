'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronDown, ChevronRight, RefreshCw, Trophy, TriangleAlert } from 'lucide-react'
import { DemoBadge } from '@/components/paper/DemoBadge'
import { fetchCryptoCandles, fetchForexOHLC } from '@/lib/data'
import { FEE_RATE, LEVERAGE } from '@/lib/paper/engine'
import { getInstrument, INSTRUMENTS, type PriceMap } from '@/lib/paper/instruments'
import { backtest } from '@/lib/rules/engine'
import { ruleInstrumentIds } from '@/lib/rules/data'
import { BUILT_IN_RULES } from '@/lib/rules/presets'
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
import { summarize, type RaceState } from '@/lib/race/live'
import { sizingLine, sizingOf, usdPerQuoteFor } from '@/lib/sizing/sizing'
import type { RuleTimeframe } from '@/lib/rules/schema'
import type { OHLCCandle } from '@/lib/types/market'

const RULES = BUILT_IN_RULES.map((rule) => ({
  rule,
  markets: ruleInstrumentIds(rule, INSTRUMENTS),
}))
const NAME = new Map(BUILT_IN_RULES.map((r) => [r.id, r.name]))
const sym = (id: string) => getInstrument(id)?.label ?? getInstrument(id)?.symbol ?? id
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

export default function RacePage() {
  const [start, setStart] = useState(1000)
  const safeStart = start > 0 ? start : 1000

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Trophy size={20} color="var(--amber)" aria-hidden />
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Strategy race</h1>
        <DemoBadge />
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
        Every strategy gets its own play-money account and trades on its own. Which one makes the
        most money? The rules behind each one are on{' '}
        <Link href="/strategies" style={{ color: 'var(--indigo)' }}>
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

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 4px' }}>
        <span style={{ fontSize: 13 }}>Starting money per strategy</span>
        <span style={{ color: 'var(--text-secondary)' }}>$</span>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          step={100}
          value={start}
          onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
          aria-label="Starting money per strategy in dollars"
          style={input}
        />
      </label>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16 }}>
        The same for every strategy, so the race is fair. Practice money, not real.
      </p>

      <Backtests start={safeStart} />
      <Live start={safeStart} />
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
    <section style={card} aria-labelledby="bt-title">
      <div style={sectionHead}>
        <h2 id="bt-title" style={h2}>
          Past results
        </h2>
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
    </section>
  )
}

function RowTop({
  rank,
  name,
  value,
  delta,
  expanded,
  cents,
}: {
  rank: number
  name: string
  value: string
  delta: number
  expanded: boolean
  cents?: boolean
}) {
  const Icon = expanded ? ChevronDown : ChevronRight
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span style={rankBadge(rank)}>{rank}</span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 14 }}>{name}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{value}</span>
        <span style={{ display: 'block', fontSize: 12, color: color(delta) }}>
          {money(delta, { sign: true, cents })}
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

const reasonText = (t: TradeMoney) =>
  t.reason === 'target' ? 'hit target' : t.reason === 'stop' ? 'hit stop' : 'still open at the end'

function TradeList({
  title,
  trades,
  empty,
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
  }[]
  empty: string
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{title}</p>
      {trades.length === 0 ? (
        <p style={small}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {trades.map((t) => (
            <li key={t.key} style={tradeRow}>
              <span
                style={{
                  color: t.direction === 'long' ? 'var(--green)' : 'var(--red)',
                  fontWeight: 600,
                  width: 34,
                }}
              >
                {t.direction === 'long' ? 'BUY' : 'SELL'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {sym(t.market)}{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {t.how}, {when(t.time)}
                </span>
                {t.size && <span style={sizeLine}>{t.size}</span>}
              </span>
              <span style={{ color: color(t.pnl), fontVariantNumeric: 'tabular-nums' }}>
                {money(t.pnl, { sign: true, cents: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const candleKind = (id: string, tf: RuleTimeframe | undefined) =>
  isForex(id) ? 'daily' : (tf ?? '-')

/** Which candles each market group uses, so fewer forex trades make sense. */
function CandleNote() {
  const count = (m: string) => INSTRUMENTS.filter((i) => i.market === m).length
  const items = [
    {
      k: `Crypto (${count('crypto')})`,
      v: "real 1h, 4h and 1d candles from Kraken (free public data), in each rule's own size",
    },
    { k: 'Gold (1)', v: 'real Kraken candles too, price tracked by PAX Gold' },
    {
      k: `Forex (${count('forex')})`,
      v: 'daily candles only (free ECB rates), so forex rules trade far less and 1h/4h rules run on daily candles there',
    },
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

function Live({ start }: { start: number }) {
  const { data, error, isLoading } = useSWR('/api/race', fetcher, { refreshInterval: 60_000 })
  const [open, setOpen] = useState<string | null>(null)
  const state = data?.state ?? null
  const scale = state ? start / state.startMoney : 1
  const rows = state ? summarize(state) : []
  const lastTick = state?.ticks.at(-1)

  return (
    <section style={{ ...card, marginTop: 16 }} aria-labelledby="live-title">
      <div style={sectionHead}>
        <h2 id="live-title" style={h2}>
          {state ? `Live since ${when(state.startedAt / 1000)}` : 'Live from today'}
        </h2>
      </div>
      <p style={small}>
        A forward test: each tick checks every strategy&apos;s signal on fresh closed candles and
        opens or closes trades in its own play account (one account per strategy, each trade risking{' '}
        {RACE_SIZING.riskPct}% of its balance, same limits and fees as above). Only trades after the
        start count, so nothing here can be fitted to the past.
      </p>
      <CandleNote />

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
          <p style={{ fontSize: 13, marginTop: 12 }}>
            {state.tickCount} tick{state.tickCount === 1 ? '' : 's'} so far
            {lastTick && `, last one ${when(lastTick.at / 1000)}`}
            {lastTick &&
              lastTick.skipped.length > 0 &&
              ` (${lastTick.skipped.length} market${lastTick.skipped.length === 1 ? '' : 's'} skipped, feed busy)`}
            .
          </p>
          {!data?.installed && (
            <p style={{ ...small, color: 'var(--amber)' }}>
              The hourly job is not installed yet, so ticks only run by hand with{' '}
              <code>make race-tick</code>. Install steps are in docs/strategy-race.md.
            </p>
          )}
          {scale !== 1 && (
            <p style={small}>
              The race started with {money(state.startMoney)} each; dollars below are scaled to{' '}
              {money(start)}.
            </p>
          )}
          <ol style={list} aria-label="Live race">
            {rows.map((r, i) => (
              <li key={r.ruleId} style={{ borderTop: '0.5px solid var(--border)' }}>
                <button
                  style={rowBtn}
                  aria-expanded={open === r.ruleId}
                  onClick={() => setOpen(open === r.ruleId ? null : r.ruleId)}
                >
                  <RowTop
                    rank={i + 1}
                    name={r.name}
                    value={money(r.money * scale, { cents: true })}
                    delta={r.pnl * scale}
                    expanded={open === r.ruleId}
                    cents
                  />
                  <span style={rowStats}>
                    <span>{r.open.length} open</span>
                    <span>{r.closed.length} closed</span>
                  </span>
                </button>
                {open === r.ruleId && (
                  <div style={detail}>
                    <TradeList
                      title={`Open trades (${r.open.length}), P&L at the last tick`}
                      trades={r.open.map((t) => ({
                        key: `${t.market}-${t.entryTime}`,
                        market: t.market,
                        direction: t.direction,
                        time: t.entryTime,
                        how: 'opened',
                        pnl: t.pnl * scale,
                        size: sizeOf(t, scale),
                      }))}
                      empty="No open trades."
                    />
                    <TradeList
                      title={`Closed trades (${r.closed.length}), fees included`}
                      trades={[...r.closed].reverse().map((t) => ({
                        key: `${t.market}-${t.entryTime}`,
                        market: t.market,
                        direction: t.direction,
                        time: t.exitTime,
                        how: t.reason === 'target' ? 'hit target' : 'hit stop',
                        pnl: t.pnl * scale,
                        size: sizeOf(t, scale),
                      }))}
                      empty="No closed trades yet."
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p style={small}>
            A few days of live trades say almost nothing. Give it weeks and dozens of trades before
            trusting any ranking.
          </p>
        </>
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
