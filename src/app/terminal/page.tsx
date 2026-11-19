'use client'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useRace } from '@/lib/hooks/useRace'
import { useLivePrices } from '@/lib/hooks/usePaperAccount'
import { useStoredState } from '@/lib/hooks/useStoredState'
import { formatQuote, getInstrument } from '@/lib/paper/instruments'
import { RACE_ONLY_MARKETS } from '@/lib/race/labBots'
import { sizeText, sizingOf } from '@/lib/sizing/sizing'
import {
  ALL,
  allBooks,
  booksFor,
  candleUrl,
  changeOf,
  chartLevels,
  chartTrips,
  defaultMarket,
  footer,
  historyRows,
  openRows,
  prClock,
  priceOf,
  prTime,
  TFS,
  validAccount,
  type HistoryRow,
  type OpenRow,
  type Tf,
} from '@/lib/race/terminal'
import type { LiveTrade } from '@/lib/race/live'
import type { OHLCCandle } from '@/lib/types/market'
import { TerminalChart } from '@/components/terminal/TerminalChart'
import { card, FS, num, pnlText, secondary, tone } from '@/components/home/ui'
import { pct } from '@/components/home/format'

// Terminal (John, 2026-11-18): MetaTrader 4 on a computer. A big live chart
// on top, the trades below. Play money only; nothing here talks to a broker.
// Logic and tests: src/lib/race/terminal.ts. Docs: docs/dashboard.md.

const ACCOUNT_KEY = 'trade-hub-terminal-account'

function loadAccount(): string {
  try {
    return window.localStorage.getItem(ACCOUNT_KEY) || ALL
  } catch {
    return ALL
  }
}

const nameOf = (id: string) =>
  getInstrument(id)?.label ?? getInstrument(id)?.symbol ?? RACE_ONLY_MARKETS[id]?.label ?? id
const quote = (market: string, n: number | null | undefined) =>
  n == null ? '-' : formatQuote(n, getInstrument(market))

/** Axis decimals, the same as formatQuote. */
function decimalsOf(market: string, price: number | undefined): number {
  const inst = getInstrument(market)
  if (inst?.market === 'forex') return inst.quote === 'JPY' ? 3 : 5
  if (!price || price >= 1) return 2
  return price >= 0.01 ? 4 : 6
}

const sizeOf = (t: LiveTrade) => {
  const inst = getInstrument(t.market)
  return sizeText(
    inst,
    sizingOf({ inst, units: t.units, entry: t.entry, usdPerQuote: t.usdPerQuote }),
  )
}

const fetchCandles = async (url: string): Promise<OHLCCandle[]> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`candles ${res.status}`)
  return res.json()
}

