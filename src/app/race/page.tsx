'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronDown, ChevronRight, RefreshCw, Trophy, TriangleAlert } from 'lucide-react'
import { DemoBadge } from '@/components/paper/DemoBadge'
import { fetchCryptoCandles, fetchForexOHLC } from '@/lib/data'
import { FEE_RATE, LEVERAGE } from '@/lib/paper/engine'
import { getInstrument, INSTRUMENTS } from '@/lib/paper/instruments'
import { backtest } from '@/lib/rules/engine'
import { ruleInstrumentIds } from '@/lib/rules/data'
import { BUILT_IN_RULES } from '@/lib/rules/presets'
import { resample, TF_HOURS } from '@/lib/race/candles'
import {
  RACE_DAYS,
  rankEntries,
  scoreStrategy,
  shareOf,
  type MarketRun,
  type RaceEntry,
  type TradeMoney,
} from '@/lib/race/leaderboard'
import { summarize, type RaceState } from '@/lib/race/live'
import type { OHLCCandle } from '@/lib/types/market'

const RULES = BUILT_IN_RULES.map((rule) => ({
  rule,
  markets: ruleInstrumentIds(rule, INSTRUMENTS),
}))
const NAME = new Map(BUILT_IN_RULES.map((r) => [r.id, r.name]))
const sym = (id: string) => getInstrument(id)?.symbol ?? id

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
          Play money only, nothing here touches a broker or real money. 90 days of past candles and
          a few weeks of live ticks are mostly luck: a winner here can lose next month.
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

// ── Last 90 days ─────────────────────────────────────────────────────────

