import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Compare',
  description:
    'Which strategy is worth backing: the funded test, every strategy account side by side with its live play results and past-test evidence, and the past results. No real money.',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
