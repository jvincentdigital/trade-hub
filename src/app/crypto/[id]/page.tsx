'use client'
import { use } from 'react'
import { CoinDetail } from '@/components/market/CoinDetail'
import { COIN_MAP } from '@/lib/coingecko'

export default function CryptoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const meta = COIN_MAP[id]
  const symbol = meta?.symbol ?? id.toUpperCase()
  return (
    <CoinDetail
      id={id}
      name={meta?.name ?? id}
      subtitle={`${symbol} · Crypto`}
      back={{ href: '/crypto', label: 'Back to crypto' }}
      tvSymbol={`CRYPTO:${symbol}USD`}
      planMarket="crypto"
    />
  )
}
