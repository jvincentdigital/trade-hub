'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { CandleChart } from './CandleChart'
import { useRules } from '@/lib/hooks/useRules'
import { backtest } from '@/lib/rules/engine'
import { loadRuleCandles } from '@/lib/rules/data'
import { FEE_RATE, LEVERAGE } from '@/lib/paper/engine'
import { getInstrument } from '@/lib/paper/instruments'
import type { PatternHit } from '@/lib/types/market'

/** Strategy-rule signals drawn on that rule's candles, under a detail page chart. */
export function RuleSignals({ instrumentId }: { instrumentId: string }) {
  const params = useSearchParams()
  const { rules } = useRules()
  const inst = getInstrument(instrumentId)
  const usable = rules.filter((r) => inst && (r.market === 'both' || r.market === inst.market))
  const [ruleId, setRuleId] = useState(() => params.get('rule') ?? '')
  const rule = usable.find((r) => r.id === ruleId)

  const { data, error, isLoading } = useSWR(
    rule ? ['rule-candles', rule.id, rule.timeframe, instrumentId] : null,
    () => loadRuleCandles(rule!, instrumentId),
  )
  const result =
    rule && data && inst
      ? backtest({ ...rule, timeframe: data.tf }, data.candles, {
          feeRate: FEE_RATE[inst.market],
          leverage: LEVERAGE[inst.market],
        })
      : null
  // Only the trades the backtest took (not every signal), unlabeled so they
  // stay readable on a phone: arrow = entry, dot = exit.
  const markers: PatternHit[] =
    result?.trades
      .flatMap((t): PatternHit[] => [
        {
          name: '',
          type: t.direction === 'long' ? 'bullish' : 'bearish',
          confidence: 100,
          index: 0,
          time: t.entryTime,
        },
        { name: '', type: 'neutral', confidence: 100, index: 0, time: t.exitTime },
      ])
      .sort((a, b) => a.time - b.time) ?? []

  if (!inst) return null
  return (
    <section
      style={{
        marginTop: 20,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: 13, fontWeight: 600 }}>Strategy signals</h2>
        <select
          aria-label="Strategy rule"
          value={ruleId}
          onChange={(e) => setRuleId(e.target.value)}
          style={{
            minHeight: 44,
            borderRadius: 7,
            border: '0.5px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            padding: '0 8px',
            fontSize: 12,
          }}
        >
          <option value="">Pick a rule…</option>
          {usable.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {!rule && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Pick a rule to mark every candle where it would have entered. Edit rules on{' '}
          <Link href="/strategies" style={{ color: 'var(--indigo)' }}>
            Strategies
          </Link>
          .
        </p>
      )}
      {rule && isLoading && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Loading {rule.timeframe} candles…
        </p>
      )}
      {rule && error && (
        <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>
          Could not load candles. Try again in a minute.
        </p>
      )}
      {rule && data && result && (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>
            {result.signals.length} signals on {data.candles.length} {data.tf} candles · backtest{' '}
            {result.trades.length} trades, win rate{' '}
            {result.stats.winRate === null ? '-' : `${Math.round(result.stats.winRate * 100)}%`},{' '}
            {result.totalR >= 0 ? '+' : ''}
            {result.totalR.toFixed(1)}R after fees. Arrows: entries (green buy, red sell); amber
            dots: exits.
          </p>
          <CandleChart candles={data.candles} patterns={markers} height={320} />
          {data.note && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{data.note}</p>
          )}
        </>
      )}
    </section>
  )
}
