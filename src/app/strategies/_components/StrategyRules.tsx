'use client'
import { useState } from 'react'
import Link from 'next/link'
import { CandlestickChart, Copy, FlaskConical, Pencil, Play, Trash2 } from 'lucide-react'
import { DemoBadge } from '@/components/paper/DemoBadge'
import { useOverlay } from '@/lib/hooks/useOverlay'
import { useRules } from '@/lib/hooks/useRules'
import { setPaperAccount, useLivePrices, usePaperAccount } from '@/lib/hooks/usePaperAccount'
import { equityOf, FEE_RATE, LEVERAGE, placeOrder, sizeByRisk } from '@/lib/paper/engine'
import {
  formatQuote,
  getInstrument,
  instrumentHref,
  INSTRUMENTS,
  quoteToUsd,
} from '@/lib/paper/instruments'
import {
  backtest,
  describeCondition,
  describeStop,
  latestSignal,
  type BacktestResult,
  type Signal,
} from '@/lib/rules/engine'
import { loadRuleCandles, ruleInstrumentIds } from '@/lib/rules/data'
import { planWarnings } from '@/lib/paper/plan'
import type { Rule } from '@/lib/rules/schema'
import { RuleEditor } from './RuleEditor'

export default function StrategyRules() {
  const { rules, upsert, remove } = useRules()
  // Esc and Back close the rule editor (useOverlay).
  const [editing, edit, stopEditing] = useOverlay<Rule>()

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Strategies</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 2 }}>
          Rules you can check live, backtest on past candles, and trade in the demo account in one
          tap.
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))',
        }}
      >
        {rules.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            onEdit={() => edit(r)}
            onDuplicate={() =>
              edit({
                ...r,
                id: crypto.randomUUID(),
                name: `${r.name} (my copy)`,
                builtIn: undefined,
              })
            }
            onDelete={() => remove(r.id)}
          />
        ))}
      </div>
      {editing && (
        <RuleEditor
          rule={editing}
          onCancel={stopEditing}
          onSave={(r) => {
            upsert(r)
            stopEditing()
          }}
        />
      )}
    </section>
  )
}

type Check =
  | { state: 'idle' }
  | { state: 'loading'; what: string }
  | { state: 'error'; text: string }
  | { state: 'signal'; signal: Signal | null; note: string | null; last: number }
  | {
      state: 'backtest'
      rows: { id: string; result: BacktestResult }[]
      skipped: string[]
      note: string | null
    }