type Load =
  | { state: 'loading'; done: number; total: number; what: string }
  | { state: 'done'; runs: Record<string, MarketRun[]>; skipped: string[]; at: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function Backtests({ start }: { start: number }) {
  const markets = useMemo(() => [...new Set(RULES.flatMap((r) => r.markets))], [])
  const first: Load = { state: 'loading', done: 0, total: markets.length, what: sym(markets[0]) }
  const [load, setLoad] = useState<Load>(first)
  const [open, setOpen] = useState<string | null>(null)
  const run = useRef(0)

  const go = useCallback(async () => {
    const me = ++run.current
    const data = new Map<string, OHLCCandle[]>()
    const skipped: string[] = []
    // One fetch per market, one at a time: the free CoinGecko tier rate-limits
    // bursts. Crypto comes as 1h candles and is merged into 4h/1d below, so
    // every strategy reuses the same fetch.
    for (const [n, id] of markets.entries()) {
      const forex = getInstrument(id)?.market === 'forex'
      const get = () => (forex ? fetchForexOHLC(id, 365) : fetchCryptoCandles(id, '1h'))
      try {
        data.set(
          id,
          await get().catch(async () => {
            await sleep(5000)
            return get()
          }),
        )
      } catch {
        skipped.push(id)
      }
      if (!forex) await sleep(1200)
      if (run.current !== me) return
      // State only changes after an await, never synchronously inside the effect.
      const next = markets[n + 1]
      if (next) setLoad({ state: 'loading', done: n + 1, total: markets.length, what: sym(next) })
    }
    if (run.current !== me) return
    const tradeFrom = Math.floor(Date.now() / 1000) - RACE_DAYS * 86_400
    const runs: Record<string, MarketRun[]> = {}
    for (const { rule, markets: ids } of RULES) {
      runs[rule.id] = ids.flatMap((id) => {
        const c = data.get(id)
        if (!c?.length) return []
        const market = getInstrument(id)?.market ?? 'crypto'
        const tf = market === 'forex' ? '1d' : rule.timeframe
        const candles = market === 'forex' ? c : resample(c, TF_HOURS[tf])
        return [
          {
            id,
            result: backtest({ ...rule, timeframe: tf }, candles, {
              startEquity: 1,
              feeRate: FEE_RATE[market],
              leverage: LEVERAGE[market],
              // Forex loads a year so the 200 EMA can warm up; it only trades the last 90 days.
              tradeFrom: market === 'forex' ? tradeFrom : undefined,
            }),
          },
        ]
      })
    }
    setLoad({ state: 'done', runs, skipped, at: Date.now() })
  }, [markets])

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
          riskPct: rule.riskPct,
          start,
          runs: load.runs[rule.id] ?? [],
          skipped: ids.filter((id) => load.skipped.includes(id)),
        }),
      ),
    )
  }, [load, start])

  const winner = entries[0]

  return (
    <section style={card} aria-labelledby="bt-title">
      <div style={sectionHead}>
        <h2 id="bt-title" style={h2}>
          Last 90 days
        </h2>
        <button
          style={ghost}
          onClick={() => {
            setLoad(first)
            void go()
          }}
          disabled={load.state === 'loading'}
          aria-label="Run the 90-day race again"
        >
          <RefreshCw size={14} /> {load.state === 'loading' ? 'Running…' : 'Run again'}
        </button>
      </div>
      <p style={small}>
        Backtest on past candles, fees included. Each strategy&apos;s money is split evenly over
        every market it trades ({money(start)} over {markets.length} markets is{' '}
        {money(shareOf(start, markets.length), { cents: true })} each), and each share trades on its
        own. A market whose data did not load keeps its share as cash.
      </p>

      {load.state === 'loading' ? (
        <div style={{ marginTop: 14 }} role="status" aria-live="polite">
          <p style={{ fontSize: 13 }}>
            Loading candles for {load.what} ({load.done + 1} of {load.total})…
          </p>
          <div style={barTrack}>
            <div style={{ ...barFill, width: `${(load.done / load.total) * 100}%` }} />
          </div>
          <p style={{ ...small, marginTop: 6 }}>
            One market at a time so the free data feed does not block us. About half a minute.
          </p>
        </div>
      ) : (
        <>
          {winner && (
            <p style={{ fontSize: 15, marginTop: 14, lineHeight: 1.5 }}>
              {winner.trades === 0 ? (
                'No strategy traded in the last 90 days.'
              ) : (
                <>
                  Most money: <b>{NAME.get(winner.ruleId)}</b> turned {money(start)} into{' '}
                  <b style={{ color: color(winner.profit) }}>{money(winner.end)}</b> (
                  {money(winner.profit, { sign: true })}, about{' '}
                  {money(winner.perMonth, { sign: true, cents: Math.abs(winner.perMonth) < 10 })} a
                  month).
                  {winner.profit <= 0 && ' Even the best one lost money after fees.'}
                </>
              )}
            </p>
          )}
          <ol style={list} aria-label="90-day leaderboard">
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
                      {money(e.perMonth, { sign: true, cents: Math.abs(e.perMonth) < 10 })}/mo
                    </span>
                    <span>
                      {e.trades} trade{e.trades === 1 ? '' : 's'}
                    </span>
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
              Skipped after a retry (free data feed busy): {load.skipped.map(sym).join(', ')}. Their
              share stayed as cash. Press Run again in a minute.
            </p>
          )}
          <p style={small}>
            Ran {when(load.at / 1000)}. Crypto uses 90 days of hourly prices (the first weeks only
            warm up the indicators); forex uses free daily ECB rates, so its stops are rough.
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
          <caption style={caption}>
            Per market ({money(entry.markets[0]?.share ?? 0, { cents: true })} each)
          </caption>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Market</th>
              <th style={th}>Trades</th>
              <th style={th}>End</th>
              <th style={th}>Profit</th>
            </tr>
          </thead>
          <tbody>
            {[...entry.markets]
              .sort((a, b) => b.profit - a.profit)
              .map((m) => (
                <tr key={m.id}>
                  <td style={{ ...td, textAlign: 'left' }}>{sym(m.id)}</td>
                  <td style={td}>{m.trades.length}</td>
                  <td style={td}>{money(m.end, { cents: true })}</td>
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
        }))}
        empty="No trades in these 90 days."
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
        opens or closes trades in its own play account (same split, sizes and fees as above). Only
        trades after the start count, so nothing here can be fitted to the past.
      </p>

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
const tradeRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderTop: '0.5px solid var(--border)',
}
