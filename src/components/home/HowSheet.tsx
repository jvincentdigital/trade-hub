'use client'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { formatQuote, getInstrument } from '@/lib/paper/instruments'
import type { OpenPosition } from '@/lib/positions/positions'
import { shortName, sideWord, signedShort, usdShort } from '@/lib/positions/today'
import { FUNDED, type FundedTestId } from '@/lib/race/funded'
import { JOHNS_LONDON } from '@/lib/race/johnsLondonLive'
import { V1 } from '@/lib/lab/johnsLondon'
import { perMoveText, sizeText, sizingOf } from '@/lib/sizing/sizing'
import { FS, button, secondary } from './ui'

// Today follows a funded test: v1 only takes John's London v1 signals, v1 +
// breakouts the London breakout's too (src/lib/race/funded.ts). Facts from v1's
// frozen settings, so the text stays true.

/** One real open trade worked through: stop distance, size, $ per pip, goal. */
function example(pos: OpenPosition | undefined): string | null {
  if (!pos || pos.stop == null || pos.target == null) return null
  const inst = getInstrument(pos.market)
  const s = sizingOf({ inst, ...pos })
  if (s.riskUsd == null || s.goalUsd == null || s.rr == null) return null
  const q = (v: number) => formatQuote(v, inst)
  const away =
    s.stopPips != null
      ? `${s.stopPips.toFixed(1)} pips`
      : `$${formatQuote(Math.abs(pos.entry - pos.stop), inst)}`
  const per = perMoveText(s)
  return `${shortName(pos.market)} ${sideWord(pos.side)} at ${q(pos.entry)}, stop ${q(pos.stop)}, ${away} away. Risking ${usdShort(s.riskUsd)} over that distance makes the size ${sizeText(inst, s)}${per ? `, ${per}` : ''}. The target is ${+s.rr.toFixed(2)} times as far, so the goal is ${signedShort(s.goalUsd)}.`
}

/**
 * Bottom sheet (centered on wide screens). `open` comes from the URL, so the
 * browser Back button closes it; Esc and the backdrop call onClose too.
 */
