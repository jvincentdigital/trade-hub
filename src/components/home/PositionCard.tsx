'use client'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useRecentCandles } from '@/lib/hooks/useMarketData'
import { formatQuote, getInstrument } from '@/lib/paper/instruments'
import type { OpenPosition, PositionMetrics, PositionStatus } from '@/lib/positions/positions'
import { MiniChart } from './MiniChart'
import { ago, usd, signedUsd, pct } from './format'

const TAG: Record<PositionStatus, { fg: string; bg: string }> = {
  'Near target': { fg: 'var(--green)', bg: 'var(--green-dim)' },
  'Near stop': { fg: 'var(--red)', bg: 'var(--red-dim)' },
  'No stop': { fg: 'var(--amber)', bg: 'var(--amber-dim)' },
  Running: { fg: 'var(--indigo)', bg: 'var(--indigo-dim)' },
  'No price': { fg: 'var(--text-secondary)', bg: 'var(--bg-hover)' },
}

export function StatusTag({ status }: { status: PositionStatus }) {
  const c = TAG[status]
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: c.fg,
        background: c.bg,
        borderRadius: 999,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  )
}

export function PositionCard({ pos, m }: { pos: OpenPosition; m: PositionMetrics }) {
  const inst = getInstrument(pos.market)
  const symbol = inst?.label ?? inst?.symbol ?? pos.market
  const { candles } = useRecentCandles(pos.market, inst?.market === 'forex')
  const q = (v: number) => formatQuote(v, inst)
  const isBuy = pos.side === 'long'
  const sizeUsd = pos.usdPerQuote != null ? pos.units * pos.entry * pos.usdPerQuote : null
  const pnlColor =
    m.pnl == null ? 'var(--text-secondary)' : m.pnl >= 0 ? 'var(--green)' : 'var(--red)'

  return (
    <article
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {symbol}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: isBuy ? 'var(--green)' : 'var(--red)',
                border: `1px solid ${isBuy ? 'var(--green)' : 'var(--red)'}`,
                borderRadius: 5,
                padding: '0 6px',
              }}
            >
              {isBuy ? 'BUY' : 'SELL'}
            </span>
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {pos.by} · opened {ago(pos.openedAt)}
          </p>
        </div>
        <StatusTag status={m.status} />
      </header>

      <MiniChart
        candles={candles}
        entry={pos.entry}
        stop={pos.stop}
        target={pos.target}
        price={m.price}
        label={`${symbol} recent candles with entry, stop and target lines`}
      />

      <div
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
      >
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, color: pnlColor, lineHeight: 1.1 }}>
            {m.pnl == null ? '-' : signedUsd(m.pnl)}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {m.pnlPct == null ? 'no live price yet' : `${pct(m.pnlPct, true)} since entry`}
          </p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
          <p>
            Now <b style={{ color: 'var(--text-primary)' }}>{m.price ? q(m.price) : '-'}</b>
          </p>
          <p>Entry {q(pos.entry)}</p>
        </div>
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <Level
          title="Stop loss"
          color="var(--red)"
          price={pos.stop != null ? q(pos.stop) : 'none set'}
          away={m.toStopPct != null ? `${pct(m.toStopPct)} away` : null}
          dollars={m.toStopUsd != null ? `-${usd(m.toStopUsd)} from here` : null}
        />
        <Level
          title="Take profit"
          color="var(--green)"
          price={pos.target != null ? q(pos.target) : 'none set'}
          away={m.toTargetPct != null ? `${pct(m.toTargetPct)} away` : null}
          dollars={m.toTargetUsd != null ? `+${usd(m.toTargetUsd)} from here` : null}
        />
      </dl>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Size {sizeUsd != null ? usd(sizeUsd) : '-'}
        {pos.source === 'demo' && ` (${+pos.units.toPrecision(4)} units)`}
        {m.atStopUsd != null && ` · risk ${usd(Math.abs(m.atStopUsd))}`}
        {m.atTargetUsd != null && ` · aim ${usd(m.atTargetUsd)}`}
      </p>

      <Link
        href={pos.source === 'demo' ? '/demo' : '/race'}
        style={{
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderRadius: 9,
          background: 'var(--bg-hover)',
          color: 'var(--text-primary)',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {pos.source === 'demo' ? 'Manage in Demo' : 'See it in the Race'}
        <ChevronRight size={16} color="var(--text-secondary)" />
      </Link>
    </article>
  )
}

function Level(props: {
  title: string
  color: string
  price: string
  away: string | null
  dollars: string | null
}) {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        borderRadius: 8,
        padding: '8px 10px',
        borderLeft: `3px solid ${props.color}`,
        minWidth: 0,
      }}
    >
      <dt style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{props.title}</dt>
      <dd style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{props.price}</dd>
      {props.away && <dd style={{ color: 'var(--text-secondary)' }}>{props.away}</dd>}
      {props.dollars && <dd style={{ color: props.color }}>{props.dollars}</dd>}
    </div>
  )
}
