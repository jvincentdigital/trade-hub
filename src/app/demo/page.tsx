'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { RotateCcw, X } from 'lucide-react'
import { DemoBadge } from '@/components/paper/DemoBadge'
import {
  cancelOrder,
  closePosition,
  DEFAULT_BALANCE,
  equityOf,
  FEE_RATE,
  LEVERAGE,
  placeOrder,
  positionPnl,
  sizeByRisk,
} from '@/lib/paper/engine'
import {
  formatQuote,
  getInstrument,
  INSTRUMENTS,
  quoteToUsd,
  type PriceMap,
} from '@/lib/paper/instruments'
import type { PaperAccount, Side } from '@/lib/paper/schema'
import { computeStats } from '@/lib/paper/stats'
import { planWarnings } from '@/lib/paper/plan'
import {
  resetPaperAccount,
  setPaperAccount,
  useLivePrices,
  usePaperAccount,
} from '@/lib/hooks/usePaperAccount'
import { useRules } from '@/lib/hooks/useRules'
import { perMoveText, sizeText, sizingLine, sizingOf } from '@/lib/sizing/sizing'

const usd = (n: number, sign = false) =>
  `${sign && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
const pnlColor = (n: number) =>
  n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-secondary)'

export default function DemoPage() {
  return (
    <Suspense fallback={null}>
      <DemoAccount />
    </Suspense>
  )
}

function DemoAccount() {
  const account = usePaperAccount()
  const { prices, isLoading } = useLivePrices()
  const equity = equityOf(account, prices)
  const openPnl = equity - account.cash - account.positions.reduce((a, p) => a + p.margin, 0)
  const realized = account.history.reduce((a, t) => a + t.pnl, 0)
  const ret = (equity / account.startingBalance - 1) * 100

  return (
    <div style={{ maxWidth: 1100 }}>
      <header style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Demo account</h1>
          <DemoBadge />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 2 }}>
          Cuenta demo · practice trades with play money. Nothing here reaches a broker or real
          money.
        </p>
      </header>

      <div style={grid('150px')}>
        <Stat label="Equity" value={usd(equity)} />
        <Stat label="Open P&L" value={usd(openPnl, true)} color={pnlColor(openPnl)} />
        <Stat label="Realized P&L" value={usd(realized, true)} color={pnlColor(realized)} />
        <Stat
          label={`Return on ${usd(account.startingBalance).replace('.00', '')}`}
          value={`${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`}
          color={pnlColor(ret)}
        />
      </div>

      <div style={{ ...grid('320px'), marginTop: 16, alignItems: 'start' }}>
        <OrderTicket account={account} prices={prices} equity={equity} loading={isLoading} />
        <div style={{ display: 'grid', gap: 16 }}>
          <Positions account={account} prices={prices} />
          <Performance account={account} equity={equity} />
        </div>
      </div>

      <History account={account} />
      <ResetAndNotes account={account} />
    </div>
  )
}

// ── Order ticket ──────────────────────────────────────────────────────────

function OrderTicket({
  account,
  prices,
  equity,
  loading,
}: {
  account: PaperAccount
  prices: PriceMap
  equity: number
  loading: boolean
}) {
  const params = useSearchParams()
  const initial = params.get('symbol')
  const [instrumentId, setInstrumentId] = useState(
    initial && getInstrument(initial) ? initial : 'bitcoin',
  )
  const [side, setSide] = useState<Side>('long')
  const [type, setType] = useState<'market' | 'limit'>('market')
  const [limit, setLimit] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [sizeMode, setSizeMode] = useState<'risk' | 'usd'>('risk')
  const [riskPct, setRiskPct] = useState('1')
  const [amount, setAmount] = useState('1000')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const inst = getInstrument(instrumentId)!
  const live = prices[instrumentId]
  const q = quoteToUsd(inst.quote, prices)
  const ref = type === 'limit' ? Number(limit) : live
  const sl = stop ? Number(stop) : undefined
  const tp = target ? Number(target) : undefined

  let units = 0
  if (ref && q) {
    if (sizeMode === 'usd') units = Number(amount) > 0 ? Number(amount) / (ref * q) : 0
    else if (sl)
      units = sizeByRisk({ equity, riskPct: Number(riskPct), entry: ref, stop: sl, quoteUsd: q })
  }

  const notional = units * (ref || 0) * (q || 0)
  const margin = notional / LEVERAGE[inst.market]
  const riskUsd = sl && ref && q ? Math.abs(ref - sl) * units * q : null
  const rr = sl && tp && ref ? Math.abs(tp - ref) / Math.abs(ref - sl) : null
  const size = sizingOf({ inst, units, entry: ref || 0, usdPerQuote: q })
  const per = perMoveText(size)

  const warnings = units > 0 ? planWarnings(account, prices, { riskUsd, fromStrategy: false }) : []

  const submit = () => {
    const r = placeOrder(
      account,
      {
        instrumentId,
        side,
        type,
        units,
        limitPrice: type === 'limit' ? Number(limit) : undefined,
        stopLoss: sl,
        takeProfit: tp,
      },
      prices,
    )
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setPaperAccount(r.account)
    setMsg({
      ok: true,
      text:
        type === 'limit' && r.account.pendingOrders.length > account.pendingOrders.length
          ? 'Limit order placed. It fills when the price reaches it while Trade Hub is open.'
          : `Demo ${side === 'long' ? 'buy' : 'sell'} filled at ${formatQuote(live, inst)}.`,
    })
  }

  return (
    <section style={card}>
      <SectionTitle>New demo order</SectionTitle>

      <Field label="Market">
        <select
          value={instrumentId}
          onChange={(e) => setInstrumentId(e.target.value)}
          style={input}
        >
          <optgroup label="Crypto">
            {INSTRUMENTS.filter((i) => i.market === 'crypto').map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol}
              </option>
            ))}
          </optgroup>
          <optgroup label="Gold">
            {INSTRUMENTS.filter((i) => i.market === 'metals').map((i) => (
              <option key={i.id} value={i.id}>
                {i.label ?? i.symbol}
              </option>
            ))}
          </optgroup>
          <optgroup label="Forex">
            {INSTRUMENTS.filter((i) => i.market === 'forex').map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '-4px 0 12px' }}>
        Live:{' '}
        <strong style={{ color: 'var(--text-primary)' }}>
          {live ? formatQuote(live, inst) : loading ? 'loading…' : 'unavailable'}
        </strong>
        {inst.market === 'forex' && (
          <span style={{ color: 'var(--text-muted)' }}> · forex rate updates once a day</span>
        )}
        {inst.note && <span style={{ color: 'var(--text-muted)' }}> · {inst.note}</span>}
      </p>

      <Segmented
        value={side}
        onChange={setSide}
        options={[
          { value: 'long', label: 'Buy', color: 'var(--green)' },
          { value: 'short', label: 'Sell', color: 'var(--red)' },
        ]}
      />
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: 'market', label: 'Market' },
          { value: 'limit', label: 'Limit' },
        ]}
      />

      {type === 'limit' && (
        <Field label="Limit price">
          <input
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            style={input}
            placeholder={live ? formatQuote(live, inst) : ''}
          />
        </Field>
      )}
      <div style={grid('120px', 10)}>
        <Field label="Stop loss">
          <input
            inputMode="decimal"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            style={input}
            placeholder="price"
          />
        </Field>
        <Field label="Take profit">
          <input
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={input}
            placeholder="price"
          />
        </Field>
      </div>

      <Segmented
        value={sizeMode}
        onChange={setSizeMode}
        options={[
          { value: 'risk', label: 'Size by risk %' },
          { value: 'usd', label: 'Size by $ amount' },
        ]}
      />
      {sizeMode === 'risk' ? (
        <Field label="Risk per trade (% of equity)">
          <input
            inputMode="decimal"
            value={riskPct}
            onChange={(e) => setRiskPct(e.target.value)}
            style={input}
          />
        </Field>
      ) : (
        <Field label="Position value (USD)">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={input}
          />
        </Field>
      )}

      <dl style={summary}>
        <dt>Size</dt>
        <dd>
          {units > 0
            ? `${sizeText(inst, size)}${per ? `, ${per}` : ''}`
            : sizeMode === 'risk' && !sl
              ? 'add a stop loss'
              : '-'}
        </dd>
        <dt>Value</dt>
        <dd>{usd(notional)}</dd>
        <dt>Cash needed</dt>
        <dd>
          {usd(margin + notional * FEE_RATE[inst.market])}
          {LEVERAGE[inst.market] > 1 && (
            <span style={{ color: 'var(--text-muted)' }}> · {LEVERAGE[inst.market]}:1</span>
          )}
        </dd>
        <dt>At risk</dt>
        <dd>{riskUsd !== null ? usd(riskUsd) : 'no stop'}</dd>
        <dt>Reward : risk</dt>
        <dd>{rr !== null ? `${rr.toFixed(2)} : 1` : '-'}</dd>
      </dl>

      {warnings.length > 0 && (
        <ul
          aria-label="Plan checks"
          style={{
            fontSize: 11,
            color: 'var(--amber)',
            margin: '0 0 10px',
            paddingLeft: 16,
            display: 'grid',
            gap: 2,
          }}
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <button
        onClick={submit}
        disabled={!(units > 0)}
        style={{
          ...button,
          width: '100%',
          background: side === 'long' ? 'var(--green)' : 'var(--red)',
          opacity: units > 0 ? 1 : 0.4,
          cursor: units > 0 ? 'pointer' : 'not-allowed',
        }}
      >
        Demo {side === 'long' ? 'buy' : 'sell'} {inst.symbol}
      </button>
      {msg && (
        <p
          role="status"
          style={{ fontSize: 12, marginTop: 8, color: msg.ok ? 'var(--green)' : 'var(--red)' }}
        >
          {msg.text}
        </p>
      )}
    </section>
  )
}

// ── Positions and orders ──────────────────────────────────────────────────

function Positions({ account, prices }: { account: PaperAccount; prices: PriceMap }) {
  const { rules } = useRules()
  const ruleName = (id?: string) => rules.find((r) => r.id === id)?.name
  const close = (id: string) => {
    const r = closePosition(account, id, prices)
    if (r.ok) setPaperAccount(r.account)
  }
  return (
    <section style={card}>
      <SectionTitle>Open positions ({account.positions.length})</SectionTitle>
      {account.positions.length === 0 && (
        <Empty>No open demo trades. Place one with the ticket.</Empty>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {account.positions.map((p) => {
          const inst = getInstrument(p.instrumentId)
          const price = prices[p.instrumentId]
          const q = inst ? quoteToUsd(inst.quote, prices) : null
          const pnl = price && q ? positionPnl(p, price, q) : 0
          const size = sizingOf({
            inst,
            units: p.units,
            entry: p.entryPrice,
            stop: p.stopLoss,
            target: p.takeProfit,
            usdPerQuote: q,
          })
          return (
            <div key={p.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  <span style={{ color: p.side === 'long' ? 'var(--green)' : 'var(--red)' }}>
                    {p.side === 'long' ? 'BUY' : 'SELL'}
                  </span>{' '}
                  {inst?.symbol}
                </div>
                <div style={meta}>
                  {formatQuote(p.entryPrice, inst)} → {price ? formatQuote(price, inst) : '…'}
                </div>
                <div style={meta}>{sizingLine(inst, size)}</div>
                <div style={meta}>
                  SL {p.stopLoss ? formatQuote(p.stopLoss, inst) : '-'} · TP{' '}
                  {p.takeProfit ? formatQuote(p.takeProfit, inst) : '-'}
                  {ruleName(p.strategyId) && ` · ${ruleName(p.strategyId)}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: pnlColor(pnl),
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {usd(pnl, true)}
                </span>
                <button
                  onClick={() => close(p.id)}
                  style={smallButton}
                  aria-label={`Close ${inst?.symbol}`}
                >
                  Close
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {account.pendingOrders.length > 0 && (
        <>
          <SectionTitle style={{ marginTop: 16 }}>
            Waiting limit orders ({account.pendingOrders.length})
          </SectionTitle>
          <div style={{ display: 'grid', gap: 8 }}>
            {account.pendingOrders.map((o) => {
              const inst = getInstrument(o.instrumentId)
              return (
                <div key={o.id} style={row}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {o.side === 'long' ? 'Buy' : 'Sell'} {inst?.symbol} at{' '}
                      {formatQuote(o.limitPrice, inst)}
                    </div>
                    <div style={meta}>
                      now {prices[o.instrumentId] ? formatQuote(prices[o.instrumentId], inst) : '…'}{' '}
                      · SL {o.stopLoss ? formatQuote(o.stopLoss, inst) : '-'} · TP{' '}
                      {o.takeProfit ? formatQuote(o.takeProfit, inst) : '-'}
                    </div>
                  </div>
                  <button
                    onClick={() => setPaperAccount(cancelOrder(account, o.id))}
                    style={smallButton}
                    aria-label="Cancel order"
                  >
                    <X size={12} /> Cancel
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

// ── Performance ───────────────────────────────────────────────────────────

function Performance({ account, equity }: { account: PaperAccount; equity: number }) {
  const curve = [...account.equity.map((p) => p.equity), equity]
  const s = computeStats(
    account.history.map((t) => t.pnl),
    curve,
  )
  return (
    <section style={card}>
      <SectionTitle>Performance</SectionTitle>
      <EquityCurve values={curve} base={account.startingBalance} />
      <div style={{ ...grid('100px', 8), marginTop: 12 }}>
        <Mini label="Trades" value={String(s.trades)} />
        <Mini
          label="Win rate"
          value={s.winRate === null ? '-' : `${(s.winRate * 100).toFixed(0)}%`}
        />
        <Mini
          label="Profit factor"
          value={s.profitFactor === null ? (s.wins ? 'no losses' : '-') : s.profitFactor.toFixed(2)}
        />
        <Mini label="Max drawdown" value={`${(s.maxDrawdown * 100).toFixed(1)}%`} />
        <Mini label="Avg win" value={s.wins ? usd(s.avgWin) : '-'} />
        <Mini label="Avg loss" value={s.losses ? usd(s.avgLoss) : '-'} />
      </div>
    </section>
  )
}

function EquityCurve({ values, base }: { values: number[]; base: number }) {
  if (values.length < 2) return <Empty>The equity curve appears after your first trade.</Empty>
  const w = 300
  const h = 80
  // At least a ±1% window around the start so pennies don't look like a crash.
  const min = Math.min(...values, base * 0.99)
  const max = Math.max(...values, base * 1.01)
  const span = max - min
  const y = (v: number) => (h - ((v - min) / span) * (h - 4) - 2).toFixed(1)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${y(v)}`)
  const up = values[values.length - 1] >= base
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 80, display: 'block' }}
      role="img"
      aria-label="Equity curve"
    >
      <line
        x1="0"
        x2={w}
        y1={y(base)}
        y2={y(base)}
        stroke="var(--border-hover)"
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        fill="none"
        stroke={up ? 'var(--green)' : 'var(--red)'}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        points={pts.join(' ')}
      />
    </svg>
  )
}

function History({ account }: { account: PaperAccount }) {
  const rows = [...account.history].reverse().slice(0, 50)
  return (
    <section style={{ ...card, marginTop: 16 }}>
      <SectionTitle>Trade history ({account.history.length})</SectionTitle>
      {rows.length === 0 && <Empty>Closed demo trades show up here.</Empty>}
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((t) => {
          const inst = getInstrument(t.instrumentId)
          return (
            <div key={t.id} style={{ ...row, padding: '8px 10px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {t.side === 'long' ? 'Buy' : 'Sell'} {inst?.symbol}{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                    ·{' '}
                    {t.reason === 'stop'
                      ? 'stopped out'
                      : t.reason === 'target'
                        ? 'target hit'
                        : 'closed'}
                  </span>
                </div>
                <div style={meta}>
                  {formatQuote(t.entryPrice, inst)} → {formatQuote(t.exitPrice, inst)} ·{' '}
                  {new Date(t.closedAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: pnlColor(t.pnl),
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {usd(t.pnl, true)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ResetAndNotes({ account }: { account: PaperAccount }) {
  const [confirming, setConfirming] = useState(false)
  const [balance, setBalance] = useState(String(account.startingBalance || DEFAULT_BALANCE))
  return (
    <section style={{ ...card, marginTop: 16, display: 'grid', gap: 12 }}>
      <SectionTitle>Reset and data notes</SectionTitle>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label="Starting balance (play money)">
          <input
            inputMode="numeric"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            style={{ ...input, width: 160 }}
          />
        </Field>
        {confirming ? (
          <>
            <button
              style={{ ...button, background: 'var(--red)', marginBottom: 12 }}
              onClick={() => {
                resetPaperAccount(Number(balance) > 0 ? Number(balance) : DEFAULT_BALANCE)
                setConfirming(false)
              }}
            >
              Yes, wipe demo account
            </button>
            <button
              style={{ ...smallButton, marginBottom: 12 }}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button style={{ ...smallButton, marginBottom: 12 }} onClick={() => setConfirming(true)}>
            <RotateCcw size={12} /> Reset account
          </button>
        )}
      </div>
      <ul
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          paddingLeft: 16,
          display: 'grid',
          gap: 4,
        }}
      >
        <li>Crypto prices come from CoinGecko and refresh about once a minute.</li>
        <li>
          Gold (XAU/USD) is priced by PAX Gold on CoinGecko, a token that tracks one ounce of gold;
          it refreshes like crypto. Up to 20:1 leverage, the retail cap for gold.
        </li>
        <li>
          Forex rates come from a free daily feed: they change about once a day, so forex here is
          for slow swing practice, not intraday.
        </li>
        <li>
          Limit orders, stops and targets are checked only while Trade Hub is open in a browser tab.
        </li>
        <li>
          Each trade pays a cost on open and close (crypto 0.1%, forex about 0.7 pip, gold 0.02%) so
          results are not flattered.
        </li>
        <li>Saved in this browser only. Clearing site data wipes the demo account.</li>
      </ul>
    </section>
  )
}

// ── Small UI pieces (inline styles, matching the rest of the app) ─────────

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 10,
  padding: '14px 16px',
  minWidth: 0,
}
const input: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 7,
  padding: '9px 10px',
  color: 'var(--text-primary)',
  fontSize: 14,
  minHeight: 44,
}
const button: React.CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '11px 14px',
  color: 'white',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 44,
}
const smallButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 7,
  padding: '8px 12px',
  color: 'var(--text-secondary)',
  fontSize: 12,
  cursor: 'pointer',
  minHeight: 44,
}
const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
}
const meta: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginTop: 2,
  fontVariantNumeric: 'tabular-nums',
}
const summary: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '4px 12px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  margin: '4px 0 14px',
  fontVariantNumeric: 'tabular-nums',
}
const grid = (min: string, gap = 12): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}, 100%), 1fr))`,
  gap,
})

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginTop: 2,
          color: color ?? 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

function SectionTitle({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <h2
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 10,
        ...style,
      }}
    >
      {children}
    </h2>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>{children}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; color?: string }[]
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--bg-secondary)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 3,
        marginBottom: 12,
      }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 44,
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              background: active ? (o.color ?? 'var(--indigo)') : 'transparent',
              color: active ? 'white' : 'var(--text-secondary)',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
