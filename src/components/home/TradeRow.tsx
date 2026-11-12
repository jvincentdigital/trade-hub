'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { OHLCCandle } from '@/lib/types/market'
import type { Rule } from '@/lib/rules/schema'
import { LEVERAGE } from '@/lib/paper/engine'
import { formatQuote, getInstrument, type Instrument } from '@/lib/paper/instruments'
import type { OpenPosition, PositionMetrics, PositionStatus } from '@/lib/positions/positions'
import { MINUS, rowLine, signedShort, track, usdShort, whyLevels } from '@/lib/positions/today'
import { fmtLots, perMoney, qty, rrText, sizingOf } from '@/lib/sizing/sizing'
import { hasIntraday } from '@/lib/feeds'
import { MiniChart } from './MiniChart'
import { pct, usd } from './format'
import { FS, button, card, clock, num, pnlText, secondary, tone } from './ui'

/** Only these get a pill; plain Running (and No price) stay quiet. */
const PILL: Partial<Record<PositionStatus, { color: string; background: string }>> = {
  'Near target': { color: 'var(--green)', background: 'var(--green-dim)' },
  'Near stop': { color: 'var(--red)', background: 'var(--red-dim)' },
  'No stop': { color: 'var(--amber)', background: 'var(--amber-dim)' },
}

export const rowId = (key: string) => key.replace(/[^a-z0-9]/gi, '-')

interface Props {
  pos: OpenPosition
  m: PositionMetrics
  /** Every candle loaded for this market (the chart shows the latest). */
  candles: OHLCCandle[]
  /** The candle fetch is still running (no candles yet means "loading", not "none"). */
  candlesLoading: boolean
  rule?: Rule
  now: number
  open: boolean
  onToggle: () => void
  onClose: () => void
  /** Race trades: when Close now was tapped (ms), until the race books it. */
  closeRequestedAt?: number
  /** Race trades: ask the next race check to close it. Rejects with a plain message. */
  onCloseNow?: () => Promise<void>
}

