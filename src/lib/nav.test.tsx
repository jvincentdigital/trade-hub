import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// The nav and the /race redirect (John, 2026-11-12): Crypto and Watchlist
// are off the sidebar and the phone bar, Race became Compare.
const nav = vi.hoisted(() => ({ path: '/', redirect: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  redirect: nav.redirect,
}))

import { Sidebar } from '@/components/layout/Sidebar'
import RacePage from '@/app/race/page'

afterEach(cleanup)

describe('nav', () => {
  it('shows Compare and hides Crypto, Watchlist and Race, on the sidebar and the phone bar', () => {
    render(<Sidebar />)
    const links = screen.getAllByRole('link')
    const labels = links.map((l) => l.textContent)
    // Each item twice: the desktop sidebar and the phone bottom bar.
    expect(labels).toEqual([
      'Today',
      'Forex',
      'Strategies',
      'Demo',
      'Compare',
      'Today',
      'Forex',
      'Strategies',
      'Demo',
      'Compare',
    ])
    const hrefs = links.map((l) => l.getAttribute('href'))
    expect(hrefs.filter((h) => h === '/compare')).toHaveLength(2)
    for (const gone of ['/crypto', '/watchlist', '/race']) expect(hrefs).not.toContain(gone)
  })

  it('marks Compare as the page you are on', () => {
    nav.path = '/compare'
    render(<Sidebar />)
    const compare = screen.getAllByRole('link', { name: 'Compare' })
    expect(compare[0]).toHaveStyle({ background: 'var(--bg-hover)' })
    nav.path = '/'
  })
})

describe('/race', () => {
  it('redirects to /compare', () => {
    RacePage()
    expect(nav.redirect).toHaveBeenCalledWith('/compare')
  })
})
