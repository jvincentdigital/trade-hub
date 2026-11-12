'use client'
import { useCallback } from 'react'
import { FUNDED_TESTS, type FundedTestId } from '../race/funded'
import { useStoredState } from './useStoredState'

/** Which funded test Today shows: v1 only or v1 + breakouts (John, 2026-11-12). */
export const FUNDED_TEST_KEY = 'trade-hub-funded-test'

/** The saved test, or v1 only when nothing valid is saved or storage is blocked. */
export function loadFundedTest(): FundedTestId {
  try {
    const v = window.localStorage.getItem(FUNDED_TEST_KEY)
    return FUNDED_TESTS.find((t) => t.id === v)?.id ?? 'v1'
  } catch {
    return 'v1'
  }
}

export function useFundedTest(): [FundedTestId, (test: FundedTestId) => void] {
  const [test, setTest] = useStoredState<FundedTestId>(loadFundedTest, 'v1')
  const pick = useCallback(
    (t: FundedTestId) => {
      setTest(t)
      try {
        window.localStorage.setItem(FUNDED_TEST_KEY, t)
      } catch {
        // Private window or blocked storage: the choice lasts until the page closes.
      }
    },
    [setTest],
  )
  return [test, pick]
}
