'use client'
import { useCallback } from 'react'
import { FUNDED, FUNDED_SIZES } from '../race/funded'
import { useStoredState } from './useStoredState'

/** Which funded test size Today and the Race tab show (John, 2026-11-12). */
export const FUNDED_SIZE_KEY = 'trade-hub-funded-size'

/** The saved size, or the $10K when nothing valid is saved or storage is blocked. */
export function loadFundedSize(): number {
  try {
    const n = Number(window.localStorage.getItem(FUNDED_SIZE_KEY))
    return (FUNDED_SIZES as readonly number[]).includes(n) ? n : FUNDED.startMoney
  } catch {
    return FUNDED.startMoney
  }
}

export function useFundedSize(): [number, (size: number) => void] {
  const [size, setSize] = useStoredState(loadFundedSize, FUNDED.startMoney)
  const pick = useCallback(
    (s: number) => {
      setSize(s)
      try {
        window.localStorage.setItem(FUNDED_SIZE_KEY, String(s))
      } catch {
        // Private window or blocked storage: the choice lasts until the page closes.
      }
    },
    [setSize],
  )
  return [size, pick]
}
