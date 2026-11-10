'use client'
import { CoinDetail } from '@/components/market/CoinDetail'
import { METAL_MAP } from '@/lib/coingecko'

const GOLD = METAL_MAP['pax-gold']

export default function GoldPage() {
  return (
    <CoinDetail
      id="pax-gold"
      name="Gold (XAU/USD)"
      subtitle="XAU/USD · Gold · hourly candles"
      note={`Our candles: ${GOLD.note} (one token = one troy ounce). The TradingView chart shows the real XAU/USD.`}
      back={{ href: '/forex', label: 'Back to forex and gold' }}
      tvSymbol="OANDA:XAUUSD"
      planMarket="crypto"
    />
  )
}
