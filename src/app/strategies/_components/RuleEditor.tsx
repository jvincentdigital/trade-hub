import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { describeCondition } from '@/lib/rules/engine'
import {
  RULE_TIMEFRAMES,
  ruleSchema,
  type Condition,
  type ConditionKind,
  type Rule,
} from '@/lib/rules/schema'

const NEW_CONDITION: Record<ConditionKind, Condition> = {
  trend: { kind: 'trend', period: 200 },
  emaStack: { kind: 'emaStack', fast: 20, slow: 50 },
  rsi: { kind: 'rsi', period: 14, longBelow: 35, shortAbove: 65 },
  formation: { kind: 'formation' },
  emaTouch: { kind: 'emaTouch', period: 50, tolerancePct: 0.5 },
  pattern: { kind: 'pattern', names: [], lookback: 2 },
  nearLevel: { kind: 'nearLevel', lookback: 20, tolerancePct: 0.5 },
  streak: { kind: 'streak', length: 3 },
}

const KIND_LABEL: Record<ConditionKind, string> = {
  trend: 'Trend filter (EMA)',
  emaStack: 'EMA cross / stack',
  rsi: 'RSI stretched',
  formation: 'W / M formation',
  emaTouch: 'Pullback to EMA',
  pattern: 'Reversal candle',
  nearLevel: 'At range high / low',
  streak: 'Run of candles against the trade',
}

const SESSION_PRESETS: Record<string, Rule['sessions']> = {
  'Any time': [],
  'Crypto prime (8-12, 20-24 NY)': [
    { label: 'EU/US overlap', start: 8, end: 12 },
    { label: 'Asia open', start: 20, end: 24 },
  ],
  'Forex London + NY opens': [
    { label: 'Pre-London', start: 1, end: 2.5 },
    { label: 'London open', start: 2.5, end: 4 },
    { label: 'NY open', start: 8, end: 10 },
  ],
}

/** Numeric fields per condition kind (everything except `kind` and `names`). */
function numericFields(c: Condition): [string, number][] {
  return Object.entries(c).filter(([k, v]) => k !== 'kind' && typeof v === 'number') as [
    string,
    number,
  ][]
}

