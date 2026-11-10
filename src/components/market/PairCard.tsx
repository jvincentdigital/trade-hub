'use client'
import { MarketItem } from '@/lib/types/market'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { formatPrice, formatChange, changeColor } from '@/lib/utils/formatters'
import { Star } from 'lucide-react'
import type { ReactNode } from 'react'

interface PairCardProps {
  item: MarketItem
  selected?: boolean
  watched?: boolean
  onSelect?: () => void
  onWatch: () => void
  sparkline?: ReactNode
}

export function PairCard({ item, selected, watched, onSelect, onWatch, sparkline }: PairCardProps) {
  const topPattern = item.patterns[0]

  return (
    <Card onClick={onSelect} selected={selected}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '10px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {item.symbol}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onWatch()
              }}
              aria-label={
                watched ? `Remove ${item.symbol} from watchlist` : `Add ${item.symbol} to watchlist`
              }
              aria-pressed={watched}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '16px',
                margin: '-16px',
                display: 'flex',
              }}
            >
              <Star
                size={12}
                fill={watched ? 'var(--amber)' : 'none'}
                stroke={watched ? 'var(--amber)' : 'var(--text-muted)'}
              />
            </button>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.name}</span>
        </div>
        {topPattern && (
          <Badge
            type={topPattern.type}
            size="sm"
            label={
              topPattern.type === 'bullish'
                ? 'Bull'
                : topPattern.type === 'bearish'
                  ? 'Bear'
                  : 'Neutral'
            }
          />
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '4px',
            }}
          >
            {formatPrice(item.price)}
          </div>
          <div style={{ fontSize: '12px', color: changeColor(item.change24h), fontWeight: 500 }}>
            {formatChange(item.change24h)} 24h
          </div>
        </div>
        {sparkline && <div style={{ flexShrink: 0 }}>{sparkline}</div>}
      </div>
      {topPattern && (
        <div
          style={{
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '0.5px solid var(--border)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}
        >
          {topPattern.name}
        </div>
      )}
    </Card>
  )
}
