'use client'
import { useCryptoPrices, useForexRates } from '@/lib/hooks/useMarketData'
import { useWatchlist } from '@/lib/hooks/useWatchlist'
import { formatPrice, formatChange, changeColor } from '@/lib/utils/formatters'
import { Trash2 } from 'lucide-react'

export default function WatchlistPage() {
  const { prices, error: cryptoError } = useCryptoPrices()
  const { rates, error: forexError } = useForexRates()
  const { watchlist, remove } = useWatchlist()

  const allMarkets = [...prices, ...rates]
  const watched = allMarkets.filter((m) => watchlist.includes(m.id))

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Watchlist</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {watched.length} pair{watched.length !== 1 ? 's' : ''} saved
        </p>
      </div>

      {(cryptoError || forexError) && (
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
          Some market feeds couldn&apos;t load. Prices shown may be stale or missing.
        </div>
      )}

      {watched.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem',
            color: 'var(--text-muted)',
            fontSize: '13px',
          }}
        >
          No pairs in watchlist yet. Star a pair from the Crypto or Forex pages.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: '10px',
            overflow: 'hidden',
          }}
        >
          {watched.map((item, i) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: i < watched.length - 1 ? '0.5px solid var(--border)' : 'none',
              }}
            >
              <div>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{item.symbol}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                  {item.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500 }}>{formatPrice(item.price)}</span>
                <span
                  style={{
                    fontSize: '12px',
                    color: changeColor(item.change24h),
                    fontWeight: 500,
                    minWidth: '60px',
                    textAlign: 'right',
                  }}
                >
                  {formatChange(item.change24h)}
                </span>
                <button
                  onClick={() => remove(item.id)}
                  aria-label={`Remove ${item.symbol} from watchlist`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    minWidth: '44px',
                    minHeight: '44px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
