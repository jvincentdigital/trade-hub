'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { useForexRates, useMetalPrices } from '@/lib/hooks/useMarketData'
import { formatPrice } from '@/lib/utils/formatters'
import { useWatchlist } from '@/lib/hooks/useWatchlist'
import { PairCard } from '@/components/market/PairCard'
import { Sparkline } from '@/components/market/Sparkline'
import { MarketItem } from '@/lib/types/market'

export default function ForexPage() {
  const router = useRouter()
  const { rates, isLoading, error } = useForexRates()
  const { toggle, isWatched } = useWatchlist()
  const { metals } = useMetalPrices()

  const items: MarketItem[] = rates.map((r) => ({ ...r, patterns: [], type: 'forex' }))

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Forex</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
          Live rates · auto-refresh 1h · click a card for detail
        </p>
      </div>

      {error && (
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
          Couldn&apos;t reach the ExchangeRate API proxy. Retrying automatically.
        </div>
      )}

      {isLoading && rates.length === 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '10px',
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: '10px',
                height: '96px',
              }}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '10px',
          }}
        >
          {items.map((item) => (
            <PairCard
              key={item.id}
              item={item}
              watched={isWatched(item.id)}
              onSelect={() => router.push(`/forex/${item.id}`)}
              onWatch={() => toggle(item.id)}
              sparkline={<Sparkline id={item.symbol} market="forex" />}
            />
          ))}
        </div>
      )}
      <h2 style={{ fontSize: '14px', fontWeight: 600, margin: '1.5rem 0 0.6rem' }}>Gold</h2>
      {metals.map((m) => (
        <Link
          key={m.id}
          href="/gold"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            maxWidth: '460px',
            minHeight: '44px',
            padding: '14px 16px',
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: '10px',
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>
              Gold (XAU/USD)
            </span>
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)' }}>
              {m.note} · hourly candles
            </span>
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>
              {m.price > 0 ? formatPrice(m.price) : '-'}
            </span>
            <span
              style={{
                display: 'block',
                fontSize: '11px',
                color: m.change24h >= 0 ? 'var(--green)' : 'var(--red)',
              }}
            >
              {m.change24h >= 0 ? '+' : ''}
              {m.change24h.toFixed(2)}% 24h
            </span>
          </span>
          <ChevronRight size={16} color="var(--text-secondary)" aria-hidden />
        </Link>
      ))}
    </div>
  )
}
