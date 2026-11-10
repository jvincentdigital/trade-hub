'use client'
import { useEffect } from 'react'
import { tick } from '@/lib/paper/engine'
import { setPaperAccount, useLivePrices, usePaperAccount } from '@/lib/hooks/usePaperAccount'

// Mounted once in the root layout. While Trade Hub is open in a tab, it feeds
// live prices into the demo account so limit orders fill and stops/targets
// trigger. It only subscribes to prices when there is something to watch.
export function PaperEngine() {
  const account = usePaperAccount()
  if (account.positions.length === 0 && account.pendingOrders.length === 0) return null
  return <Ticker />
}

function Ticker() {
  const account = usePaperAccount()
  const { prices } = useLivePrices()
  useEffect(() => {
    if (Object.keys(prices).length === 0) return
    const { account: next } = tick(account, prices)
    setPaperAccount(next)
    // Re-run only on new prices; the account update itself must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices])
  return null
}