export function HowSheet(props: {
  open: boolean
  onClose: () => void
  sample?: OpenPosition
  startMoney: number
  test: FundedTestId
}) {
  const { open, onClose, startMoney } = props
  const ref = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const ex = example(props.sample)
  const risk = (startMoney * FUNDED.sizing.riskPct) / 100
  const b = { color: 'var(--text-primary)', fontWeight: 600 }
  const both = props.test === 'breakouts'

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="how-title"
      // Esc closes the dialog natively; keep the URL in step.
      onClose={() => openRef.current && onClose()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* The sheet sits on the bottom edge on phones: keep Got it above the home bar. */}
      <div style={{ padding: '8px 20px calc(20px + env(safe-area-inset-bottom))' }}>
        <div
          aria-hidden
          className="sheet-grab"
          style={{
            width: 40,
            height: 4,
            borderRadius: 4,
            background: 'var(--border-hover)',
            margin: '4px auto 6px',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h2 id="how-title" style={{ fontSize: FS.lg, fontWeight: 700 }}>
            How trades are placed
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ ...button, width: 44, padding: 0, background: 'var(--bg-hover)', border: 0 }}
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <p style={{ ...secondary, fontSize: FS.sm, margin: '6px 0 14px' }}>
          Play money only. Nothing here goes to a broker, and no real money moves.
        </p>
        <ol style={{ ...secondary, listStyle: 'none', display: 'grid', gap: 12, fontSize: FS.sm }}>
          {[
            [
              'Signal.',
              `${both ? "John's London v1 first" : "Only John's London v1"}, on GBP/USD and gold. It looks at finished 15-minute candles from 3:00 AM to 11:00 AM (7:00 AM to 3:00 PM London; an hour earlier in UK summer). After a move of ${JOHNS_LONDON.k} ATRs within ${V1.impulseBars} candles, a pullback to the ${V1.zone} level that does not break 1 is a signal, in the direction of the move.${both ? ' Then the London breakout, on GBP/USD, EUR/GBP and gold: the first 15-minute close outside the Asian range (8:00 PM to 2:00 AM) between 2:00 and 6:00 AM, stop at the middle of the range or 1 ATR away, whichever is closer, target 2 times the stop. When both signal one market, v1 goes first.' : ''}`,
            ],
            [
              'Entry.',
              `At the live price at the next race check, at most 4 candles after the signal. No entry if the price already went past 1 or reached 0, ran away from the signal close, or the plan is under ${V1.rrMin} times the risk. No entry 30 minutes either side of red news, and at most ${V1.maxPerDay} trades per market a day. New trades only from 2:00 AM to 12:30 PM, Monday to Friday.`,
            ],
            [
              'Stop.',
              `${JOHNS_LONDON.b === 0.5 ? 'Half an ATR' : `${JOHNS_LONDON.b} ATR`} past the 1 level, and at least ${V1.costFloorX} times the trading costs away.`,
            ],
            [
              'Target.',
              `Half closes at the 0 level, the rest at ${V1.tp2Level}: a plan of ${V1.rrMin} to ${V1.rrMax} times the risk. There is no closing time: a trade holds, overnight too, until its stop or target, or until you tap Close now. It still closes before red news. On GBP/USD a stop or target counts only when the candle closes past it or the next candle reaches it too (Kraken prints fake wicks).`,
            ],
            [
              'Size.',
              `The funded test is one ${usdShort(startMoney)} play account that takes ${both ? "John's London v1 and London breakout signals" : "only John's London v1 signals"}, and every trade risks ${FUNDED.sizing.riskPct}% of its balance at that moment: about ${usdShort(risk)} if the stop hits. A far stop means a smaller position. Forex is shown in lots (1 lot = 100,000 units), gold in lots of 100 oz, crypto in coins.`,
            ],
            [
              'Limits.',
              `At most ${FUNDED.sizing.maxOpen} trades open and ${FUNDED.maxNewPerDay} new a day, one per market. Like FTMO's challenge: a day that loses ${usdShort((startMoney * FUNDED.dailyLossPct) / 100)} (${FUNDED.dailyLossPct}% of the start) or money under ${usdShort(startMoney * (1 - FUNDED.maxLossPct / 100))} fails it, +${FUNDED.targetPct}% after at least ${FUNDED.minDays} trading days passes it, and no new trades once the day is down ${usdShort((startMoney * FUNDED.dayStopPct) / 100)}. A new trade also waits if the day's worst case, every open trade and it hitting their stops, would pass ${usdShort((startMoney * FUNDED.worstCasePct) / 100)}. A trade can only use the free balance times its leverage (crypto 1:1, gold 20:1, forex 30:1). A signal that does not fit is left out.`,
            ],
            [
              'Fees.',
              'Paid going in and coming out: 0.1% a side on crypto, about 0.007% on forex, 0.02% on gold. The result at the top counts every fee except the exit fee of trades still open; open P&L is before fees; closed trades are after fees.',
            ],
          ].map(([title, text], i) => (
            <li key={title} style={{ display: 'flex', gap: 12 }}>
              <span
                aria-hidden
                style={{
                  flex: 'none',
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--bg-hover)',
                  color: 'var(--text-primary)',
                  fontSize: FS.xs,
                  fontWeight: 600,
                }}
              >
                {i + 1}
              </span>
              <span>
                <b style={b}>{title}</b> {text}
              </span>
            </li>
          ))}
        </ol>
        {ex && (
          <p
            style={{
              ...secondary,
              marginTop: 16,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-hover)',
              fontSize: FS.sm,
            }}
          >
            <b style={b}>Example from today.</b> {ex}
          </p>
        )}
        <p style={{ ...secondary, fontSize: FS.sm, margin: '14px 0 16px' }}>
          <b style={b}>Not built yet:</b>{' '}
          {
            'trailing stops, moving the stop to break-even, and taking part of the profit early. A trade ends at its stop, its target, the close before red news, or Close now. USD/JPY and NZD/USD prices come once a day from the European Central Bank (GBP/JPY uses that rate too), so no account opens new trades on them; the other pairs and gold use real prices, checked every hour (every 15 minutes in the session).'
          }
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            ...button,
            width: '100%',
            background: 'var(--text-primary)',
            color: 'var(--bg-primary)',
            border: 0,
            fontSize: FS.md,
          }}
        >
          Got it
        </button>
      </div>
    </dialog>
  )
}
