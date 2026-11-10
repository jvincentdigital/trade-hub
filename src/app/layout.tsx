import type { Metadata, Viewport } from 'next'
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
  // Home-screen app on iPhone: full screen, dark status bar over our own background.
  // Next writes `mobile-web-app-capable`; older iOS still reads the apple- name.
  appleWebApp: { capable: true, title: 'Trade Hub', statusBarStyle: 'black-translucent' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

// viewport-fit=cover lets the page reach under the notch and home bar; the
// safe-area padding in globals.css and Sidebar.tsx keeps content clear of them.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Sidebar />
        <main className="main-content" style={{ minHeight: '100vh' }}>
          {children}
        </main>
        <PaperEngine />
      </body>
    </html>
  )
}
