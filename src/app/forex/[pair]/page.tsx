'use client'
import { Suspense, use, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { ArrowLeft, Plus } from 'lucide-react'
import { CandleChart } from '@/components/market/CandleChart'
import { TradingViewChart } from '@/components/market/TradingViewChart'
import { RuleSignals } from '@/components/market/RuleSignals'
import { fetchForexIntraday, fetchForexOHLC, type ForexDays, type ForexIntraday } from '@/lib/data'
import { detectAll } from '@/lib/patterns/detector'

type Timeframe =
  | { label: string; kind: 'intraday'; interval: ForexIntraday }
  | { label: string; kind: 'daily'; days: ForexDays }

const TIMEFRAMES: Timeframe[] = [
  { label: '15m', kind: 'intraday', interval: '15min' },
  { label: '30m', kind: 'intraday', interval: '30min' },
  { label: '1h', kind: 'intraday', interval: '1h' },
  { label: '7D', kind: 'daily', days: 7 },
  { label: '14D', kind: 'daily', days: 14 },
  { label: '30D', kind: 'daily', days: 30 },
  { label: '90D', kind: 'daily', days: 90 },
  { label: '180D', kind: 'daily', days: 180 },
  { label: '1Y', kind: 'daily', days: 365 },
]

export default function ForexDetailPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = use(params)
  const display = pair.replace('-', '/')
  const [tf, setTf] = useState<Timeframe>(() => TIMEFRAMES[5]) // default 30D
  const [tvPick, setTv] = useState(false)

  const {
    data: candles,
    isLoading,
    error,
  } = useSWR(
    `forex-${tf.kind}-${pair}-${tf.kind === 'intraday' ? tf.interval : tf.days}`,
    () =>
      tf.kind === 'intraday'
        ? fetchForexIntraday(display, tf.interval)
        : fetchForexOHLC(display, tf.days),
    {
      refreshInterval: tf.kind === 'intraday' ? 60_000 : 300_000,
      revalidateOnFocus: false,
    },
  )

  const patterns = useMemo(() => (candles ? detectAll(candles) : []), [candles])
  // No intraday forex feed without a key: TradingView covers it, free.
  const tv =
    tvPick || (tf.kind === 'intraday' && String(error?.message ?? '').includes('not configured'))
  const last = candles?.[candles.length - 1]
  const first = candles?.[0]
  const change =
    last && first && first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : 0

  return (
    <div>
      <Link
        href="/forex"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          color: 'var(--text-muted)',
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={12} /> Back to forex
      </Link>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginTop: '12px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>{display}</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Forex · daily ECB close</p>
          {last && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '6px' }}>
              <span style={{ fontSize: '26px', fontWeight: 700 }}>{last.close.toFixed(5)}</span>
              <span
                style={{
                  fontSize: '13px',
                  color: change >= 0 ? 'var(--green)' : 'var(--red)',
                  fontWeight: 500,
                }}
              >
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}% · {tf.label}
              </span>
            </div>
          )}
        </div>
        <Link
          href={`/strategies?new=1&market=forex&pair=${display}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: 'var(--indigo)',
            border: 'none',
            borderRadius: '7px',
            padding: '7px 12px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          <Plus size={13} /> New strategy
        </Link>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {TIMEFRAMES.map((t) => {
          const active = t.label === tf.label && !tvPick
          return (
            <button
              key={t.label}
              onClick={() => {
                setTf(t)
                setTv(false)
              }}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                cursor: 'pointer',
                background: active ? 'var(--indigo-dim)' : 'var(--bg-secondary)',
                border: `0.5px solid ${active ? 'var(--indigo)' : 'var(--border)'}`,
                color: active ? 'var(--indigo)' : 'var(--text-secondary)',
              }}
            >
              {t.label}
            </button>
          )
        })}
        <button
          onClick={() => setTv((v) => !v)}
          aria-pressed={tv}
          style={{
            padding: '5px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            cursor: 'pointer',
            background: tv ? 'var(--indigo-dim)' : 'var(--bg-secondary)',
            border: `0.5px solid ${tv ? 'var(--indigo)' : 'var(--border)'}`,
            color: tv ? 'var(--indigo)' : 'var(--text-secondary)',
          }}
        >
          TradingView
        </button>
      </div>

      {error && !tv && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--red)',
            borderRadius: '7px',
            padding: '10px 12px',
            marginBottom: '12px',
            color: 'var(--red)',
            fontSize: '12px',
          }}
        >
          {tf.kind === 'intraday' && String(error.message).includes('not configured') ? (
            <>
              Forex intraday needs a Twelve Data API key.{' '}
              <a
                href="https://twelvedata.com/register"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--red)', textDecoration: 'underline' }}
              >
                Get one free
              </a>
              , then add <code>TWELVE_DATA_API_KEY</code> to the Vercel environment.
            </>
          ) : (
            <>Couldn&apos;t load OHLC. Retrying automatically.</>
          )}
        </div>
      )}

      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: '10px',
          padding: '16px',
          marginBottom: '16px',
        }}
      >
        {tv ? (
          <TradingViewChart symbol={`FX:${pair.replace('-', '')}`} />
        ) : isLoading || !candles ? (
          <div
            style={{
              height: '400px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
            }}
          >
            Loading candles…
          </div>
        ) : candles.length === 0 ? (
          <div
            style={{
              height: '400px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
            }}
          >
            No data available for this range.
          </div>
        ) : (
          <CandleChart candles={candles} patterns={patterns} />
        )}
      </div>

      <div
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: '10px',
          padding: '16px',
        }}
      >
        <h2
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '6px',
          }}
        >
          Detected patterns ({patterns.length})
        </h2>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          {tv
            ? 'Patterns come from our own chart. Pick a day range (7D to 1Y) to see them; the TradingView chart has its own pattern tools.'
            : tf.kind === 'intraday'
              ? 'Intraday OHLC via Twelve Data (real bid/ask).'
              : 'Daily ECB close via Frankfurter. Intraday wicks on daily candles are synthesized (±0.1%), so single-wick patterns are approximate.'}
        </p>
        {tv ? null : patterns.length === 0 ? (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            No patterns detected in this range.
          </p>
        ) : (
          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
            {patterns
              .slice()
              .reverse()
              .map((p, i) => (
                <div
                  key={`${p.time}-${p.name}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 0',
                    fontSize: '12px',
                    borderBottom: i < patterns.length - 1 ? '0.5px solid var(--border)' : 'none',
                  }}
                >
                  <span
                    style={{
                      color:
                        p.type === 'bullish'
                          ? 'var(--green)'
                          : p.type === 'bearish'
                            ? 'var(--red)'
                            : 'var(--amber)',
                      fontWeight: 500,
                    }}
                  >
                    {p.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {p.confidence}% · {new Date(p.time * 1000).toLocaleDateString()}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
      <Suspense fallback={null}>
        <RuleSignals instrumentId={pair} />
      </Suspense>
      <Link
        href={`/demo?symbol=${pair}`}
        style={{
          display: 'inline-block',
          marginTop: '12px',
          fontSize: '12px',
          color: 'var(--indigo)',
        }}
      >
        Practice this market in the demo account →
      </Link>
    </div>
  )
}