export function TradeRow(props: Props) {
  const { pos, m, candles, candlesLoading, rule, now, open, onToggle, onClose } = props
  const requested = props.closeRequestedAt
  const inst = getInstrument(pos.market)
  const name = inst?.label ?? inst?.symbol ?? pos.market
  const id = rowId(pos.key)
  const isBuy = pos.side === 'long'
  const bar = track(pos, m.price)
  const pill = PILL[m.status]

  return (
    <article
      id={`row-${id}`}
      className="trade"
      style={{
        ...card,
        overflow: 'hidden',
        borderColor: open ? 'var(--border-hover)' : 'var(--border)',
      }}
    >
      <button
        id={`head-${id}`}
        type="button"
        className="trade-head"
        data-pill={pill ? 'yes' : 'no'}
        aria-expanded={open}
        aria-controls={`panel-${id}`}
        onClick={onToggle}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '14px 16px',
          textAlign: 'left',
          background: 'transparent',
          border: 0,
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span
          style={{ gridArea: 'mk', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
        >
          <strong
            style={{
              fontSize: FS.md,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name}
          </strong>
          <span
            style={{
              flex: 'none',
              fontSize: FS.xs,
              fontWeight: 600,
              padding: '1px 8px',
              borderRadius: 6,
              color: isBuy ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${isBuy ? 'var(--green)' : 'var(--red)'}`,
            }}
          >
            {isBuy ? 'Buy' : 'Sell'}
          </span>
        </span>
        <span
          style={{
            ...num,
            gridArea: 'pnl',
            justifySelf: 'end',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: FS.md,
            fontWeight: 700,
            color: tone(m.pnl),
            whiteSpace: 'nowrap',
          }}
        >
          {pnlText(m.pnl)}
          <ChevronDown
            size={18}
            aria-hidden
            color="var(--text-secondary)"
            style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}
          />
        </span>
        <span
          className="trade-meta"
          style={{ ...secondary, gridArea: 'meta', fontSize: FS.sm, minWidth: 0 }}
        >
          {pos.by}, <span style={{ whiteSpace: 'nowrap' }}>opened {clock(pos.openedAt, now)}</span>
        </span>
        {pill && (
          <span
            style={{
              ...pill,
              gridArea: 'status',
              justifySelf: 'end',
              alignSelf: 'center',
              fontSize: FS.xs,
              fontWeight: 600,
              padding: '2px 10px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
            }}
          >
            {m.status}
          </span>
        )}
        {bar && (
          <span
            aria-hidden
            style={{
              ...secondary,
              ...num,
              gridArea: 'track',
              // Fixed label columns, so the bar starts and ends at the same x on every row.
              display: 'grid',
              gridTemplateColumns: 'minmax(5.5em, max-content) 1fr minmax(8.5em, max-content)',
              alignItems: 'center',
              gap: 8,
              fontSize: FS.xs,
              whiteSpace: 'nowrap',
              marginTop: 4,
            }}
          >
            <span>Stop {m.atStopUsd != null && signedShort(m.atStopUsd)}</span>
            <StopTargetBar entryAt={bar.entryAt} nowAt={bar.nowAt} />
            <span style={{ textAlign: 'right' }}>
              Target {m.atTargetUsd != null && signedShort(m.atTargetUsd)}
            </span>
          </span>
        )}
        {requested ? (
          <span style={{ gridArea: 'line', fontSize: FS.xs, color: 'var(--amber)' }}>
            Close requested, books at the next check
          </span>
        ) : (
          <span style={{ ...secondary, gridArea: 'line', fontSize: FS.xs }}>{rowLine(pos, m)}</span>
        )}
      </button>
      {pos.note && (
        <p style={{ ...secondary, fontSize: FS.xs, padding: '0 16px 12px' }}>
          <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Claude&apos;s reason:</b>{' '}
          {pos.note}
        </p>
      )}
      {open && (
        <Panel
          id={id}
          pos={pos}
          m={m}
          inst={inst}
          candles={candles}
          candlesLoading={candlesLoading}
          rule={rule}
          onClose={onClose}
          closeNow={
            props.onCloseNow && (
              <CloseNow
                name={`${inst?.symbol ?? pos.market} ${pos.side === 'long' ? 'buy' : 'sell'}`}
                account={pos.account}
                requestedAt={requested}
                now={now}
                onConfirm={props.onCloseNow}
              />
            )
          }
        />
      )}
    </article>
  )
}

/** Thin bar from the stop (left) to the target (right): entry tick, fill to the price dot. */
function StopTargetBar({ entryAt, nowAt }: { entryAt: number; nowAt: number | null }) {
  const e = entryAt * 100
  const n = nowAt == null ? null : nowAt * 100
  return (
    <span
      style={{
        position: 'relative',
        minWidth: 60,
        height: 6,
        borderRadius: 999,
        background: 'var(--border)',
      }}
    >
      {n != null && (
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${Math.min(e, n)}%`,
            width: `${Math.abs(n - e)}%`,
            borderRadius: 999,
            background: n >= e ? 'var(--green)' : 'var(--red)',
          }}
        />
      )}
      <span
        style={{
          position: 'absolute',
          top: -4,
          bottom: -4,
          left: `${e}%`,
          width: 2,
          marginLeft: -1,
          borderRadius: 2,
          background: 'var(--line-strong)',
        }}
      />
      {n != null && (
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: `${n}%`,
            width: 12,
            height: 12,
            margin: '-6px 0 0 -6px',
            borderRadius: '50%',
            background: 'var(--indigo)',
            border: '2px solid var(--text-primary)',
          }}
        />
      )}
    </span>
  )
}

