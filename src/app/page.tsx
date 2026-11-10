'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, HelpCircle } from 'lucide-react'
import { useCryptoPrices, useForexRates } from '@/lib/hooks/useMarketData'
import { useLivePrices, usePaperAccount } from '@/lib/hooks/usePaperAccount'
import { useRace } from '@/lib/hooks/useRace'
import { summarize } from '@/lib/race/live'
import { getInstrument } from '@/lib/paper/instruments'
import {
  closedTrades,
  demoPositions,
  measure,
  periodStarts,
  racePositions,
  sortPositions,
  tally,
  type ClosedRow,
} from '@/lib/positions/positions'
import { PositionCard } from '@/components/home/PositionCard'
import { ago, signedUsd, usd } from '@/components/home/format'
import { formatChange, changeColor } from '@/lib/utils/formatters'

type Tab = 'all' | 'look' | 'race' | 'demo'

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 12,
  padding: 14,
}
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const small: React.CSSProperties = { fontSize: 12, color: 'var(--text-secondary)' }
const rowLink: React.CSSProperties = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  textDecoration: 'none',
  color: 'var(--text-primary)',
  borderTop: '0.5px solid var(--border)',
  fontSize: 13,
}

export default function Today() {
  const { state, isLoading: raceLoading, error: raceError } = useRace()
  const account = usePaperAccount()
  const { prices } = useLivePrices()
  const [tab, setTab] = useState<Tab>('all')

  const rows = useMemo(() => {
    const all = [...racePositions(state), ...demoPositions(account, prices)]
    return sortPositions(
      all.map((pos) => ({ pos, m: measure(pos, prices[pos.market] ?? state?.prices[pos.market]) })),
    )
  }, [state, account, prices])

  const needsLook = rows.filter((r) => r.m.status !== 'Running')
  const shown =
    tab === 'look' ? needsLook : tab === 'all' ? rows : rows.filter((r) => r.pos.source === tab)
  const openPnl = rows.reduce((a, r) => a + (r.m.pnl ?? 0), 0)

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: rows.length },
    { id: 'look', label: 'Needs a look', n: needsLook.length },
    { id: 'race', label: 'Race', n: rows.filter((r) => r.pos.source === 'race').length },
    { id: 'demo', label: 'Demo', n: rows.filter((r) => r.pos.source === 'demo').length },
  ]

  return (
    <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Today</h1>
        <p style={small}>
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}{' '}
          · play money only
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          {rows.length === 0
            ? raceLoading
              ? 'Loading your trades…'
              : 'No trades open right now.'
            : `${rows.length} trade${rows.length === 1 ? '' : 's'} open, `}
          {rows.length > 0 && (
            <b style={{ color: openPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {signedUsd(openPnl)}
            </b>
          )}
          {rows.length > 0 && ' so far.'}
          {needsLook.length > 0 &&
            ` ${needsLook.length} need${needsLook.length === 1 ? 's' : ''} a look.`}
        </p>
      </header>

      <section
        aria-labelledby="open-title"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <h2 id="open-title" style={h2}>
            Open trades
          </h2>
          <HowTrades />
        </div>
        <div
          role="tablist"
          aria-label="Filter trades"
          style={{ display: 'flex', gap: 6, overflowX: 'auto' }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              style={{
                minHeight: 44,
                padding: '0 12px',
                borderRadius: 999,
                border: '0.5px solid var(--border)',
                background: tab === t.id ? 'var(--text-primary)' : 'var(--bg-card)',
                color: tab === t.id ? 'var(--bg-primary)' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {t.label} {t.n}
            </button>
          ))}
        </div>
        {raceError && (
          <p style={{ ...small, color: 'var(--amber)' }}>
            Could not load the race trades right now.
          </p>
        )}
        {shown.length === 0 ? (
          <div style={{ ...card, ...small }}>
            {tab === 'look'
              ? 'Nothing close to its stop or target. All good.'
              : tab === 'demo'
                ? 'No demo trades open.'
                : 'No trades open in this view.'}{' '}
            {(tab === 'demo' || tab === 'all') && (
              <Link href="/demo" style={{ color: 'var(--indigo)' }}>
                Place a demo trade
              </Link>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 12,
            }}
          >
            {shown.map((r) => (
              <PositionCard key={r.pos.key} pos={r.pos} m={r.m} />
            ))}
          </div>
        )}
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <RaceSummary />
        <Closed />
      </div>

      <Markets />
    </div>
  )
}

