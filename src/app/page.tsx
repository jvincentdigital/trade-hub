'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { HelpCircle } from 'lucide-react'
import { useCandleMap, useCryptoPrices, useForexRates } from '@/lib/hooks/useMarketData'
import { useLivePrices, usePaperAccount } from '@/lib/hooks/usePaperAccount'
import { useRace } from '@/lib/hooks/useRace'
import { RACE_SIZING } from '@/lib/race/account'
import { BUILT_IN_RULES } from '@/lib/rules/presets'
import { getInstrument } from '@/lib/paper/instruments'
import {
  closedTrades,
  demoPositions,
  ifAllHit,
  measure,
  racePositions,
  settledSoFar,
  sortPositions,
  type OpenPosition,
  type PositionMetrics,
} from '@/lib/positions/positions'
import {
  TF_WORD,
  closedTodayLine,
  lookLine,
  needsLook,
  notCountedLine,
  openCountLine,
  pnlSeries,
  priceFor,
} from '@/lib/positions/today'
import { POUND_AND_GOLD } from '@/lib/positions/london'
import { EXTRA_STRATEGIES } from '@/lib/race/extras'
import { HowSheet } from '@/components/home/HowSheet'
import { LondonStrip } from '@/components/home/LondonStrip'
import { Strategies } from '@/components/home/Strategies'
import { FAILED_TEXT, Summary } from '@/components/home/Summary'
import { TradeRow, rowId } from '@/components/home/TradeRow'
import { FS, button, card, clock, num, pnlText, secondary, tone } from '@/components/home/ui'
import { formatChange, changeColor } from '@/lib/utils/formatters'

type Tab = 'all' | 'look' | 'strategy' | 'pound'
type Row = { pos: OpenPosition; m: PositionMetrics }

const RULES = new Map(BUILT_IN_RULES.map((r) => [r.id, r]))

export default function Page() {
  // useSearchParams (open row, sheet) needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<h1 style={{ fontSize: FS.xl, fontWeight: 700 }}>Today</h1>}>
      <Today />
    </Suspense>
  )
}

/**
 * The open row and the sheet live in the URL (?trade=, ?how=1), so the
 * browser Back button closes them. Opening pushes one history entry tagged
 * `todayOverlay` (opening another row replaces it, keeping the tag); closing
 * goes back from a tagged entry, else replaces. The tag sits in
 * history.state, which Next keeps, so it survives leaving Today and coming
 * back. Only pass our own key: Next skips its URL sync for states with `__NA`.
 */
