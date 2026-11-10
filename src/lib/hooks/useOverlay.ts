'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * State for a modal or panel that Esc and the browser Back button close (Back
 * is an edge swipe in the home-screen app). Opening pushes one history entry
 * on the same URL, so Back pops it and closes the overlay instead of leaving
 * the page with a half-filled form. Closing any other way (button, backdrop,
 * Esc, save) goes back from that entry, so it does not linger. The Today sheet
 * does the same with a URL param (src/app/page.tsx).
 */
export function useOverlay<T>() {
  const [value, setValue] = useState<T | null>(null)
  // Set from our own history.back() until its popstate, so a second close in
  // that gap does nothing instead of leaving the page.
  const closing = useRef(false)

  useEffect(() => {
    const onPop = () => {
      closing.current = false
      if (window.history.state?.overlay !== true) setValue(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const open = useCallback((v: T) => {
    // Only our own key: Next adds its own and keeps ours (see src/app/page.tsx).
    if (window.history.state?.overlay !== true) window.history.pushState({ overlay: true }, '')
    setValue(v)
  }, [])

  const close = useCallback(() => {
    if (closing.current) return
    if (window.history.state?.overlay === true) {
      closing.current = true
      window.history.back()
    } else setValue(null)
  }, [])

  const isOpen = value !== null
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  return [value, open, close] as const
}
