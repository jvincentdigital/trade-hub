'use client'
import useSWR from 'swr'
import { useState } from 'react'
import { Check, Circle, AlertTriangle } from 'lucide-react'
import type { ScannerResponse, ScannerSetup } from '@/app/api/scanner/route'
import type { Timeframe } from '@/lib/coingecko'
import { useWatchlist } from '@/lib/hooks/useWatchlist'

// Pure helpers live in lib/ so the server route can import them without
// reaching into a client module. Re-exported here to keep the spec's
// discoverability intent ("SetupScanner exports the math").
export { ema, rsi, detectMWFormation, scoreSetup } from '@/lib/scanner/mmConfluence'

const TIMEFRAMES: Timeframe[] = ['30min', '4H', '1D']

const fetcher = (url: string): Promise<ScannerResponse> => fetch(url).then((r) => r.json())

const CHECKLIST_LABELS: Record<keyof ScannerSetup['checklist'], string> = {
  mtfAlignment: 'MTF alignment vs EMA 200',
  mWFormation: 'M/W w/ stop hunt',
  ema50Confluence: 'EMA 50 confluence',
  srConfluence: 'S/R confluence',
  rsiExtreme: 'RSI extreme',
  rsiDivergence: 'RSI divergence',
  patternWithVolume: 'Reversal pattern + volume',
}

export default function SetupScanner() {
  const { watchlist } = useWatchlist()
  const [tf, setTf] = useState<Timeframe>('4H')

  const canFetch = watchlist.length > 0
  const url = canFetch ? `/api/scanner?tf=${tf}&symbols=${watchlist.join(',')}` : null
  const { data, error, isLoading } = useSWR<ScannerResponse>(url, fetcher, {
    refreshInterval: 60000,
  })

  const setups = data?.results ?? []
  const setupA = setups.filter((s) => s.grade === 'A')
  const setupB = setups.filter((s) => s.grade === 'B')
  const visible = [...setupA, ...setupB]

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Live Setup Scanner</h2>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            MM Confluence v2 ·{' '}
            {visible.length > 0 ? `${visible.length} setups` : 'crypto only (v1)'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              style={{
                padding: '5px 10px',
                minHeight: '44px',
                minWidth: '44px',
                borderRadius: '6px',
                fontSize: '11px',
                cursor: 'pointer',
                background: tf === t ? 'var(--indigo-dim)' : 'var(--bg-secondary)',
                border: `0.5px solid ${tf === t ? 'var(--indigo)' : 'var(--border)'}`,
                color: tf === t ? 'var(--indigo)' : 'var(--text-secondary)',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {watchlist.length === 0 ? (
        <EmptyState text="Add assets to your watchlist to see live setups." />
      ) : isLoading && !data ? (
        <EmptyState
          text={`Scanning ${watchlist.length} symbol${watchlist.length === 1 ? '' : 's'}…`}
        />
      ) : error ? (
        <EmptyState text="Scanner failed to load. Will retry." />
      ) : visible.length === 0 ? (
        <EmptyState text="No A or B setups right now. Scanner keeps watching." />
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {visible.map((s) => (
            <SetupCard key={s.id} setup={s} />
          ))}
        </div>
      )}

      {data && data.skipped.length > 0 && (
        <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '10px' }}>
          Skipped {data.skipped.length}:{' '}
          {data.skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}
        </p>
      )}
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '0.5px dashed var(--border)',
        borderRadius: '10px',
        padding: '24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '12px',
      }}
    >
      {text}
    </div>
  )
}

function SetupCard({ setup }: { setup: ScannerSetup }) {
  const isA = setup.grade === 'A'
  const borderColor = isA ? 'var(--green)' : 'var(--amber)'
  const dirColor = setup.direction === 'long' ? 'var(--green)' : 'var(--red)'

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
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{setup.symbol}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{setup.name}</span>
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '4px',
                color: dirColor,
                background: 'var(--bg-secondary)',
                border: `0.5px solid ${dirColor}`,
                fontWeight: 500,
              }}
            >
              {setup.direction.toUpperCase()}
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '4px',
                color: borderColor,
                background: 'var(--bg-secondary)',
                border: `0.5px solid ${borderColor}`,
                fontWeight: 600,
              }}
            >
              {setup.grade} · {setup.score}/7
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '14px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              flexWrap: 'wrap',
            }}
          >
            <span>
              Price{' '}
              <strong style={{ color: 'var(--text-primary)' }}>${formatPrice(setup.price)}</strong>
            </span>
            <span>
              RSI{' '}
              <strong
                style={{
                  color:
                    setup.rsi < 35
                      ? 'var(--green)'
                      : setup.rsi > 65
                        ? 'var(--red)'
                        : 'var(--text-primary)',
                }}
              >
                {setup.rsi.toFixed(1)}
              </strong>
            </span>
            <span>
              Session{' '}
              <strong
                style={{
                  color: setup.sessionValid ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {setup.sessionLabel}
              </strong>
            </span>
            {setup.pattern && (
              <span>
                Pattern{' '}
                <strong
                  style={{
                    color:
                      setup.pattern.type === 'bullish'
                        ? 'var(--green)'
                        : setup.pattern.type === 'bearish'
                          ? 'var(--red)'
                          : 'var(--text-primary)',
                  }}
                >
                  {setup.pattern.name}
                </strong>
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '4px 12px',
          marginTop: '12px',
        }}
      >
        {(Object.keys(CHECKLIST_LABELS) as (keyof ScannerSetup['checklist'])[]).map((k) => {
          const passed = setup.checklist[k]
          return (
            <div
              key={k}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                color: passed ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {passed ? (
                <Check size={11} color="var(--green)" />
              ) : (
                <Circle size={11} color="var(--text-muted)" />
              )}
              <span>{CHECKLIST_LABELS[k]}</span>
            </div>
          )
        })}
      </div>

      {setup.invalidation && (
        <div
          style={{
            marginTop: '10px',
            padding: '6px 10px',
            borderRadius: '6px',
            background: 'var(--bg-secondary)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AlertTriangle size={12} />
          <span>{setup.invalidation}</span>
        </div>
      )}
    </div>
  )
}

function formatPrice(n: number): string {
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 0.01) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}
