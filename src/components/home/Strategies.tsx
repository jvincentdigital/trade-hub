import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LiveSummary } from '@/lib/race/live'
import type { Rule } from '@/lib/rules/schema'
import { TF_WORD } from '@/lib/positions/today'
import { usd } from './format'
import { FS, card, num, secondary } from './ui'

/** Desktop side card: each strategy with open trades, its account now and slots used. */
export function Strategies(props: {
  rows: LiveSummary[]
  rules: Map<string, Rule>
  startMoney: number
  maxOpen: number
}) {
  const { rules, startMoney, maxOpen } = props
  const busy = props.rows.filter((r) => r.open.length > 0)
  const waiting = props.rows.length - busy.length
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
        const diff = r.money - startMoney
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
                color:
                  Math.abs(diff) < 0.005
                    ? 'var(--text-primary)'
                    : diff > 0
                      ? 'var(--green)'
                      : 'var(--red)',
              }}
            >
              {usd(r.money)}
            </span>
            <span style={{ ...secondary, fontSize: FS.xs }}>
              {r.open.length} of {maxOpen} open
              {rule ? `, ${TF_WORD[rule.timeframe]} candles` : ''}
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
                    background: k < r.open.length ? 'var(--indigo)' : 'var(--border)',
                  }}
                />
              ))}
            </span>
          </div>
        )
      })}
      <p style={{ ...secondary, fontSize: FS.xs, marginTop: 6 }}>
        Account money now, from {usd(startMoney)} each.
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