export default function TerminalPage() {
  const { state, error: raceError, isLoading: raceLoading } = useRace()
  const { prices } = useLivePrices()
  const [saved, setSaved] = useStoredState(loadAccount, ALL)
  const account = validAccount(state, saved)
  const [tab, setTab] = useState<'open' | 'history'>('open')
  const [tf, setTf] = useState<Tf>('1h')
  const [pickedMarket, setPickedMarket] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [updated, setUpdated] = useState<number | null>(null)

  const pickAccount = useCallback(
    (id: string) => {
      setSaved(id)
      setPicked(null)
      try {
        window.localStorage.setItem(ACCOUNT_KEY, id)
      } catch {
        // Private window or blocked storage: the choice lasts until the page closes.
      }
    },
    [setSaved],
  )

  const { strategies, funded } = useMemo(() => allBooks(state), [state])
  const books = useMemo(() => booksFor(state, account), [state, account])
  const open = useMemo(
    () => openRows(books, (m) => priceOf(m, prices, state?.prices)),
    [books, prices, state],
  )
  const history = useMemo(() => historyRows(books), [books])
  const sums = footer(books, open)

  // The data moved: say when, small, like MT4's status bar.
  useEffect(() => {
    if (!state) return
    const id = setTimeout(() => setUpdated(Date.now()), 0)
    return () => clearTimeout(id)
  }, [state, prices])

  const market = pickedMarket ?? defaultMarket(open)
  const markets = useMemo(
    () =>
      [
        ...new Set([
          market,
          'pax-gold',
          ...open.map((r) => r.trade.market),
          ...history.map((r) => r.trade.market),
        ]),
      ].sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [market, open, history],
  )

  const source = candleUrl(market, tf)
  const {
    data: candles,
    error: candleError,
    isLoading: candlesLoading,
  } = useSWR(source?.url ?? null, fetchCandles, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  })
  const shown = useMemo(() => candles ?? [], [candles])
  const lastPrice = priceOf(market, prices, state?.prices) ?? shown[shown.length - 1]?.close
  const change = changeOf(shown, lastPrice)
  const levels = useMemo(() => chartLevels(open, market, picked), [open, market, picked])
  const trips = useMemo(() => chartTrips(history, market, shown), [history, market, shown])

  const pickRow = (key: string, m: string) => {
    setPickedMarket(m)
    setPicked(key === picked ? null : key)
  }

  const chartNote = !source
    ? 'No candles for this market here.'
    : candleError
      ? 'Candles could not load right now. Trying again in a minute.'
      : !candlesLoading && shown.length === 0
        ? 'No candles for this market right now.'
        : null

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {/* Header strip: market, last price, change, candle size. */}
      <div className="term-head">
        <label style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={{ ...secondary, fontSize: FS.xs }}>Market</span>
          <select
            value={market}
            onChange={(e) => {
              setPickedMarket(e.target.value)
              setPicked(null)
            }}
            style={selectStyle}
          >
            {markets.map((m) => (
              <option key={m} value={m}>
                {nameOf(m)}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={{ ...secondary, fontSize: FS.xs }}>Last price</span>
          <span style={{ ...num, fontSize: FS.lg, fontWeight: 700 }}>
            {quote(market, lastPrice)}{' '}
            {change && (
              <span style={{ fontSize: FS.sm, fontWeight: 600, color: tone(change.abs) }}>
                {pct(change.pct, true)}{' '}
                <span style={{ ...secondary, fontWeight: 400 }}>
                  {source?.daily ? 'since the day before' : '24h'}
                </span>
              </span>
            )}
          </span>
        </div>
        {source && (
          <div className="term-tf" role="group" aria-label="Candle size">
            {source.daily ? (
              <span style={{ ...secondary, fontSize: FS.sm }}>
                Daily candles only for this market
              </span>
            ) : (
              TFS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tf === t}
                  onClick={() => setTf(t)}
                  style={pill(tf === t)}
                >
                  {t}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* The chart. */}
      <div style={{ ...card, padding: 8 }}>
        <div className="term-chart">
          {source && !candleError && (
            <TerminalChart
              candles={shown}
              levels={levels}
              trips={trips}
              viewKey={`${market}:${source.url}`}
              decimals={decimalsOf(market, lastPrice)}
              daily={source.daily}
            />
          )}
          {(chartNote || (candlesLoading && !shown.length)) && (
            <p style={chartNoteStyle}>{chartNote ?? 'Loading candles...'}</p>
          )}
        </div>
        <p style={{ ...secondary, fontSize: FS.xs, padding: '6px 4px 0' }}>
          Times in Puerto Rico time. Lines: entry (solid), stop (red dashed), target (green). Closed
          trades: arrow at the entry, dot at the exit.
          {levels.length === 0 && ' No open trade in this market for this account.'}
        </p>
      </div>

      {/* Account filter. */}
      <label className="term-account">
        <span style={{ ...secondary, fontSize: FS.sm }}>Account</span>
        <select
          value={account}
          onChange={(e) => pickAccount(e.target.value)}
          style={{ ...selectStyle, flex: '1 1 auto', minWidth: 0, maxWidth: 420 }}
        >
          <option value={ALL}>All accounts</option>
          <optgroup label="Strategy accounts">
            {strategies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </optgroup>
          {funded.length > 0 && (
            <optgroup label="Funded tests">
              {funded.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      {/* Terminal panel. */}
      <section style={{ ...card, overflow: 'hidden', minWidth: 0 }}>
        <div
          role="tablist"
          aria-label="Trades"
          style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}
        >
          <Tab on={tab === 'open'} onClick={() => setTab('open')}>
            Open trades ({open.length})
          </Tab>
          <Tab on={tab === 'history'} onClick={() => setTab('history')}>
            History ({history.length})
          </Tab>
        </div>

        {raceError && !state ? (
          <Empty>Couldn&apos;t reach the race. Trying again in a minute.</Empty>
        ) : !state ? (
          <Empty>{raceLoading ? 'Loading trades...' : 'The race has not started yet.'}</Empty>
        ) : tab === 'open' ? (
          <OpenTable rows={open} picked={picked} onPick={pickRow} />
        ) : (
          <HistoryTable rows={history} picked={picked} onPick={pickRow} />
        )}

        {state && (
          <div className="term-foot">
            <span>
              Balance <b style={num}>{money(sums.balance)}</b>
            </span>
            <span>
              Equity <b style={num}>{money(sums.equity)}</b>
            </span>
            <span>
              Open P&amp;L{' '}
              <b style={{ ...num, color: tone(sums.openPnl) }}>{pnlText(sums.openPnl)}</b>
            </span>
            <span style={secondary}>
              {account === ALL ? `Sum of the ${sums.accounts} play accounts. ` : ''}
              Open P&amp;L before fees.
              {updated ? ` Updated ${prClock(updated)}.` : ''}
            </span>
          </div>
        )}
      </section>
    </div>
  )
}

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const selectStyle: CSSProperties = {
  minHeight: 44,
  maxWidth: '100%',
  padding: '0 12px',
  borderRadius: 10,
  border: '0.5px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: FS.sm,
}

const chartNoteStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-secondary)',
  fontSize: FS.sm,
}

const pill = (on: boolean): CSSProperties => ({
  minWidth: 52,
  minHeight: 44,
  border: 0,
  borderRadius: 999,
  background: on ? 'var(--text-primary)' : 'transparent',
  color: on ? 'var(--bg-primary)' : 'var(--text-secondary)',
  fontSize: FS.sm,
  fontWeight: 600,
  cursor: 'pointer',
})

function Tab(props: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.on}
      onClick={props.onClick}
      style={{
        minHeight: 44,
        padding: '0 16px',
        border: 0,
        borderBottom: `2px solid ${props.on ? 'var(--indigo)' : 'transparent'}`,
        background: 'transparent',
        color: props.on ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: FS.sm,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {props.children}
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ ...secondary, padding: 16, fontSize: FS.sm }}>{children}</p>
}

const OPEN_COLS = [
  'Account',
  'Market',
  'Type',
  'Size',
  'Opened',
  'Entry',
  'Stop',
  'Target',
  'Price now',
  'Pips',
  'Profit',
]
const HISTORY_COLS = [
  'Account',
  'Market',
  'Type',
  'Size',
  'Opened',
  'Entry',
  'Stop',
  'Target',
  'Closed',
  'Exit',
  'Reason',
  'Pips',
  'Profit',
]
const RIGHT = new Set(['Entry', 'Stop', 'Target', 'Price now', 'Exit', 'Pips', 'Profit'])

function Table(props: { cols: string[]; children: React.ReactNode }) {
  return (
    <div className="term-scroll">
      <table className="term-table">
        <thead>
          <tr>
            {props.cols.map((c) => (
              <th key={c} style={{ textAlign: RIGHT.has(c) ? 'right' : 'left' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  )
}

/** A clickable row: picks its market in the chart and highlights its lines. */
function Row(props: {
  rowKey: string
  market: string
  picked: string | null
  onPick: (key: string, market: string) => void
  children: React.ReactNode
}) {
  const on = props.picked === props.rowKey
  return (
    <tr
      tabIndex={0}
      aria-selected={on}
      data-on={on || undefined}
      onClick={() => props.onPick(props.rowKey, props.market)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onPick(props.rowKey, props.market)
        }
      }}
    >
      {props.children}
    </tr>
  )
}

const side = (t: LiveTrade) => (
  <td style={{ color: t.direction === 'long' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
    {t.direction === 'long' ? 'Buy' : 'Sell'}
  </td>
)
const pips = (n: number | null) => (n == null ? '-' : n.toFixed(1))
const target = (t: LiveTrade) =>
  t.target1 != null
    ? `${quote(t.market, t.target1)} / ${quote(t.market, t.takeProfit)}`
    : quote(t.market, t.takeProfit)

function OpenTable(props: {
  rows: OpenRow[]
  picked: string | null
  onPick: (key: string, market: string) => void
}) {
  if (!props.rows.length) return <Empty>No open trades in this account right now.</Empty>
  return (
    <Table cols={OPEN_COLS}>
      {props.rows.map((r) => {
        const t = r.trade
        return (
          <Row
            key={r.key}
            rowKey={r.key}
            market={t.market}
            picked={props.picked}
            onPick={props.onPick}
          >
            <td className="term-acct">{r.accountLabel}</td>
            <td>{nameOf(t.market)}</td>
            {side(t)}
            <td>{sizeOf(t)}</td>
            <td>{prTime(t.entryTime)}</td>
            <td className="r">{quote(t.market, t.entry)}</td>
            <td className="r">{quote(t.market, t.stop)}</td>
            <td className="r">{target(t)}</td>
            <td className="r">{quote(t.market, r.price)}</td>
            <td className="r" style={{ color: tone(r.pips) }}>
              {pips(r.pips)}
            </td>
            <td className="r" style={{ color: tone(r.pnl), fontWeight: 600 }}>
              {pnlText(r.pnl)}
            </td>
          </Row>
        )
      })}
    </Table>
  )
}

function HistoryTable(props: {
  rows: HistoryRow[]
  picked: string | null
  onPick: (key: string, market: string) => void
}) {
  if (!props.rows.length) return <Empty>No closed trades in this account yet.</Empty>
  return (
    <Table cols={HISTORY_COLS}>
      {props.rows.map((r) => {
        const t = r.trade
        return (
          <Row
            key={r.key}
            rowKey={r.key}
            market={t.market}
            picked={props.picked}
            onPick={props.onPick}
          >
            <td className="term-acct">{r.accountLabel}</td>
            <td>{nameOf(t.market)}</td>
            {side(t)}
            <td>{sizeOf(t)}</td>
            <td>{prTime(t.entryTime)}</td>
            <td className="r">{quote(t.market, t.entry)}</td>
            <td className="r">{quote(t.market, t.stop)}</td>
            <td className="r">{target(t)}</td>
            <td>{prTime(t.exitTime)}</td>
            <td className="r">{quote(t.market, t.exit)}</td>
            <td>{r.reason}</td>
            <td className="r" style={{ color: tone(r.pips) }}>
              {pips(r.pips)}
            </td>
            <td className="r" style={{ color: tone(t.pnl), fontWeight: 600 }}>
              {pnlText(t.pnl)}
            </td>
          </Row>
        )
      })}
    </Table>
  )
}
