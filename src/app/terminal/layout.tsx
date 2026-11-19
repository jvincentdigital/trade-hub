import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terminal',
  description:
    'A big live chart with every play trade drawn on it, and the open trades and history below, like MetaTrader 4. No real money.',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