function useUrlState() {
  const params = useSearchParams()
  // Set from our own history.back() until its popstate (a frame or more), so a
  // second close in that gap does nothing instead of leaving Today.
  const closing = useRef(false)
  useEffect(() => {
    const onPop = () => {
      closing.current = false
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const write = useCallback((key: string, value: string | null, push: boolean) => {
    const p = new URLSearchParams(window.location.search)
    if (value == null) p.delete(key)
    else p.set(key, value)
    const url = `${window.location.pathname}${p.size ? `?${p}` : ''}`
    const todayOverlay = push || window.history.state?.todayOverlay === true
    if (push) window.history.pushState({ todayOverlay }, '', url)
    else window.history.replaceState({ todayOverlay }, '', url)
  }, [])
  const open = useCallback(
    (key: string, value: string) => write(key, value, !params.has(key)),
    [params, write],
  )
  const close = useCallback(
    (key: string) => {
      if (!params.has(key) || closing.current) return
      if (window.history.state?.todayOverlay === true) {
        closing.current = true
        window.history.back()
      } else write(key, null, false)
    },
    [params, write],
  )
  return { trade: params.get('trade'), how: params.has('how'), open, close }
}

function Today() {
  const { state, isLoading: raceLoading, error: raceError } = useRace()
  const account = usePaperAccount()
  const { prices } = useLivePrices()
  const [tab, setTab] = useState<Tab>('all')
  const [now, setNow] = useState(() => Date.now())
  const nav = useUrlState()
  const { trade, how, close } = nav

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const rows = useMemo(() => {
    const all = [...racePositions(state), ...demoPositions(account, prices)]
    return sortPositions(
      all.map((pos) => ({ pos, m: measure(pos, priceFor(pos, prices, state?.prices)) })),
    )
  }, [state, account, prices])
  const { candles, isLoading: candlesLoading } = useCandleMap(rows.map((r) => r.pos.market))
  // The race feed failed and there is nothing to show: say so, not "no trades".
  const failed = !!raceError && rows.length === 0

  const openPnl = rows.reduce((a, r) => a + (r.m.pnl ?? 0), 0)
  const look = rows.filter((r) => needsLook(r.m.status))
  const pound = rows.filter((r) => POUND_AND_GOLD.includes(r.pos.market))
  const series = useMemo(
    () =>
      pnlSeries(
        rows.map((r) => r.pos),
        candles,
        now,
        openPnl,
      ),
    [rows, candles, now, openPnl],
  )
  const strategyCount = state ? Object.keys(state.strategies).length : 0
  const startMoney = state?.startMoney ?? 1000
  const sizing = state?.sizing ?? RACE_SIZING
  const closedToday = useMemo(
    () => closedTodayLine(closedTrades(state, account), now),
    [state, account, now],
  )
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>()
    for (const r of rows) by.set(r.pos.by, [...(by.get(r.pos.by) ?? []), r])
    // Race strategies first, demo last.
    return [...by.values()].sort(
      (a, b) => Number(a[0].pos.source === 'demo') - Number(b[0].pos.source === 'demo'),
    )
  }, [rows])

  // Esc closes the open row (the sheet handles its own Esc) and puts focus back on it.
  useEffect(() => {
    if (!trade || how) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close('trade')
      document.getElementById(`head-${rowId(trade)}`)?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [trade, how, close])

  // Opening a row below an open one collapses that one; keep the new row's head on screen.
  useEffect(() => {
    if (!trade) return
    const el = document.getElementById(`row-${rowId(trade)}`)
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
  }, [trade])

  const pickTab = (t: Tab) => {
    if (t === tab) return
    close('trade')
    setTab(t)
  }

  const renderRow = (r: Row) => (
    <TradeRow
      key={r.pos.key}
      pos={r.pos}
      m={r.m}
      candles={candles[r.pos.market] ?? []}
      candlesLoading={candlesLoading}
      rule={r.pos.ruleId ? RULES.get(r.pos.ruleId) : undefined}
      now={now}
      open={trade === r.pos.key}
      onToggle={() => (trade === r.pos.key ? close('trade') : nav.open('trade', r.pos.key))}
      onClose={() => close('trade')}
    />
  )

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'all', label: 'All', n: rows.length },
    { id: 'look', label: 'Needs a look', n: look.length },
    { id: 'strategy', label: 'By strategy' },
    { id: 'pound', label: 'Pound & gold', n: pound.length },
  ]

  return (
    <div style={{ maxWidth: 1180 }}>
      <header>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h1
            style={{ fontSize: FS.xl, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.025em' }}
          >
            Today
          </h1>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => nav.open('how', '1')}
            style={{ ...button, borderRadius: 999, background: 'var(--bg-card)', fontWeight: 500 }}
          >
            <HelpCircle size={18} aria-hidden color="var(--text-secondary)" />
            How trades are placed
          </button>
        </div>
        <p style={{ ...secondary, fontSize: FS.sm, marginTop: 4 }}>
          {new Date(now).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
          . Play money only.
        </p>
      </header>

      <LondonStrip now={now} />

      <div className="today-grid" style={{ marginTop: 16 }}>
        <div className="today-side">
          <Summary
            loading={raceLoading}
            failed={failed}
            count={rows.length}
            countLine={openCountLine(
              rows.map((r) => r.pos),
              strategyCount || BUILT_IN_RULES.length,
            )}
            pnl={openPnl}
            settled={settledSoFar(state)}
            since={state ? clock(state.startedAt, now) : null}
            series={series}
            sinceText={series.length > 1 ? `Since ${clock(series[0].t, now)}` : null}
            hit={ifAllHit(rows.map((r) => r.m))}
            notCounted={notCountedLine(rows)}
            lookLine={lookLine(rows)}
            needsLook={look.length > 0}
            closedToday={closedToday}
            startMoney={startMoney}
            riskPct={sizing.riskPct}
          />
          {state && (
            <Strategies
              groups={groups.filter((g) => g[0].pos.source === 'race')}
              state={state}
              rules={RULES}
              startMoney={startMoney}
              maxOpen={sizing.maxOpen}
            />
          )}
        </div>

        <div style={{ display: 'grid', gap: 18, minWidth: 0, alignContent: 'start' }}>
          <section aria-labelledby="open-title">
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <h2 id="open-title" style={{ fontSize: FS.lg, fontWeight: 700 }}>
                Open trades
              </h2>
              <p style={{ ...secondary, fontSize: FS.xs }}>Tap a trade for its chart and size</p>
            </div>
            <div
              role="group"
              aria-label="Show"
              className="today-tabs"
              style={{
                gap: 4,
                margin: '12px 0 14px',
                padding: 4,
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tab === t.id}
                  onClick={() => pickTab(t.id)}
                  style={{
                    minWidth: 0,
                    minHeight: 44,
                    padding: '0 8px',
                    border: 0,
                    borderRadius: 999,
                    background: tab === t.id ? 'var(--text-primary)' : 'transparent',
                    color: tab === t.id ? 'var(--bg-primary)' : 'var(--text-secondary)',
                    fontSize: FS.sm,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                  {t.n != null && (
                    <span style={{ ...num, opacity: 0.65, marginLeft: 4 }}>{t.n}</span>
                  )}
                </button>
              ))}
            </div>
            {raceError && rows.length > 0 && (
              <p style={{ fontSize: FS.sm, color: 'var(--amber)', marginBottom: 10 }}>
                Could not load the race trades right now.
              </p>
            )}
            <div style={{ display: 'grid', gap: 10 }}>
              {rows.length === 0 ? (
                <Empty>
                  {failed ? (
                    FAILED_TEXT
                  ) : (
                    <>
                      {raceLoading ? 'Loading your trades…' : 'No trades open right now.'}{' '}
                      <Link href="/demo" style={{ color: 'var(--indigo)' }}>
                        Place a demo trade
                      </Link>
                    </>
                  )}
                </Empty>
              ) : tab === 'all' ? (
                rows.map(renderRow)
              ) : tab === 'pound' ? (
                pound.length ? (
                  pound.map(renderRow)
                ) : (
                  <Empty>
                    No pound or gold trades open. GBP/USD, GBP/JPY, EUR/GBP and gold are watched
                    every 15 minutes around the London open (2:00 to 7:00 AM).
                  </Empty>
                )
              ) : tab === 'look' ? (
                look.length ? (
                  look.map(renderRow)
                ) : (
                  <Empty>
                    <p style={{ marginBottom: 14 }}>
                      Nothing needs a look. All {rows.length} trades are between their stop and
                      target.
                    </p>
                    <button
                      type="button"
                      onClick={() => pickTab('all')}
                      style={{ ...button, margin: '0 auto' }}
                    >
                      Show all trades
                    </button>
                  </Empty>
                )
              ) : (
                groups.map((g) => {
                  const first = g[0].pos
                  const rule = first.ruleId ? RULES.get(first.ruleId) : undefined
                  const extra = first.ruleId ? EXTRA_STRATEGIES[first.ruleId] : undefined
                  const sum = g.reduce((a, r) => a + (r.m.pnl ?? 0), 0)
                  return (
                    <div key={first.by} style={{ display: 'grid', gap: 10 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: 10,
                          margin: '6px 2px 0',
                        }}
                      >
                        <div>
                          <h3 style={{ fontSize: FS.md, fontWeight: 600 }}>{first.by}</h3>
                          <p style={{ ...secondary, fontSize: FS.xs }}>
                            {first.source === 'demo'
                              ? `${g.length} open in your demo account`
                              : `${g.length} of ${sizing.maxOpen} open${rule ? `, ${TF_WORD[rule.timeframe]} candles, target ${rule.rr}x` : extra ? `, ${extra.candles} candles, target ${extra.rr}` : ''}`}
                          </p>
                        </div>
                        <span
                          style={{ ...num, fontSize: FS.md, fontWeight: 600, color: tone(sum) }}
                        >
                          {pnlText(sum)}
                        </span>
                      </div>
                      {g.map(renderRow)}
                    </div>
                  )
                })
              )}
            </div>
          </section>
          <Markets />
        </div>
      </div>

      <HowSheet
        open={how}
        onClose={() => close('how')}
        sample={
          // A forex trade shows lots and $ per pip best.
          rows.find(
            (r) => r.pos.source === 'race' && getInstrument(r.pos.market)?.market === 'forex',
          )?.pos ?? rows.find((r) => r.pos.source === 'race')?.pos
        }
        startMoney={startMoney}
      />
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...card,
        ...secondary,
        padding: '28px 18px',
        textAlign: 'center',
        fontSize: FS.sm,
      }}
    >
      {children}
    </div>
  )
}

