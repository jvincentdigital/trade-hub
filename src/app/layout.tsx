import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Sidebar } from '@/components/layout/Sidebar'
import { PaperEngine } from '@/components/paper/PaperEngine'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'Trade Hub',
    template: '%s · Trade Hub',
  },
  description:
    'Personal trading hub: open trades, stops and targets, the strategy race and live markets. Play money only.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Sidebar />
        <main className="main-content" style={{ padding: '1.5rem', minHeight: '100vh' }}>
          {children}
        </main>
        <PaperEngine />
      </body>
    </html>
  )
}
