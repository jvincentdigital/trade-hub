import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Strategy race',
  description:
    'Every strategy gets its own play-money account: a past-results backtest leaderboard on real candles and a live forward test. No real money.',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