const small: React.CSSProperties = { fontSize: FS.xs, color: 'var(--text-secondary)' }

function Markets() {
  const { prices: all, isLoading } = useCryptoPrices()
  const { rates } = useForexRates()
  // Coins the feed has a price for; none when it failed (no "+0.00%" tiles).
  const prices = all.filter((p) => p.price > 0)
  const movers = [...prices]
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 6)
  const up = [...prices, ...rates].filter((m) => m.change24h > 0).length
  const down = [...prices, ...rates].filter((m) => m.change24h < 0).length
  const links = [
    { href: '/crypto', label: 'Crypto' },
    { href: '/forex', label: 'Forex' },
    { href: '/gold', label: 'Gold' },
    { href: '/strategies', label: 'Strategies' },
    { href: '/watchlist', label: 'Watchlist' },
  ]
  return (
    <section style={{ ...card, padding: 16 }} aria-labelledby="markets-title">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
      >
        <h2 id="markets-title" style={{ fontSize: FS.md, fontWeight: 600 }}>
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 6,
          marginTop: 8,
        }}
      >
        {isLoading && <p style={small}>Loading…</p>}
        {!isLoading && !prices.length && <p style={small}>Prices not available right now.</p>}
        {movers.map((m) => (
          <Link
            key={m.id}
            href={`/crypto/${m.id}`}
            style={{
              minHeight: 44,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '0 10px',
              borderRadius: 8,
              background: 'var(--bg-secondary)',
              textDecoration: 'none',
              color: 'var(--text-primary)',
              fontSize: FS.sm,
            }}
          >
            <b>{m.symbol}</b>
            <span style={{ color: changeColor(m.change24h), fontSize: FS.xs }}>
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
              fontSize: FS.sm,
            }}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </section>
  )
}
