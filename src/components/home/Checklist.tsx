import { Check, Minus } from 'lucide-react'
import { CHECKLIST_NOTE, NOT_CHECKED, type TradeChecks } from '@/lib/race/checklist'

/**
 * A race trade's confidence checklist at entry (src/lib/race/checklist.ts):
 * a neutral tick when a lead holds, a dash when it does not or could not be
 * checked. Info only, nothing to tap.
 */
export function Checklist(props: { checks?: TradeChecks; fontSize: number; note?: boolean }) {
  const { checks, fontSize } = props
  const muted = { color: 'var(--text-secondary)' }
  if (!checks) return <p style={{ ...muted, fontSize }}>{NOT_CHECKED}</p>
  const icon = { flex: 'none', marginTop: (fontSize * 1.4 - 14) / 2 } as const
  return (
    <div style={{ fontSize, lineHeight: 1.4 }}>
      <ul
        aria-label="Checklist at entry"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}
      >
        {[checks.news, checks.calm, checks.round].map((c) => (
          <li
            key={c.text}
            style={{
              display: 'flex',
              gap: 6,
              color: c.ok ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {c.ok ? (
              <Check size={14} aria-hidden color="var(--text-secondary)" style={icon} />
            ) : (
              <Minus size={14} aria-hidden color="var(--text-secondary)" style={icon} />
            )}
            <span style={{ minWidth: 0 }}>{c.text}</span>
          </li>
        ))}
      </ul>
      {props.note !== false && (
        <p style={{ ...muted, marginTop: 4, fontSize: 12 }}>{CHECKLIST_NOTE}</p>
      )}
    </div>
  )
}
