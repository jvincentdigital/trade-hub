'use client'
import { useStoredState } from './useStoredState'
import { TradePlan, tradePlansArraySchema } from '../schemas'

const KEY = 'tradehub.strategies.v1'

const loadInitial = (): TradePlan[] => {
  if (typeof window === 'undefined') return []
  try {
    const saved = window.localStorage.getItem(KEY)
    if (!saved) return []
    const parsed = tradePlansArraySchema.safeParse(JSON.parse(saved))
    if (!parsed.success) {
      console.warn('[useTradePlans] corrupt localStorage; resetting', parsed.error.issues)
      return []
    }
    return parsed.data
  } catch (err) {
    console.warn('[useTradePlans] JSON parse failed; resetting', err)
    return []
  }
}

export function useTradePlans() {
  const [plans, setPlans] = useStoredState<TradePlan[]>(loadInitial, [])

  const save = (list: TradePlan[]) => {
    setPlans(list)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list))
    } catch {}
  }

  const add = (p: TradePlan) => save([...plans, p])

  const update = (id: string, patch: Partial<TradePlan>) => {
    save(plans.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const remove = (id: string) => save(plans.filter((p) => p.id !== id))

  const reload = () => setPlans(loadInitial())

  return { plans, add, update, remove, reload }
}