function RuleCard({
  rule,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  rule: Rule
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const ids = ruleInstrumentIds(rule, INSTRUMENTS)
  const [pair, setPair] = useState(ids[0] ?? 'bitcoin')
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inst = getInstrument(pair)

  const runSignal = async () => {
    setCheck({ state: 'loading', what: 'Checking the latest candles…' })
    try {
      const { candles, tf, note } = await loadRuleCandles(rule, pair)
      const signal = latestSignal({ ...rule, timeframe: tf }, candles)
      setCheck({ state: 'signal', signal, note, last: candles.at(-1)?.time ?? 0 })
    } catch (e) {
      setCheck({
        state: 'error',
        text: `Could not load candles (${(e as Error).message}). The free feed may be rate limited; try again in a minute.`,
      })
    }
  }

  const runBacktest = async (all: boolean) => {
    const targets = all ? ids : [pair]
    const rows: { id: string; result: BacktestResult }[] = []
    const skipped: string[] = []
    let note: string | null = null
    for (const [n, id] of targets.entries()) {
      setCheck({
        state: 'loading',
        what: `Backtesting ${getInstrument(id)?.symbol} (${n + 1}/${targets.length})…`,
      })
      try {
        // The free data feeds rate-limit bursts: one retry after a pause.
        const data = await loadRuleCandles(rule, id).catch(async () => {
          await new Promise((r) => setTimeout(r, 4000))
          return loadRuleCandles(rule, id)
        })
        note = data.note ?? note
        const market = getInstrument(id)?.market ?? 'crypto'
        rows.push({
          id,
          result: backtest({ ...rule, timeframe: data.tf }, data.candles, {
            feeRate: FEE_RATE[market],
            leverage: LEVERAGE[market],
          }),
        })
      } catch {
        skipped.push(id)
      }
    }
    setCheck(
      rows.length
        ? { state: 'backtest', rows, skipped, note }
        : { state: 'error', text: 'No candle data came back. Try again in a minute.' },
    )
  }

  return (
    <article style={card}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{rule.name}</h2>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            <Chip>{rule.timeframe}</Chip>
            <Chip>{rule.market === 'both' ? 'crypto, forex + gold' : rule.market}</Chip>
            <Chip>
              {rule.direction === 'both'
                ? 'buys + sells'
                : rule.direction === 'long'
                  ? 'buys only'
                  : 'sells only'}
            </Chip>
            <Chip>1 : {rule.rr} R:R</Chip>
            <Chip>risk {rule.riskPct}%</Chip>
            {rule.builtIn && <Chip muted>built-in</Chip>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {!rule.builtIn && (
            <IconButton label="Edit rule" onClick={onEdit}>
              <Pencil size={14} />
            </IconButton>
          )}
          <IconButton label="Duplicate and edit" onClick={onDuplicate}>
            <Copy size={14} />
          </IconButton>
          {!rule.builtIn &&
            (confirmDelete ? (
              <button
                style={{ ...ghost, color: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={onDelete}
              >
                Delete?
              </button>
            ) : (
              <IconButton label="Delete rule" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
              </IconButton>
            ))}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>{rule.summary}</p>
      <ol
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          margin: '10px 0 0',
          paddingLeft: 18,
          display: 'grid',
          gap: 3,
        }}
      >
        {rule.conditions.map((c, i) => (
          <li key={i}>{describeCondition(c)}</li>
        ))}
      </ol>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        {describeStop(rule)}; target {rule.rr}× the stop distance.
        {rule.sessions.length > 0 &&
          ` Sessions (New York time): ${rule.sessions.map((s) => `${s.label} ${fmtHour(s.start)}-${fmtHour(s.end)}`).join(', ')}.`}
      </p>
      {rule.sources.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Source: {rule.sources.map((s) => (s.at ? `${s.label} @ ${s.at}` : s.label)).join('; ')}
        </p>
      )}

      <div
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}
      >
        <select
          aria-label="Market to test"
          value={pair}
          onChange={(e) => setPair(e.target.value)}
          style={select}
        >
          {ids.map((id) => (
            <option key={id} value={id}>
              {getInstrument(id)?.label ?? getInstrument(id)?.symbol ?? id}
            </option>
          ))}
        </select>
        <button style={primary} onClick={runSignal}>
          <Play size={13} /> Check now
        </button>
        <button style={ghost} onClick={() => runBacktest(false)}>
          <FlaskConical size={13} /> Backtest
        </button>
        <button style={ghost} onClick={() => runBacktest(true)}>
          All {ids.length}
        </button>
        <Link
          href={`${instrumentHref(inst, pair)}?rule=${rule.id}`}
          style={{ ...ghost, textDecoration: 'none' }}
        >
          <CandlestickChart size={13} /> Chart
        </Link>
      </div>

      <CheckResult check={check} rule={rule} pair={pair} />
    </article>
  )
}

function CheckResult({ check, rule, pair }: { check: Check; rule: Rule; pair: string }) {
  if (check.state === 'idle') return null
  if (check.state === 'loading') return <p style={resultBox}>{check.what}</p>
  if (check.state === 'error')
    return <p style={{ ...resultBox, color: 'var(--red)' }}>{check.text}</p>
  if (check.state === 'signal') {
    const inst = getInstrument(pair)
    return (
      <div style={resultBox}>
        {check.signal ? (
          <SignalTrade signal={check.signal} rule={rule} pair={pair} />
        ) : (
          <p>
            No signal on the latest {rule.timeframe} candles for {inst?.symbol}. Last candle:{' '}
            {fmtTime(check.last)}.
          </p>
        )}
        {check.note && <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>{check.note}</p>}
      </div>
    )
  }
  return <BacktestTable check={check} rule={rule} />
}

