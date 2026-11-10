'use client'
import { useStoredState } from './useStoredState'
import { Strategy } from '../types/strategy'
import { strategiesArraySchema } from '../schemas'

const KEY = 'trade-hub-strategies'

const loadInitial = (): Strategy[] => {
  if (typeof window === 'undefined') return []
  try {
    const saved = window.localStorage.getItem(KEY)
    if (!saved) return []
    const parsed = strategiesArraySchema.safeParse(JSON.parse(saved))
    if (!parsed.success) {
      console.warn('[useStrategies] corrupt localStorage; resetting', parsed.error.issues)
      return []
    }
    return parsed.data
  } catch (err) {
    console.warn('[useStrategies] JSON parse failed; resetting', err)
    return []
  }
}

export function useStrategies() {
  const [strategies, setStrategies] = useStoredState<Strategy[]>(loadInitial, [])

  const save = (list: Strategy[]) => {
    setStrategies(list)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list))
    } catch {}
  }

  const add = (s: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString()
    const newS: Strategy = { ...s, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    save([...strategies, newS])
  }

  const update = (id: string, updates: Partial<Strategy>) => {
    save(
      strategies.map((s) =>
        s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s,
      ),
    )
  }

  const remove = (id: string) => {
    save(strategies.filter((s) => s.id !== id))
  }

  const replaceAll = (list: Strategy[]) => {
    save(list)
  }

  return { strategies, add, update, remove, replaceAll }
}
