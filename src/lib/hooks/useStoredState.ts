'use client'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * State loaded from localStorage after the first render, so the server HTML
 * and the first client render match (no hydration error when data is saved).
 */
export function useStoredState<T>(load: () => T, empty: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(empty)
  useEffect(() => {
    setValue(load())
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [value, setValue]
}