function BacktestTable({
  check,
  rule,
}: {
  check: Extract<Check, { state: 'backtest' }>
  rule: Rule
}) {
  // "How much money would I make": the same backtest in dollars, from a start John picks.
  const [start, setStart] = useState(1000)
  const totalTrades = check.rows.reduce((a, r) => a + r.result.trades.length, 0)
  const totalR = check.rows.reduce((a, r) => a + r.result.totalR, 0)
  return (
    <div style={resultBox}>
      <p style={{ marginBottom: 6 }}>
        Backtest, last ~{days(check.rows[0].result)} days, fees included, {rule.riskPct}% risk per
        trade. Starting money:
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color: 'var(--text-muted)' }}>$</span>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          step={100}
          value={start}
          onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
          aria-label="Starting money in dollars"
          style={{
            width: 120,
            minHeight: 44,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
          }}
        />
        <span style={{ color: 'var(--text-muted)' }}>practice money, not real</span>
      </label>
      <MoneyLine rows={check.rows} start={start} />
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}
        >
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', fontWeight: 500 }}>Market</th>
              <th style={th}>Trades</th>
              <th style={th}>Win</th>
              <th style={th}>PF</th>
              <th style={th}>Max DD</th>
              <th style={th}>Result</th>
              <th style={th}>Money</th>
            </tr>
          </thead>
          <tbody>
            {check.rows.map(({ id, result: r }) => {
              const ret = (r.endEquity / r.startEquity - 1) * 100
              return (
                <tr key={id} style={{ textAlign: 'right' }}>
                  <td style={{ textAlign: 'left' }}>{getInstrument(id)?.symbol}</td>
                  <td style={th}>{r.trades.length}</td>
                  <td style={th}>
                    {r.stats.winRate === null ? '-' : `${Math.round(r.stats.winRate * 100)}%`}
                  </td>
                  <td style={th}>
                    {r.stats.profitFactor === null ? '-' : r.stats.profitFactor.toFixed(2)}
                  </td>
                  <td style={th}>{(r.stats.maxDrawdown * 100).toFixed(1)}%</td>
                  <td
                    style={{
                      ...th,
                      color: ret > 0 ? 'var(--green)' : ret < 0 ? 'var(--red)' : undefined,
                    }}
                  >
                    {ret >= 0 ? '+' : ''}
                    {ret.toFixed(1)}%
                  </td>
                  <td
                    style={{
                      ...th,
                      color: ret > 0 ? 'var(--green)' : ret < 0 ? 'var(--red)' : undefined,
                    }}
                  >
                    {usd((start * ret) / 100, true)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {check.rows.length > 1 && (
        <p style={{ marginTop: 6 }}>
          All markets: {totalTrades} trades, {totalR >= 0 ? '+' : ''}
          {totalR.toFixed(1)}R total.
        </p>
      )}
      {check.skipped.length > 0 && (
        <p style={{ marginTop: 6 }}>
          Skipped (free data feed busy, try again in a minute):{' '}
          {check.skipped.map((id) => getInstrument(id)?.symbol ?? id).join(', ')}
        </p>
      )}
      <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>
        Few trades means the result is mostly luck. Past candles do not promise future results.
        {check.note && ` ${check.note}`}
      </p>
    </div>
  )
}

const usd = (n: number, sign = false) =>
  `${sign && n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

/** The best market in plain dollars: what the start became, and about how much a month. */
function MoneyLine({
  rows,
  start,
}: {
  rows: { id: string; result: BacktestResult }[]
  start: number
}) {
  const best = [...rows].sort(
    (x, y) => y.result.endEquity / y.result.startEquity - x.result.endEquity / x.result.startEquity,
  )[0]
  if (!best || !best.result.trades.length)
    return <p style={{ marginBottom: 8 }}>No trades in this test, so no money made or lost.</p>
  const end = (start * best.result.endEquity) / best.result.startEquity
  const d = Math.max(1, days(best.result))
  const perMonth = ((end - start) / d) * 30
  return (
    <p style={{ marginBottom: 8, fontSize: 15 }}>
      Best market, {getInstrument(best.id)?.symbol}: {usd(start)} became{' '}
      <b style={{ color: end >= start ? 'var(--green)' : 'var(--red)' }}>{usd(end)}</b> in {d} days,
      about <b>{usd(perMonth, true)}</b> a month.
    </p>
  )
}

function SignalTrade({ signal, rule, pair }: { signal: Signal; rule: Rule; pair: string }) {
  const account = usePaperAccount()
  const { prices } = useLivePrices()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const inst = getInstrument(pair)
  const live = prices[pair]
  const q = inst ? quoteToUsd(inst.quote, prices) : null
  const units =
    live && q
      ? sizeByRisk({
          equity: equityOf(account, prices),
          riskPct: rule.riskPct,
          entry: live,
          stop: signal.stop,
          quoteUsd: q,
        })
      : 0
  const buy = signal.direction === 'long'
  const warnings =
    units > 0 && live && q
      ? planWarnings(account, prices, {
          riskUsd: Math.abs(live - signal.stop) * units * q,
          fromStrategy: true,
        })
      : []

  const place = () => {
    const r = placeOrder(
      account,
      {
        instrumentId: pair,
        side: signal.direction,
        type: 'market',
        units,
        stopLoss: signal.stop,
        takeProfit: signal.takeProfit,
        strategyId: rule.id,
      },
      prices,
    )
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setPaperAccount(r.account)
    setMsg({ ok: true, text: 'Demo trade placed.' })
  }

  return (
    <div>
      <p>
        <strong style={{ color: buy ? 'var(--green)' : 'var(--red)' }}>
          {buy ? 'BUY' : 'SELL'} signal
        </strong>{' '}
        on {inst?.symbol}, candle of {fmtTime(signal.time)}.
      </p>
      <p style={{ marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        Signal price {formatQuote(signal.entry, inst)} · stop {formatQuote(signal.stop, inst)} ·
        target {formatQuote(signal.takeProfit, inst)}
        {live && ` · live ${formatQuote(live, inst)}`}
      </p>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}
      >
        <button
          style={{
            ...primary,
            background: buy ? 'var(--green)' : 'var(--red)',
            opacity: units > 0 ? 1 : 0.4,
          }}
          disabled={!(units > 0)}
          onClick={place}
        >
          Place demo {buy ? 'buy' : 'sell'} ({rule.riskPct}% risk)
        </button>
        <DemoBadge />
      </div>
      {warnings.length > 0 && (
        <ul
          aria-label="Plan checks"
          style={{ color: 'var(--amber)', marginTop: 6, paddingLeft: 16 }}
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {msg && (
        <p role="status" style={{ marginTop: 6, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
          {msg.text}{' '}
          {msg.ok && (
            <Link href="/demo" style={{ color: 'var(--indigo)' }}>
              Open demo account
            </Link>
          )}
        </p>
      )}
    </div>
  )
}

const fmtHour = (h: number) =>
  `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
const fmtTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
const days = (r: BacktestResult) => (r.from && r.to ? Math.round((r.to - r.from) / 86_400) : 0)

function Chip({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 7px',
        borderRadius: 5,
        border: '0.5px solid var(--border)',
        color: muted ? 'var(--text-muted)' : 'var(--text-secondary)',
        background: 'var(--bg-secondary)',
      }}
    >
      {children}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ ...ghost, padding: 0, width: 44, justifyContent: 'center' }}
    >
      {children}
    </button>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 0,
}
const ghost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 7,
  border: '0.5px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  cursor: 'pointer',
}
const primary: React.CSSProperties = {
  ...ghost,
  background: 'var(--indigo)',
  border: 'none',
  color: 'white',
  fontWeight: 500,
}
const select: React.CSSProperties = { ...ghost, paddingRight: 8, color: 'var(--text-primary)' }
const resultBox: React.CSSProperties = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  fontSize: 12,
  color: 'var(--text-secondary)',
}
const th: React.CSSProperties = { padding: '3px 0 3px 10px', fontWeight: 500 }
