'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Bitcoin, TrendingUp, BookOpen, Star, Trophy, Wallet } from 'lucide-react'

const nav = [
  { href: '/', label: 'Today', icon: LayoutDashboard },
  { href: '/crypto', label: 'Crypto', icon: Bitcoin },
  { href: '/forex', label: 'Forex', icon: TrendingUp },
  { href: '/strategies', label: 'Strategies', icon: BookOpen },
  { href: '/watchlist', label: 'Watchlist', icon: Star },
  { href: '/demo', label: 'Demo', icon: Wallet },
  { href: '/race', label: 'Race', icon: Trophy },
]

// Detail pages (/crypto/bitcoin) keep their section highlighted; gold lives under Forex.
const isActive = (path: string, href: string) =>
  href === '/'
    ? path === '/'
    : path === href || path.startsWith(`${href}/`) || (href === '/forex' && path === '/gold')

export function Sidebar() {
  const path = usePathname()
  if (path === '/unlock') return null

  return (
    <>
      <aside
        className="desktop-sidebar"
        style={{
          width: '200px',
          minHeight: '100vh',
          background: 'var(--bg-secondary)',
          borderRight: '0.5px solid var(--border)',
          padding: '1.5rem 0',
          position: 'fixed',
          left: 0,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '0 1rem 1.5rem',
            borderBottom: '0.5px solid var(--border)',
            marginBottom: '0.5rem',
          }}
        >
          <span
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--indigo)',
              letterSpacing: '-0.02em',
            }}
          >
            Trade Hub
          </span>
        </div>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href)
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                minHeight: 44,
                padding: '9px 1rem',
                margin: '1px 8px',
                borderRadius: '7px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: active ? 500 : 400,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: active ? 'var(--bg-hover)' : 'transparent',
                transition: 'all 0.1s',
              }}
            >
              <Icon size={15} />
              {label}
            </Link>
          )
        })}
      </aside>

      <nav
        className="mobile-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--bg-secondary)',
          borderTop: '0.5px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '8px 0 calc(8px + env(safe-area-inset-bottom))',
          zIndex: 50,
        }}
      >
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href)
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                minHeight: '44px',
                minWidth: '44px',
                textDecoration: 'none',
                color: active ? 'var(--indigo)' : 'var(--text-muted)',
                fontSize: '10px',
              }}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
