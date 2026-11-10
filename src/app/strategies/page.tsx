'use client'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, Edit2, Trash2, X, Bell } from 'lucide-react'
import SetupScanner from './_components/SetupScanner'
import StrategyRules from './_components/StrategyRules'
import { useTradePlans } from '@/lib/hooks/useTradePlans'
import type { TradePlan, TradePlanTimeframe } from '@/lib/schemas'
import { PATTERN_NAMES, type PatternName, detectAll } from '@/lib/patterns/detector'
import { fetchCryptoOHLC, fetchForexOHLC, type CryptoDays, type ForexDays } from '@/lib/data'

const CRYPTO_TFS: TradePlanTimeframe[] = ['1D', '7D', '30D', '90D']
const FOREX_TFS: TradePlanTimeframe[] = ['30D', '90D', '180D', '1Y']

const TF_DAYS: Record<TradePlanTimeframe, number> = {
  '1D': 1,
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '180D': 180,
  '1Y': 365,
}

const STATUS_COLORS: Record<TradePlan['status'], { bg: string; fg: string }> = {
  triggered: { bg: 'var(--amber)', fg: 'var(--amber)' },
  active: { bg: 'var(--green)', fg: 'var(--green)' },
  closed: { bg: 'var(--text-muted)', fg: 'var(--text-muted)' },
}

function emptyPlan(market: 'crypto' | 'forex' = 'crypto', pair = ''): TradePlan {
  return {
    id: '',
    name: '',
    pair,
    market,
    pattern: 'Any',
    timeframe: market === 'crypto' ? '30D' : '90D',
    direction: 'long',
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    notes: '',
    status: 'active',
    createdAt: Date.now(),
  }
}

export default function StrategiesPage() {
  return (
    <div>
      <StrategyRules />
      <SetupScanner />
      <Suspense fallback={null}>
        <TradePlansSection />
      </Suspense>
    </div>
  )
}

