import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Gold (XAU/USD)',
  description:
    'Gold price chart (tracked by PAX Gold), candle patterns, strategy signals and demo trading. No real money.',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
