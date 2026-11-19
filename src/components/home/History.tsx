'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { OHLCCandle } from '@/lib/types/market'
import { formatQuote, getInstrument } from '@/lib/paper/instruments'
import { REASON_TEXT } from '@/lib/race/live'
import {
  FIRST_READ,
  candlesAround,
  type HistoryTrade,
  type Scorecard,
  type Yardstick,
} from '@/lib/positions/history'
import { MINUS, usdShort } from '@/lib/positions/today'
import { sizeText, sizingOf } from '@/lib/sizing/sizing'
import { Checklist } from './Checklist'
import { MiniChart } from './MiniChart'
import { rowId } from './TradeRow'
import { FS, card, clock, num, pnlText, secondary, tone } from './ui'

/** "+0.28R", "−1.43R". */
const rText = (r: number | null) =>
  r == null ? '-' : `${r < 0 ? MINUS : '+'}${Math.abs(r).toFixed(2)}R`
const pctText = (share: number) => `${+(share * 100).toFixed(1)}%`

/** "3 h 45 min", "2 days 4 h". */
function held(sec: number): string {
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  return `${Math.floor(h / 24)} days ${h % 24} h`
}

interface Props {
  trades: HistoryTrade[]
  score: Scorecard
  yardstick: Yardstick | null
  /** "Funded test $10K, v1 only". */
  account: string
  /** Strategy id to its name. */
  nameOf: (strategy: string) => string
  candles: Record<string, OHLCCandle[]>
  candlesLoading: boolean
  loading: boolean
  now: number
}

/**
 * Today's trade history: a scorecard (live numbers next to the strategy's
 * past test: for v1 the six older years of its exam), then every closed trade of the shown funded account, newest
 * first. A row opens in place to its chart and where the money went.
 */
export function History(p: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const { trades, score: s, yardstick: y } = p
  const left = Math.max(0, FIRST_READ - s.trades)
  const weeks = y && left > 0 ? Math.ceil(left / y.tradesPerWeek) : null

  return (
    <section aria-labelledby="history-title">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 id="history-title" style={{ fontSize: FS.lg, fontWeight: 700 }}>
          Trade history
        </h2>
        <p style={{ ...secondary, fontSize: FS.xs }}>{p.account}</p>
      </div>

      <div style={{ ...card, padding: 16, margin: '12px 0 10px' }}>
        <h3 style={{ fontSize: FS.md, fontWeight: 600 }}>Scorecard</h3>
        <p style={{ ...secondary, fontSize: FS.xs, marginTop: 2 }}>
          {y
            ? `Live so far, next to ${y.source}.`
            : 'Live so far. The breakout trades have no past test to compare with.'}
        </p>
        <dl
          style={{
            ...num,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 8,
            marginTop: 12,
          }}
        >
          <Tile
            title="Closed trades"
            value={`${s.trades} of ${FIRST_READ}`}
            sub="needed for a first read"
          />
          <Tile
            title="Won"
            value={s.winRate == null ? '-' : `${s.wins} of ${s.trades}`}
            sub={y ? `older years: ${pctText(y.winRate)}` : 'no past test'}
          />
          <Tile
            title="Average per trade"
            value={rText(s.avgR)}
            color={tone(s.avgR)}
            sub={y ? `older years: ${rText(y.avgR)}` : 'no past test'}
          />
          <Tile title="Average loss" value={rText(s.avgLossR)} sub={`the plan is ${MINUS}1R`} />
          <Tile
            title="Worst drop"
            value={pctText(s.maxDrawdown)}
            sub={y ? `older years: ${pctText(y.maxDrawdown)}` : 'no past test'}
          />
          <Tile title="Fees paid" value={usdShort(s.fees)} sub="inside every result" />
        </dl>
        <p style={{ ...secondary, fontSize: FS.xs, marginTop: 12, lineHeight: 1.5 }}>
          R is what a trade risked at its stop: +1R won that much, {MINUS}1R lost a full stop.{' '}
          {left > 0
            ? `With ${s.trades} closed ${s.trades === 1 ? 'trade' : 'trades'} this is still luck, not a result${weeks ? `: at about ${Math.round(y!.tradesPerWeek)} trades a week the first read is roughly ${weeks} weeks away` : ''}.`
            : 'Enough trades for a first read. About 100 make it solid.'}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {trades.length === 0 ? (
          <div
            style={{
              ...card,
              ...secondary,
              padding: '28px 18px',
              textAlign: 'center',
              fontSize: FS.sm,
            }}
          >
            {p.loading ? 'Loading your trades…' : 'No closed trades in this account yet.'}
          </div>
        ) : (
          trades.map((t) => (
            <HistoryRow
              key={t.key}
              t={t}
              by={p.nameOf(t.strategy)}
              candles={p.candles[t.market] ?? []}
              candlesLoading={p.candlesLoading}
              now={p.now}
              open={openKey === t.key}
              onToggle={() => setOpenKey(openKey === t.key ? null : t.key)}
            />
          ))
        )}
      </div>
    </section>
  )
}

/** Dollars lost, kept on one line: "−$71.95". */
function Money({ n }: { n: number }) {
  return (
    <span style={{ ...num, whiteSpace: 'nowrap' }}>
      {MINUS}
      {usdShort(n)}
    </span>
  )
}