function Panel(props: {
  id: string
  pos: OpenPosition
  m: PositionMetrics
  inst: Instrument | undefined
  candles: OHLCCandle[]
  candlesLoading: boolean
  rule?: Rule
  onClose: () => void
  closeNow?: React.ReactNode
}) {
  const { id, pos, m, inst, rule, onClose } = props
  // Same as Esc: collapse, then keep focus on this row's head.
  const close = () => {
    onClose()
    document.getElementById(`head-${id}`)?.focus()
  }
  const q = (v: number) => formatQuote(v, inst)
  // Forex without intraday candles (ECB rates) shows daily candles.
  const daily = inst?.market === 'forex' && !hasIntraday(pos.market)
  const candles = props.candles.slice(daily ? -40 : -48)
  const size = sizingOf({
    inst,
    units: pos.units,
    entry: pos.entry,
    stop: pos.stop,
    target: pos.target,
    usdPerQuote: pos.usdPerQuote,
  })
  const lev = inst ? LEVERAGE[inst.market] : 1
  const base = inst?.symbol.split('/')[0] ?? ''
  const stopAway =
    pos.stop == null
      ? null
      : size.stopPips != null
        ? `stop ${size.stopPips.toFixed(1)} pips away`
        : `stop $${q(Math.abs(pos.entry - pos.stop))} away`
  const caption = daily
    ? `Daily candles since ${candles[0] ? new Date(candles[0].time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}. Dot: price now, which updates once a day.`
    : `Last 48 hours, 1-hour candles.${candles[0] && pos.openedAt >= candles[0].time * 1000 ? ' Dotted line: when it opened.' : ''} Dot: price now.`

  return (
    <div id={`panel-${id}`} className="trade-panel" style={{ padding: '2px 16px 16px' }}>
      <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
        <figure style={{ margin: 0 }}>
          <MiniChart
            candles={candles}
            loading={props.candlesLoading}
            entry={pos.entry}
            stop={pos.stop}
            target={pos.target}
            price={m.price}
            openedAt={pos.openedAt}
            fmt={q}
            label={`${inst?.symbol ?? pos.market} ${pos.side === 'long' ? 'buy' : 'sell'}: recent candles with the entry, stop and target`}
          />
          <figcaption style={{ ...secondary, marginTop: 6, fontSize: FS.xs }}>{caption}</figcaption>
        </figure>
        <p
          style={{
            ...secondary,
            ...num,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: FS.sm,
          }}
        >
          <span>
            Now <b style={{ color: 'var(--text-primary)' }}>{m.price ? q(m.price) : '-'}</b>
            {/* The trade's move, not the price's: a sell gains when the price falls. */}
            {m.pnlPct != null && (
              <>
                {' · trade '}
                <span style={{ color: tone(m.pnlPct) }}>{pct(m.pnlPct, true)}</span>
              </>
            )}
          </span>
          <span>
            Entry <b style={{ color: 'var(--text-primary)' }}>{q(pos.entry)}</b>
          </span>
        </p>
        <p style={{ ...secondary, fontSize: FS.sm }}>
          <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Why these levels.</b>{' '}
          {whyLevels(pos, rule)}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        <dl style={{ ...num, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Level
            title="Stop"
            color="var(--red)"
            price={pos.stop != null ? q(pos.stop) : 'None set'}
            away={m.toStopPct != null ? `${pct(m.toStopPct)} away` : null}
            dollars={m.toStopUsd != null ? `${MINUS}${usdShort(m.toStopUsd)} from here` : null}
          />
          <Level
            title="Target"
            color="var(--green)"
            price={pos.target != null ? q(pos.target) : 'None set'}
            away={m.toTargetPct != null ? `${pct(m.toTargetPct)} away` : null}
            dollars={m.toTargetUsd != null ? `+${usdShort(m.toTargetUsd)} from here` : null}
          />
        </dl>
        <dl
          aria-label="Trade size"
          style={{
            ...num,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1,
            background: 'var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <Cell
            dt="Size"
            dd={size.lots != null ? `${fmtLots(size.lots)} lots` : `${qty(size.units)} ${base}`}
            small={
              inst?.market === 'forex'
                ? `${qty(size.units)} units`
                : inst?.market === 'metals'
                  ? `${qty(size.units)} oz`
                  : 'coins, no lots'
            }
          />
          <Cell
            dt={
              size.perMove === 'pip'
                ? 'Per pip'
                : size.perMove === '$1'
                  ? 'Per $1 move'
                  : 'Per 1% move'
            }
            dd={
              size.perMoveUsd != null
                ? perMoney(size.perMoveUsd)
                : size.valueUsd != null
                  ? usd(size.valueUsd / 100)
                  : '-'
            }
            small={stopAway}
          />
          <Cell
            dt="Risk at stop"
            dd={size.riskUsd != null ? `${MINUS}${usdShort(size.riskUsd)}` : 'Not capped'}
            color="var(--red)"
            small="from entry, before fees"
          />
          <Cell
            dt="Goal at target"
            dd={size.goalUsd != null ? `+${usdShort(size.goalUsd)}` : 'No target'}
            color="var(--green)"
            small={rrText(size.rr)}
          />
          <Cell
            dt="Position"
            dd={size.valueUsd != null ? usd(size.valueUsd) : '-'}
            small="value at entry"
          />
          <Cell
            dt="Margin"
            dd={size.valueUsd != null ? usd(size.valueUsd / lev) : '-'}
            small={lev > 1 ? `${lev}:1 leverage` : 'no leverage'}
          />
        </dl>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8 }}>
          <Link
            href={pos.source === 'demo' ? '/demo' : '/race'}
            style={{ ...button, whiteSpace: 'nowrap' }}
          >
            {pos.source === 'demo' ? 'Manage in Demo' : 'See it in the Race'}
            <ChevronRight size={16} aria-hidden color="var(--text-secondary)" />
          </Link>
          {/* Hide only folds the row; Close now (below) closes the trade. */}
          <button type="button" onClick={close} style={button}>
            Hide
          </button>
        </div>
        {props.closeNow}
      </div>
    </div>
  )
}

/**
 * Close now, with a confirm step. Yes stores a request; the next race check
 * books it at the open of the minute of the tap (docs/dashboard.md).
 */
function CloseNow(props: {
  name: string
  /** Funded size ("$50K"): the close is in that account only. */
  account?: string
  requestedAt?: number
  now: number
  onConfirm: () => Promise<void>
}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)
  const box: React.CSSProperties = {
    padding: '12px 14px',
    borderRadius: 12,
    background: 'var(--bg-hover)',
    fontSize: FS.sm,
  }
  if (props.requestedAt)
    return (
      <p role="status" style={{ ...box, color: 'var(--amber)' }}>
        Close requested at {clock(props.requestedAt, props.now)}. It books at the next check, at the
        price of that minute.
      </p>
    )
  if (step === 'idle')
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setStep('confirm')
          }}
          style={{ ...button, color: 'var(--red)', borderColor: 'var(--red)' }}
        >
          Close now
        </button>
        {error && (
          <p role="alert" style={{ fontSize: FS.xs, color: 'var(--red)' }}>
            {error}
          </p>
        )}
      </div>
    )
  const yes = async () => {
    setStep('sending')
    try {
      await props.onConfirm()
    } catch (e) {
      setError((e as Error).message)
      setStep('idle')
    }
  }
  return (
    <div
      role="group"
      aria-label={`Close ${props.name}?`}
      style={{ ...box, display: 'grid', gap: 10 }}
    >
      <p>
        <b style={{ fontWeight: 600 }}>Close this {props.name} now?</b>{' '}
        {props.account && (
          <span style={{ display: 'block', margin: '4px 0' }}>
            {`Only in the ${props.account} funded test. The other sizes keep their trade.`}
          </span>
        )}
        <span style={secondary}>
          It closes at the price of this minute, booked at the next race check (every 15 minutes in
          the session). Play money.
        </span>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          onClick={() => setStep('idle')}
          disabled={step === 'sending'}
          style={button}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={yes}
          disabled={step === 'sending'}
          style={{
            ...button,
            background: 'var(--red)',
            borderColor: 'var(--red)',
            color: 'var(--bg-primary)',
          }}
        >
          {step === 'sending' ? 'Sending…' : 'Yes, close it'}
        </button>
      </div>
    </div>
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
        background: 'var(--bg-hover)',
        borderRadius: 12,
        padding: '10px 12px',
        borderLeft: `3px solid ${props.color}`,
        minWidth: 0,
        fontSize: FS.xs,
      }}
    >
      <dt style={secondary}>{props.title}</dt>
      <dd style={{ fontSize: FS.md, fontWeight: 600 }}>{props.price}</dd>
      {props.away && <dd style={secondary}>{props.away}</dd>}
      {props.dollars && <dd style={{ color: props.color, fontWeight: 600 }}>{props.dollars}</dd>}
    </div>
  )
}

function Cell(props: { dt: string; dd: string; small?: string | null; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-hover)', padding: '10px 12px', minWidth: 0 }}>
      <dt style={{ ...secondary, fontSize: FS.xs }}>{props.dt}</dt>
      <dd style={{ fontSize: FS.md, fontWeight: 600, color: props.color }}>{props.dd}</dd>
      {props.small && <dd style={{ ...secondary, fontSize: FS.xs }}>{props.small}</dd>}
    </div>
  )
}
