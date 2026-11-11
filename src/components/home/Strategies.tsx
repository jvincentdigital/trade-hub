import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { RaceState } from '@/lib/race/live'
import type { Rule } from '@/lib/rules/schema'
import type { OpenPosition, PositionMetrics } from '@/lib/positions/positions'
import { TF_WORD } from '@/lib/positions/today'
import { EXTRA_STRATEGIES } from '@/lib/race/extras'
import { usd } from './format'
import { FS, card, num, pnlText, secondary, tone } from './ui'

/**
 * Desktop side card: each strategy with open trades, in the list's order,
 * with its open P&L from the same rows (live prices), its account money
 * (balance + that P&L - entry fees still owed) and slots used.
 */
export function Strategies(props: {
  /** The race's rows grouped by strategy, as the "By strategy" tab shows them. */
  groups: { pos: OpenPosition; m: PositionMetrics }[][]
  state: RaceState
  rules: Map<string, Rule>
  startMoney: number
  maxOpen: number
}) {
  const { rules, startMoney, maxOpen } = props
  const all = Object.values(props.state.strategies)
  const busy = props.groups.flatMap((g) => {
    const s = all.find((x) => x.ruleId === g[0].pos.ruleId)
    if (!s) return []
    const pnl = g.reduce((a, r) => a + (r.m.pnl ?? 0), 0)
    const fees = s.open.reduce((a, t) => a + t.entryFee, 0)
    return [{ ruleId: s.ruleId, name: s.name, n: g.length, pnl, money: s.balance + pnl - fees }]
  })
  const waiting = all.length - busy.length
  return (
    <section
      className="today-strats"
      aria-labelledby="strats-title"
      style={{ ...card, padding: '16px 18px', marginTop: 16 }}
    >
      <h2 id="strats-title" style={{ fontSize: FS.md, fontWeight: 600, marginBottom: 6 }}>
        Strategies with open trades
      </h2>
      {busy.length === 0 && <p style={{ ...secondary, fontSize: FS.sm }}>None right now.</p>}
      {busy.map((r, i) => {
        const rule = rules.get(r.ruleId)
        return (
          <div
            key={r.ruleId}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '2px 12px',
              padding: '10px 0',
              borderTop: i ? '0.5px solid var(--border)' : undefined,
            }}
          >
            <b style={{ fontWeight: 600, fontSize: FS.sm }}>{r.name}</b>
            <span
              style={{
                ...num,
                fontWeight: 600,
                fontSize: FS.sm,
                textAlign: 'right',
                color: tone(r.pnl),
              }}
            >
              {pnlText(r.pnl)}
            </span>
            <span style={{ ...secondary, ...num, fontSize: FS.xs }}>
              {r.n} of {maxOpen} open
              {rule
                ? `, ${TF_WORD[rule.timeframe]} candles`
                : EXTRA_STRATEGIES[r.ruleId]
                  ? `, ${EXTRA_STRATEGIES[r.ruleId].candles} candles`
                  : ''}
              <br />
              {usd(r.money)} in account
            </span>
            <span
              aria-hidden
              style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}
            >
              {Array.from({ length: maxOpen }, (_, k) => (
                <i
                  key={k}
                  style={{
                    width: 10,
                    height: 6,
                    borderRadius: 3,
                    background: k < r.n ? 'var(--indigo)' : 'var(--border)',
                  }}
                />
              ))}
            </span>
          </div>
        )
      })}
      <p style={{ ...secondary, fontSize: FS.xs, marginTop: 6 }}>
        Open P&amp;L at live prices. Account money is after entry fees, from {usd(startMoney)} each.
        {waiting > 0 &&
          ` ${waiting} other strateg${waiting === 1 ? 'y is' : 'ies are'} waiting for a signal.`}
      </p>
      <Link
        href="/race"
        style={{
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
          borderTop: '0.5px solid var(--border)',
          color: 'var(--indigo)',
          fontSize: FS.sm,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Open the race
        <ChevronRight size={16} aria-hidden />
      </Link>
    </section>
  )
}
