import { test, expect } from '@playwright/test'

const routes: Array<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /dashboard/i },
  { path: '/crypto', heading: /crypto/i },
  { path: '/forex', heading: /forex/i },
  { path: '/strategies', heading: /strategies|setup scanner/i },
  { path: '/watchlist', heading: /watchlist/i },
  { path: '/demo', heading: /demo account/i },
  { path: '/compare', heading: /compare/i },
]

for (const { path, heading } of routes) {
  test(`${path} renders without console errors`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      // Vercel Analytics' script only exists on Vercel; locally it 404s.
      if (msg.type() === 'error' && !msg.location().url.includes('/_vercel/'))
        consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`)
    })

    const response = await page.goto(path)
    expect(response?.ok()).toBe(true)

    // Sidebar nav should render on every route.
    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible()

    // Page heading
    await expect(page.locator('h1, h2').first()).toContainText(heading)

    expect(consoleErrors, `console errors on ${path}: ${consoleErrors.join(' | ')}`).toHaveLength(0)
  })
}

test('404 page renders', async ({ page }) => {
  await page.goto('/this-route-does-not-exist')
  await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible()
})

test('demo account is clearly labeled as play money', async ({ page }) => {
  await page.goto('/demo')
  await expect(page.getByText(/demo · play money/i).first()).toBeVisible()
  await expect(page.getByText(/nothing here reaches a broker or real money/i)).toBeVisible()
})