function Tile(props: { title: string; value: string; sub: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: '10px 12px' }}>
      <dt style={{ ...secondary, fontSize: FS.xs }}>{props.title}</dt>
      <dd style={{ margin: '2px 0 0', fontSize: FS.md, fontWeight: 700, color: props.color }}>
        {props.value}
      </dd>
      <dd style={{ ...secondary, margin: '2px 0 0', fontSize: FS.xs }}>{props.sub}</dd>
    </div>
  )
}

function HistoryRow(props: {
  t: HistoryTrade
  by: string
  candles: OHLCCandle[]
  candlesLoading: boolean
  now: number
  open: boolean
  onToggle: () => void
}) {
  const { t, open, now } = props
  const inst = getInstrument(t.market)
  const name = inst?.label ?? inst?.symbol ?? t.market
  const id = rowId(`history-${t.key}`)
  const isBuy = t.side === 'long'
  const q = (v: number) => formatQuote(v, inst)
  const how = `${t.tookPart ? 'half at the first target, the rest ' : ''}${REASON_TEXT[t.reason]}`

  return (
    <article
      className="trade"
      style={{
        ...card,
        overflow: 'hidden',
        borderColor: open ? 'var(--border-hover)' : 'var(--border)',
      }}
    >
      <button
        type="button"
        className="trade-head"
        data-pill="no"
        aria-expanded={open}
        aria-controls={`panel-${id}`}
        onClick={props.onToggle}
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
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gridTemplateAreas: "'mk pnl' 'meta meta'",
        }}
      >
        <span
          style={{
            gridArea: 'mk',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '4px 8px',
            minWidth: 0,
          }}
        >
          <strong style={{ fontSize: FS.md, fontWeight: 600, whiteSpace: 'nowrap' }}>{name}</strong>
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
            color: tone(t.pnl),
            whiteSpace: 'nowrap',
          }}
        >
          {pnlText(t.pnl)}
          <span style={{ ...secondary, fontSize: FS.xs, fontWeight: 600 }}>{rText(t.r)}</span>
          <ChevronDown
            size={18}
            aria-hidden
            color="var(--text-secondary)"
            style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}
          />
        </span>
        <span style={{ ...secondary, gridArea: 'meta', fontSize: FS.sm, minWidth: 0 }}>
          {props.by}, {how},{' '}
          <span style={{ whiteSpace: 'nowrap' }}>{clock(t.exitTime * 1000, now)}</span>
        </span>
      </button>
      {open && <HistoryPanel id={id} {...props} q={q} />}
    </article>
  )
}

function HistoryPanel(props: {
  id: string
  t: HistoryTrade
  candles: OHLCCandle[]
  candlesLoading: boolean
  now: number
  q: (v: number) => string
}) {
  const { t, q, now } = props
  const inst = getInstrument(t.market)
  const candles = candlesAround(props.candles, t)
  const size = sizingOf({
    inst,
    units: t.units,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    usdPerQuote: t.usdPerQuote,
  })
  // Where a loss came from: the planned stop, a fill past the stop, the fees.
  const lostMore = t.reason === 'stop' && t.pnl < 0 && -t.pnl > t.risk + 0.5
  const facts: [string, string][] = [
    ['Opened', clock(t.entryTime * 1000, now)],
    ['Closed', `${clock(t.exitTime * 1000, now)} (${held(t.exitTime - t.entryTime)})`],
    ['Entry', q(t.entry)],
    ['Exit', q(t.exit)],
    ['Stop', q(t.stop)],
    ['Target', q(t.target)],
    ['Size', sizeText(inst, size)],
    ['Risk at the stop', usdShort(t.risk)],
  ]

  return (
    <div id={`panel-${props.id}`} className="trade-panel" style={{ padding: '2px 16px 16px' }}>
      <figure style={{ margin: 0, minWidth: 0 }}>
        <MiniChart
          candles={candles}
          loading={props.candlesLoading}
          entry={t.entry}
          stop={t.stop}
          target={t.target}
          exit={{ price: t.exit, at: t.exitTime * 1000 }}
          openedAt={t.entryTime * 1000}
          fmt={q}
          label={`${inst?.symbol ?? t.market} ${t.side === 'long' ? 'buy' : 'sell'}: the candles around the trade with its entry, stop, target and exit`}
        />
        <figcaption style={{ ...secondary, marginTop: 6, fontSize: FS.xs }}>
          {candles.length
            ? '1-hour candles from a day before the entry to half a day after the exit. Dotted line: when it opened. Dot: where it closed.'
            : 'Charts go back 30 days.'}
        </figcaption>
      </figure>

      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        <dl
          style={{
            ...num,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '6px 14px',
            margin: 0,
            fontSize: FS.sm,
          }}
        >
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={secondary}>{k}</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{v}</dd>
            </div>
          ))}
        </dl>
        {lostMore && (
          <p style={{ ...secondary, fontSize: FS.sm, lineHeight: 1.5 }}>
            <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              Why it lost more than the plan.
            </b>{' '}
            The stop was worth <Money n={t.risk} />.
            {t.slip > 0.5 && (
              <>
                {' '}
                It filled past the stop price: <Money n={t.slip} /> more.
              </>
            )}{' '}
            Fees: <Money n={t.fees} />.
          </p>
        )}
        <div style={{ display: 'grid', gap: 4 }}>
          <p style={{ fontSize: FS.sm, fontWeight: 600 }}>Checklist at entry</p>
          <Checklist checks={t.checks} fontSize={FS.sm} />
        </div>
      </div>
    </div>
  )
}
