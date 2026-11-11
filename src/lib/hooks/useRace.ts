'use client'
import { useCallback } from 'react'
import useSWR from 'swr'
import type { RaceState } from '../race/live'
import type { CloseRequest, CloseRequests } from '../race/closeRequests'

export interface RaceResponse {
  state: RaceState | null
  installed: boolean
  /** Close now taps the race has not booked yet, by trade id. */
  closeRequests?: CloseRequests
}

const fetcher = async (url: string): Promise<RaceResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`race ${res.status}`)
  return res.json()
}

const NONE: CloseRequests = {}

/** Live strategy race state (written by the Mac's race checks), plus Close now. */
export function useRace() {
  const { data, error, isLoading, mutate } = useSWR('/api/race', fetcher, {
    refreshInterval: 60_000,
  })

  /** Ask the next race check to close this trade. Throws with a plain message on failure. */
  const requestClose = useCallback(
    async (id: string): Promise<CloseRequest> => {
      const res = await fetch('/api/race/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not send the close. Try again.')
      const request = body.request as CloseRequest
      await mutate((d) => d && { ...d, closeRequests: { ...d.closeRequests, [id]: request } }, {
        revalidate: false,
      })
      return request
    },
    [mutate],
  )

  return {
    state: data?.state ?? null,
    installed: data?.installed ?? false,
    closeRequests: data?.closeRequests ?? NONE,
    requestClose,
    error,
    isLoading,
  }
}
