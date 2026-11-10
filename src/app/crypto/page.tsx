'use client'
import { useRouter } from 'next/navigation'
import { useCryptoPrices } from '@/lib/hooks/useMarketData'
import { useWatchlist } from '@/lib/hooks/useWatchlist'
import { PairCard } from '@/components/market/PairCard'
import { Sparkline } from '@/components/market/Sparkline'
import { MarketItem } from '@/lib/types/market'
import { RefreshCw } from 'lucide-react'

export default function CryptoPage() {
  const router = useRouter()
  const { prices, isLoading, error, refresh } = useCryptoPrices()
  const { toggle, isWatched } = useWatchlist()

  const items: MarketItem[] = prices.map((p) => ({
    ...p,
    patterns: [],
    type: 'crypto',
  }))

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Crypto</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Live prices · auto-refresh 60s · click a card for detail
          </p>
        </div>
        <button
          onClick={() => refresh()}
          style={{
            background: 'none',
            border: '0.5px solid var(--border)',
            borderRadius: '7px',
            padding: '6px 10px',
            minHeight: '44px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
          }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
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
          Couldn&apos;t reach the CoinGecko proxy. Retrying automatically — click Refresh to try
          now.
        </div>
      )}

      {isLoading && prices.length === 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '10px',
          }}
        >
          {Array.from({ length: 10 }).map((_, i) => (
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
              onSelect={() => router.push(`/crypto/${item.id}`)}
              onWatch={() => toggle(item.id)}
              sparkline={<Sparkline id={item.id} market="crypto" />}
            />
          ))}
        </div>
      )}
    </div>
  )
}
