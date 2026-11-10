'use client'
import { useMemo, useSyncExternalStore } from 'react'
import { createAccount, DEFAULT_BALANCE } from '../paper/engine'
import { paperAccountSchema, type PaperAccount } from '../paper/schema'
import type { PriceMap } from '../paper/instruments'
import { useCryptoPrices, useForexRates } from './useMarketData'

// One shared demo account for every component on the page (a tiny external
// store), persisted to localStorage and kept in sync across tabs.

const KEY = 'trade-hub-paper-account'
const SERVER_ACCOUNT = createAccount(DEFAULT_BALANCE, 0)

let current: PaperAccount | null = null
const listeners = new Set<() => void>()

function load(): PaperAccount {
  try {
    const saved = window.localStorage.getItem(KEY)
    if (!saved) return createAccount()
    const parsed = paperAccountSchema.safeParse(JSON.parse(saved))
    if (parsed.success) return parsed.data
    console.warn(
      '[usePaperAccount] corrupt localStorage; starting a fresh demo account',
      parsed.error.issues,
    )
  } catch (err) {
    console.warn('[usePaperAccount] JSON parse failed; starting a fresh demo account', err)
  }
  return createAccount()
}

function getSnapshot(): PaperAccount {
  if (!current) current = load()
  return current
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    current = load()
    listeners.forEach((l) => l())
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** Replace the demo account (pass the result of an engine function). */
export function setPaperAccount(next: PaperAccount) {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
  listeners.forEach((l) => l())
}

export function resetPaperAccount(startingBalance = DEFAULT_BALANCE) {
  setPaperAccount(createAccount(startingBalance))
}

export function usePaperAccount(): PaperAccount {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_ACCOUNT)
}

/** Latest price per instrument id from the existing free feeds. */
export function useLivePrices(): { prices: PriceMap; isLoading: boolean } {
  const crypto = useCryptoPrices()
  const forex = useForexRates()
  const prices = useMemo(() => {
    const map: PriceMap = {}
    for (const p of crypto.prices) if (p.price > 0) map[p.id] = p.price
    for (const p of forex.rates) if (p.price > 0) map[p.id] = p.price
    return map
  }, [crypto.prices, forex.rates])
  return { prices, isLoading: crypto.isLoading || forex.isLoading }
}
