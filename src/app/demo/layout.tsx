import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Demo account',
  description:
    'Practice trading with play money: market and limit orders, stops, targets and live P&L. No real money.',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
