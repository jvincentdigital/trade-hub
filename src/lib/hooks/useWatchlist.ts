'use client'
import { useStoredState } from './useStoredState'
import { watchlistArraySchema } from '../schemas'

const KEY = 'trade-hub-watchlist'

const loadInitial = (): string[] => {
  if (typeof window === 'undefined') return []
  try {
    const saved = window.localStorage.getItem(KEY)
    if (!saved) return []
    const parsed = watchlistArraySchema.safeParse(JSON.parse(saved))
    if (!parsed.success) {
      console.warn('[useWatchlist] corrupt localStorage; resetting', parsed.error.issues)
      return []
    }
    return parsed.data
  } catch (err) {
    console.warn('[useWatchlist] JSON parse failed; resetting', err)
    return []
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useStoredState<string[]>(loadInitial, [])

  const save = (list: string[]) => {
    setWatchlist(list)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list))
    } catch {}
  }

  const add = (id: string) => {
    if (!watchlist.includes(id)) save([...watchlist, id])
  }

  const remove = (id: string) => save(watchlist.filter((w) => w !== id))

  const toggle = (id: string) => (watchlist.includes(id) ? remove(id) : add(id))

  const isWatched = (id: string) => watchlist.includes(id)

  const replaceAll = (list: string[]) => save(list)

  return { watchlist, add, remove, toggle, isWatched, replaceAll }
}
