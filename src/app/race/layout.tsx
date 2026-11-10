import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Strategy race',
  description:
    'Every strategy gets its own play-money account: a 90-day backtest leaderboard and a live forward test. No real money.',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
