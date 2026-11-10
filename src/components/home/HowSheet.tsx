'use client'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { formatQuote, getInstrument } from '@/lib/paper/instruments'
import type { OpenPosition } from '@/lib/positions/positions'
import { shortName, sideWord, signedShort, usdShort } from '@/lib/positions/today'
import { RACE_SIZING } from '@/lib/race/account'
import { BUILT_IN_RULES } from '@/lib/rules/presets'
import { perMoveText, sizeText, sizingOf } from '@/lib/sizing/sizing'
import { FS, button, secondary } from './ui'

const range = (ns: number[], unit = '') => {
  const lo = Math.min(...ns)
  const hi = Math.max(...ns)
  return lo === hi ? `${lo}${unit}` : `${lo}${unit} to ${hi}${unit}`
}

// Facts from the built-in rules, so the text stays true when a rule changes.
const swings = BUILT_IN_RULES.flatMap((r) => (r.stop.kind === 'swing' ? [r.stop] : []))
const byRr = new Map<number, string[]>()
for (const r of BUILT_IN_RULES) byRr.set(r.rr, [...(byRr.get(r.rr) ?? []), r.name])
const [mainRr] = [...byRr.entries()].sort((a, b) => b[1].length - a[1].length)[0]
const otherRr = [...byRr.entries()]
  .filter(([rr]) => rr !== mainRr)
  .map(([rr, names]) => `${names.join(' and ')} ${names.length === 1 ? 'aims' : 'aim'} for ${rr}`)

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
  const risk = (startMoney * RACE_SIZING.riskPct) / 100
  const b = { color: 'var(--text-primary)', fontWeight: 600 }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="how-title"
      // Esc closes the dialog natively; keep the URL in step.
      onClose={() => openRef.current && onClose()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ padding: '8px 20px 20px' }}>
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
              'Each strategy looks only at finished candles (1 hour, 4 hours or 1 day, depending on the strategy). When all its rules line up, that is a signal.',
            ],
            [
              'Entry.',
              'At the open of the next candle: the hourly check buys or sells at the live price, which is about that open.',
            ],
            [
              'Stop.',
              `Just past the recent swing (the lowest low before a buy, the highest high before a sell, over the last ${range(swings.map((s) => s.lookback))} candles) plus a small buffer of ${range(
                swings.map((s) => s.bufferPct),
                '%',
              )}, so normal wiggles don't knock the trade out.`,
            ],
            [
              'Target.',
              `About ${mainRr} times the stop distance${otherRr.length ? `; ${otherRr.join('; ')}` : ''}. The fill comes a little after the signal, so each trade shows its own ratio.`,
            ],
            [
              'Size.',
              `Each strategy trades one ${usdShort(startMoney)} play account, and every trade risks ${RACE_SIZING.riskPct}% of its balance at that moment: about ${usdShort(risk)} if the stop hits. A far stop means a smaller position. Forex is shown in lots (1 lot = 100,000 units), gold in lots of 100 oz, crypto in coins.`,
            ],
            [
              'Limits.',
              `At most ${RACE_SIZING.maxOpen} trades open per strategy, and one per market. All open stops together can lose at most ${RACE_SIZING.maxOpenRiskPct}% of the balance. A trade can only use the free balance times its leverage (crypto 1:1, gold 20:1, forex 30:1). A signal that does not fit is left out.`,
            ],
            [
              'Fees.',
              'Paid going in and coming out: 0.1% a side on crypto, about 0.007% on forex, 0.02% on gold. Open P&L on this page is before fees; closed trades are after fees.',
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
            'trailing stops, moving the stop to break-even, and taking part of the profit early. A trade only ends at its stop or its target. Forex prices come once a day from the European Central Bank, so forex P&L moves once a day.'
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