export function RuleEditor({
  rule,
  onSave,
  onCancel,
}: {
  rule: Rule
  onSave: (r: Rule) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Rule>(rule)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setCond = (i: number, c: Condition) =>
    set(
      'conditions',
      draft.conditions.map((x, j) => (j === i ? c : x)),
    )
  const sessionKey =
    Object.entries(SESSION_PRESETS).find(
      ([, v]) => JSON.stringify(v) === JSON.stringify(draft.sessions),
    )?.[0] ?? 'Custom'

  const save = () => {
    const parsed = ruleSchema.safeParse(draft)
    if (!parsed.success)
      return setError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    onSave(parsed.data)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit strategy rule"
      style={overlay}
      onClick={onCancel}
    >
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Edit rule</h2>
          <button
            aria-label="Close"
            onClick={onCancel}
            style={{ ...ghost, width: 36, padding: 0, justifyContent: 'center' }}
          >
            <X size={14} />
          </button>
        </div>

        <Field label="Name">
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} style={input} />
        </Field>
        <Field label="What it does (your words)">
          <textarea
            value={draft.summary}
            onChange={(e) => set('summary', e.target.value)}
            rows={2}
            style={{ ...input, resize: 'vertical' }}
          />
        </Field>

        <div style={row3}>
          <Field label="Market">
            <select
              value={draft.market}
              onChange={(e) => set('market', e.target.value as Rule['market'])}
              style={input}
            >
              <option value="crypto">Crypto</option>
              <option value="forex">Forex</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <Field label="Candles">
            <select
              value={draft.timeframe}
              onChange={(e) => set('timeframe', e.target.value as Rule['timeframe'])}
              style={input}
            >
              {RULE_TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Direction">
            <select
              value={draft.direction}
              onChange={(e) => set('direction', e.target.value as Rule['direction'])}
              style={input}
            >
              <option value="both">Buys + sells</option>
              <option value="long">Buys only</option>
              <option value="short">Sells only</option>
            </select>
          </Field>
        </div>

        <h3 style={h3}>Entry conditions (all must be true)</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {draft.conditions.map((c, i) => (
            <div key={i} style={condBox}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{KIND_LABEL[c.kind]}</span>
                <button
                  aria-label="Remove condition"
                  onClick={() =>
                    set(
                      'conditions',
                      draft.conditions.filter((_, j) => j !== i),
                    )
                  }
                  style={{ ...ghost, minHeight: 28, padding: '0 8px' }}
                >
                  <X size={12} />
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 6px' }}>
                {describeCondition(c)}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {numericFields(c).map(([k, v]) => (
                  <label key={k} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {k}
                    <input
                      type="number"
                      step="any"
                      value={v}
                      onChange={(e) =>
                        setCond(i, { ...c, [k]: Number(e.target.value) } as Condition)
                      }
                      style={{ ...input, width: 90, display: 'block', marginTop: 2 }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <select
            aria-label="Add condition"
            value=""
            onChange={(e) =>
              e.target.value &&
              set('conditions', [
                ...draft.conditions,
                NEW_CONDITION[e.target.value as ConditionKind],
              ])
            }
            style={input}
          >
            <option value="">+ Add a condition…</option>
            {(Object.keys(KIND_LABEL) as ConditionKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>

        <h3 style={h3}>Exit and risk</h3>
        <div style={row3}>
          <Field label="Stop type">
            <select
              value={draft.stop.kind}
              onChange={(e) =>
                set(
                  'stop',
                  e.target.value === 'percent'
                    ? { kind: 'percent', pct: 2 }
                    : { kind: 'swing', lookback: 10, bufferPct: 0.3 },
                )
              }
              style={input}
            >
              <option value="swing">Beyond recent swing</option>
              <option value="percent">Fixed %</option>
            </select>
          </Field>
          {draft.stop.kind === 'swing' ? (
            <>
              <Field label="Swing candles">
                <input
                  type="number"
                  value={draft.stop.lookback}
                  onChange={(e) =>
                    set('stop', {
                      kind: 'swing',
                      lookback: Number(e.target.value),
                      bufferPct: (draft.stop as { bufferPct: number }).bufferPct,
                    })
                  }
                  style={input}
                />
              </Field>
              <Field label="Buffer %">
                <input
                  type="number"
                  step="any"
                  value={draft.stop.bufferPct}
                  onChange={(e) =>
                    set('stop', {
                      kind: 'swing',
                      lookback: (draft.stop as { lookback: number }).lookback,
                      bufferPct: Number(e.target.value),
                    })
                  }
                  style={input}
                />
              </Field>
            </>
          ) : (
            <Field label="Stop %">
              <input
                type="number"
                step="any"
                value={draft.stop.pct}
                onChange={(e) => set('stop', { kind: 'percent', pct: Number(e.target.value) })}
                style={input}
              />
            </Field>
          )}
        </div>
        <div style={row3}>
          <Field label="Reward : risk (target)">
            <input
              type="number"
              step="any"
              value={draft.rr}
              onChange={(e) => set('rr', Number(e.target.value))}
              style={input}
            />
          </Field>
          <Field label="Risk per trade %">
            <input
              type="number"
              step="any"
              value={draft.riskPct}
              onChange={(e) => set('riskPct', Number(e.target.value))}
              style={input}
            />
          </Field>
          <Field label="Trading hours">
            <select
              value={sessionKey}
              onChange={(e) =>
                SESSION_PRESETS[e.target.value] && set('sessions', SESSION_PRESETS[e.target.value])
              }
              style={input}
            >
              {Object.keys(SESSION_PRESETS).map((k) => (
                <option key={k}>{k}</option>
              ))}
              {sessionKey === 'Custom' && <option>Custom</option>}
            </select>
          </Field>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={ghost}>
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              ...ghost,
              background: 'var(--indigo)',
              color: 'white',
              border: 'none',
              fontWeight: 500,
            }}
          >
            <Plus size={13} /> Save rule
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, minWidth: 0 }}>
      <span
        style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 100,
}
const panel: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: '14px 14px 0 0',
  padding: '16px 16px calc(16px + env(safe-area-inset-bottom))',
  width: '100%',
  maxWidth: 560,
  maxHeight: '90vh',
  overflowY: 'auto',
}
const input: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 7,
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: 14,
  minHeight: 38,
}
const ghost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minHeight: 38,
  padding: '0 14px',
  borderRadius: 7,
  border: '0.5px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  cursor: 'pointer',
}
const row3: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
}
const h3: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '6px 0 8px',
}
const condBox: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
  padding: '8px 10px',
}