function TradePlansSection() {
  const searchParams = useSearchParams()
  const { plans, add, update, remove, reload } = useTradePlans()
  const [editing, setEditing] = useState<TradePlan | null>(null)
  const lastCheckedRef = useRef<number>(0)

  // Pre-fill modal when redirected from a detail page with ?new=1&market=X&pair=Y.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const market = (searchParams.get('market') as 'crypto' | 'forex') || 'crypto'
    const pair = searchParams.get('pair') || ''
    setEditing(emptyPlan(market, pair))
  }, [searchParams])

  // Check active plans against live pattern detection. Runs on mount and every 2 min.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const now = Date.now()
      if (now - lastCheckedRef.current < 60_000) return
      lastCheckedRef.current = now
      const active = plans.filter((p) => p.status === 'active')
      for (const p of active) {
        try {
          const days = TF_DAYS[p.timeframe]
          const candles =
            p.market === 'crypto'
              ? await fetchCryptoOHLC(p.pair, days as CryptoDays)
              : await fetchForexOHLC(p.pair, days as ForexDays)
          if (cancelled) return
          const hits = detectAll(candles)
          const recent = hits.slice(-3)
          const matched =
            p.pattern === 'Any' ? recent.length > 0 : recent.some((h) => h.name === p.pattern)
          if (matched) {
            update(p.id, { status: 'triggered', triggeredAt: Date.now() })
          }
        } catch {
          // upstream failed or timeframe unsupported for market; skip quietly
        }
      }
    }
    check()
    const id = setInterval(check, 120_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans.length])

  const grouped = useMemo(
    () => ({
      triggered: plans.filter((p) => p.status === 'triggered'),
      active: plans.filter((p) => p.status === 'active'),
      closed: plans.filter((p) => p.status === 'closed'),
    }),
    [plans],
  )

  const save = (p: TradePlan) => {
    if (p.id) update(p.id, p)
    else add({ ...p, id: crypto.randomUUID() })
    setEditing(null)
  }

  return (
    <section>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Trade plans</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Trade plans with pattern-based auto-triggers · {plans.length} total
          </p>
        </div>
        <button
          onClick={() => setEditing(emptyPlan())}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'var(--indigo)',
            border: 'none',
            borderRadius: '7px',
            padding: '7px 12px',
            cursor: 'pointer',
            color: 'white',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          <Plus size={13} /> New strategy
        </button>
      </div>

      {plans.length === 0 && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
            borderRadius: '10px',
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '13px',
          }}
        >
          No trade plans yet. Click &ldquo;New strategy&rdquo; or open a market detail page to seed
          one.
        </div>
      )}

      {(['triggered', 'active', 'closed'] as const).map((status) =>
        grouped[status].length > 0 ? (
          <div key={status} style={{ marginTop: '1.5rem' }}>
            <h2
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '8px',
              }}
            >
              {status === 'triggered' && (
                <Bell
                  size={10}
                  style={{ display: 'inline', marginRight: '4px', verticalAlign: 'baseline' }}
                />
              )}
              {status} ({grouped[status].length})
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '10px',
              }}
            >
              {grouped[status].map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  onEdit={() => setEditing(p)}
                  onClose={() => update(p.id, { status: 'closed' })}
                  onDelete={() => {
                    if (window.confirm(`Delete "${p.name || p.pair}"? This can't be undone.`)) {
                      remove(p.id)
                    }
                  }}
                />
              ))}
            </div>
          </div>
        ) : null,
      )}

      {editing && (
        <PlanModal
          plan={editing}
          onSave={(p) => {
            save(p)
            reload()
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function PlanCard({
  plan,
  onEdit,
  onClose,
  onDelete,
}: {
  plan: TradePlan
  onEdit: () => void
  onClose: () => void
  onDelete: () => void
}) {
  const rr =
    plan.direction === 'long'
      ? (plan.takeProfit - plan.entry) / (plan.entry - plan.stopLoss)
      : (plan.entry - plan.takeProfit) / (plan.stopLoss - plan.entry)

  const statusColor = STATUS_COLORS[plan.status]
  const dirColor = plan.direction === 'long' ? 'var(--green)' : 'var(--red)'
  const borderColor = plan.status === 'triggered' ? 'var(--amber)' : 'var(--border)'

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${borderColor}`,
        borderRadius: '10px',
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '8px',
          gap: '8px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              {plan.name || `${plan.pair} ${plan.direction}`}
            </span>
            <span
              style={{
                fontSize: '9px',
                padding: '1px 6px',
                borderRadius: '4px',
                color: statusColor.fg,
                background: 'var(--bg-secondary)',
                border: `0.5px solid ${statusColor.bg}`,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
              }}
            >
              {plan.status}
            </span>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {plan.market.toUpperCase()} · {plan.pair} · {plan.timeframe} · {plan.pattern}
          </p>
        </div>
        <span
          style={{
            fontSize: '10px',
            padding: '1px 6px',
            borderRadius: '4px',
            color: dirColor,
            background: 'var(--bg-secondary)',
            border: `0.5px solid ${dirColor}`,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {plan.direction.toUpperCase()}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          fontSize: '12px',
          marginTop: '8px',
        }}
      >
        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Entry</div>
          <div style={{ fontWeight: 500 }}>{plan.entry || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Stop</div>
          <div style={{ fontWeight: 500, color: 'var(--red)' }}>{plan.stopLoss || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Target</div>
          <div style={{ fontWeight: 500, color: 'var(--green)' }}>{plan.takeProfit || '—'}</div>
        </div>
      </div>

      {Number.isFinite(rr) && !Number.isNaN(rr) && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>
          R:R = {rr.toFixed(2)}
        </div>
      )}

      {plan.notes && (
        <p
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '0.5px solid var(--border)',
          }}
        >
          {plan.notes}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          gap: '10px',
          marginTop: '10px',
          paddingTop: '10px',
          borderTop: '0.5px solid var(--border)',
          fontSize: '11px',
        }}
      >
        <button
          onClick={onEdit}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Edit2 size={11} /> Edit
        </button>
        {plan.status !== 'closed' && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            Close
          </button>
        )}
        <button
          onClick={onDelete}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--red)',
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  )
}

function PlanModal({
  plan,
  onSave,
  onCancel,
}: {
  plan: TradePlan
  onSave: (p: TradePlan) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<TradePlan>(plan)
  const tfs = form.market === 'crypto' ? CRYPTO_TFS : FOREX_TFS
  const set = <K extends keyof TradePlan>(k: K, v: TradePlan[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  // Ensure timeframe is valid for the selected market.
  useEffect(() => {
    if (!tfs.includes(form.timeframe)) set('timeframe', tfs[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.market])

  const canSave = form.pair.trim().length > 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: '10px',
          padding: '1.25rem',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600 }}>
            {plan.id ? 'Edit strategy' : 'New strategy'}
          </h2>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>

        <Field label="Name">
          <TextInput
            value={form.name}
            onChange={(v) => set('name', v)}
            placeholder="BTC breakout long"
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
          <Field label="Market">
            <Select
              value={form.market}
              onChange={(v) => set('market', v as 'crypto' | 'forex')}
              options={['crypto', 'forex']}
            />
          </Field>
          <Field label="Pair">
            <TextInput
              value={form.pair}
              onChange={(v) => set('pair', v)}
              placeholder={form.market === 'crypto' ? 'bitcoin' : 'EUR/USD'}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Field label="Pattern watch">
            <Select
              value={form.pattern}
              onChange={(v) => set('pattern', v as PatternName)}
              options={[...PATTERN_NAMES]}
            />
          </Field>
          <Field label="Timeframe">
            <Select
              value={form.timeframe}
              onChange={(v) => set('timeframe', v as TradePlanTimeframe)}
              options={[...tfs]}
            />
          </Field>
        </div>

        <Field label="Direction">
          <Select
            value={form.direction}
            onChange={(v) => set('direction', v as 'long' | 'short')}
            options={['long', 'short']}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <Field label="Entry">
            <TextInput
              type="number"
              value={form.entry}
              onChange={(v) => set('entry', parseFloat(v) || 0)}
            />
          </Field>
          <Field label="Stop loss">
            <TextInput
              type="number"
              value={form.stopLoss}
              onChange={(v) => set('stopLoss', parseFloat(v) || 0)}
            />
          </Field>
          <Field label="Take profit">
            <TextInput
              type="number"
              value={form.takeProfit}
              onChange={(v) => set('takeProfit', parseFloat(v) || 0)}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            style={{
              width: '100%',
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border)',
              borderRadius: '7px',
              padding: '8px 10px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </Field>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: '0.5px solid var(--border)',
              borderRadius: '7px',
              padding: '7px 14px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: '12px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!canSave}
            style={{
              background: canSave ? 'var(--indigo)' : 'var(--bg-secondary)',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              cursor: canSave ? 'pointer' : 'not-allowed',
              color: canSave ? 'white' : 'var(--text-muted)',
              fontSize: '12px',
              fontWeight: 500,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <label
        style={{
          fontSize: '10px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          display: 'block',
          marginBottom: '4px',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border)',
  borderRadius: '7px',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: '12px',
  outline: 'none',
  fontFamily: 'inherit',
}

function TextInput({
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  value: string | number
  onChange: (v: string) => void
  type?: 'text' | 'number'
  placeholder?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}
