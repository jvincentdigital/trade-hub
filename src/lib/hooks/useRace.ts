'use client'
import useSWR from 'swr'
import type { RaceState } from '../race/live'

export interface RaceResponse {
  state: RaceState | null
  installed: boolean
}

const fetcher = async (url: string): Promise<RaceResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`race ${res.status}`)
  return res.json()
}

/** Live strategy race state (written hourly by the Mac's race tick). */
export function useRace() {
  const { data, error, isLoading } = useSWR('/api/race', fetcher, { refreshInterval: 60_000 })
  return { state: data?.state ?? null, installed: data?.installed ?? false, error, isLoading }
}