function RaceSummary() {
  const { state, isLoading } = useRace()
  const rows = state ? summarize(state) : []
  const spread = rows.length ? Math.max(...rows.map((r) => Math.abs(r.pnl))) : 0
  return (
    <section style={card} aria-labelledby="race-title">
      <h2 id="race-title" style={h2}>
        How the race is going
      </h2>
      {!state ? (
        <p style={{ ...small, marginTop: 6 }}>
          {isLoading ? 'Loading…' : 'The race has not started on this computer.'}
        </p>
      ) : (
        <>
          <p style={{ ...small, marginTop: 4 }}>
            {rows.length} strategies, {usd(state.startMoney)} each, checked every hour (
            {state.tickCount} checks, last {ago(state.ticks.at(-1)?.at ?? state.startedAt)}).
          </p>
          <p
            style={{
              fontSize: 13,
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--amber-dim)',
              color: 'var(--amber)',
            }}
          >
            Honest read: none has an edge yet. Every strategy is within{' '}
            {usd(Math.max(spread, 0.01))} of where it started. It takes weeks and many trades to
            know.
          </p>
          <ol style={{ listStyle: 'none', marginTop: 8 }}>
            {rows.map((r) => (
              <li key={r.ruleId}>
                <Link href="/race" style={rowLink}>
                  <span style={{ flex: 1, minWidth: 0, padding: '6px 0', lineHeight: 1.3 }}>
                    {r.name}
                  </span>
                  <span style={{ ...small, whiteSpace: 'nowrap' }}>{r.open.length} open</span>
                  <span
                    style={{
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      minWidth: 74,
                      textAlign: 'right',
                    }}
                  >
                    {usd(r.money)}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      minWidth: 52,
                      textAlign: 'right',
                      color: r.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {signedUsd(r.pnl)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <Link href="/race" style={{ ...rowLink, color: 'var(--indigo)', fontWeight: 600 }}>
            <span style={{ flex: 1 }}>Open the race</span>
            <ChevronRight size={16} />
          </Link>
        </>
      )}
    </section>
  )
}

function Closed() {
  const { state } = useRace()
  const account = usePaperAccount()
  const [now] = useState(() => Date.now())
  const { today, week } = periodStarts(now)
  const all = closedTrades(state, account)
  const weekRows = all.filter((r) => r.closedAt >= week)
  const todayRows = weekRows.filter((r) => r.closedAt >= today)
  return (
    <section style={card} aria-labelledby="closed-title">
      <h2 id="closed-title" style={h2}>
        Closed trades
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <TallyBox title="Today" rows={todayRows} />
        <TallyBox title="Last 7 days" rows={weekRows} />
      </div>
      {weekRows.length > 0 && (
        <ul style={{ listStyle: 'none', marginTop: 8 }}>
          {weekRows.slice(0, 6).map((r) => (
            <ClosedLine key={r.key} r={r} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TallyBox({ title, rows }: { title: string; rows: ClosedRow[] }) {
  const t = tally(rows)
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px' }}>
      <p style={small}>{title}</p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, marginTop: 2 }}>No trades closed</p>
      ) : (
        <>
          <p
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: t.net >= 0 ? 'var(--green)' : 'var(--red)',
            }}
          >
            {signedUsd(t.net)}
          </p>
          <p style={small}>
            {t.wins} won{t.wins > 0 && ` (${signedUsd(t.won)})`}, {t.losses} lost
            {t.losses > 0 && ` (${signedUsd(t.lost)})`}
          </p>
        </>
      )}
    </div>
  )
}

function ClosedLine({ r }: { r: ClosedRow }) {
  const inst = getInstrument(r.market)
  const why =
    r.reason === 'target' ? 'hit target' : r.reason === 'stop' ? 'hit stop' : 'closed by hand'
  return (
    <li style={{ ...rowLink, minHeight: 40 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{inst?.symbol ?? r.market}</span>{' '}
        <span style={small}>
          {r.side === 'long' ? 'buy' : 'sell'}, {why} · {r.by}
        </span>
      </span>
      <span style={{ fontWeight: 600, color: r.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {signedUsd(r.pnl)}
      </span>
    </li>
  )
}

function HowTrades() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        style={{
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 12px',
          borderRadius: 9,
          border: '0.5px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <HelpCircle size={15} /> How trades are placed
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-title"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#000000aa',
            zIndex: 100,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...card,
              maxWidth: 560,
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              borderRadius: '16px 16px 0 0',
              padding: 18,
            }}
          >
            <h2 id="how-title" style={{ fontSize: 17, fontWeight: 700 }}>
              How trades are placed
            </h2>
            <ol style={{ paddingLeft: 18, marginTop: 10, fontSize: 14, display: 'grid', gap: 8 }}>
              <li>
                <b>Signal.</b> Each strategy looks only at finished candles (1 hour, 4 hours or 1
                day, depending on the strategy). When its rules all line up, that is a signal.
              </li>
              <li>
                <b>Entry.</b> The next hourly check after the signal buys or sells at the live
                price, which is about the open of the next candle.
              </li>
              <li>
                <b>Stop loss.</b> Just past the recent swing (the lowest low before a buy, the
                highest high before a sell, over the last 5 to 10 candles) plus a small buffer, so
                normal wiggles don’t knock the trade out.
              </li>
              <li>
                <b>Take profit.</b> Most strategies aim for 2 times the stop distance (a few use 1.5
                or 3 times). Win once, lose twice, and you are about even.
              </li>
              <li>
                <b>Size.</b> Each trade risks 0.5% to 1% of that market’s share of the money if the
                stop hits. That is why race trades are cents: $1,000 is split over up to 19 markets.
              </li>
              <li>
                <b>Fees.</b> Paid going in and coming out: 0.1% per side on crypto, about 0.007% on
                forex, 0.02% on gold. P&L on the cards is before the exit fee.
              </li>
              <li>
                <b>One at a time.</b> Each strategy holds at most one trade per market.
              </li>
            </ol>
            <p style={{ ...small, marginTop: 12 }}>
              <b style={{ color: 'var(--text-primary)' }}>Not built yet:</b> trailing stops, moving
              the stop to break-even, and taking part of the profit early. A trade only ends at its
              stop or its target.
            </p>
            <button
              onClick={() => setOpen(false)}
              autoFocus
              style={{
                marginTop: 14,
                width: '100%',
                minHeight: 48,
                borderRadius: 10,
                border: 'none',
                background: 'var(--text-primary)',
                color: 'var(--bg-primary)',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function Markets() {
  const { prices, isLoading } = useCryptoPrices()
  const { rates } = useForexRates()
  const movers = [...prices]
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 6)
  const up = [...prices, ...rates].filter((m) => m.change24h > 0).length
  const down = [...prices, ...rates].filter((m) => m.change24h < 0).length
  const links = [
    { href: '/crypto', label: 'Crypto' },
    { href: '/forex', label: 'Forex' },
    { href: '/gold', label: 'Gold' },
    { href: '/strategies', label: 'Signals' },
    { href: '/watchlist', label: 'Watchlist' },
  ]
  return (
    <section style={card} aria-labelledby="markets-title">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
      >
        <h2 id="markets-title" style={h2}>
          Markets
        </h2>
        <span style={small}>
          {up} up, {down} down in 24 h
        </span>
      </div>
      <p style={{ ...small, marginTop: 2 }}>Biggest crypto moves</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
          gap: 6,
          marginTop: 8,
        }}
      >
        {isLoading && <p style={small}>Loading…</p>}
        {movers.map((m) => (
          <Link
            key={m.id}
            href={`/crypto/${m.id}`}
            style={{
              minHeight: 44,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 10px',
              borderRadius: 8,
              background: 'var(--bg-secondary)',
              textDecoration: 'none',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          >
            <b>{m.symbol}</b>
            <span style={{ color: changeColor(m.change24h), fontSize: 12 }}>
              {formatChange(m.change24h)}
            </span>
          </Link>
        ))}
      </div>
      <nav aria-label="More" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
              borderRadius: 999,
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: 13,
            }}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </section>
  )
}
