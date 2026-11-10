'use client'
import { useState } from 'react'
import { rulesArraySchema, type Rule } from '../rules/schema'
import { BUILT_IN_RULES } from '../rules/presets'

const KEY = 'trade-hub-rules'

const loadInitial = (): Rule[] => {
  if (typeof window === 'undefined') return []
  try {
    const saved = window.localStorage.getItem(KEY)
    if (!saved) return []
    const parsed = rulesArraySchema.safeParse(JSON.parse(saved))
    if (!parsed.success) {
      console.warn('[useRules] corrupt localStorage; resetting', parsed.error.issues)
      return []
    }
    return parsed.data
  } catch (err) {
    console.warn('[useRules] JSON parse failed; resetting', err)
    return []
  }
}

/** Built-in rules (read-only) followed by the user's own. */
export function useRules() {
  const [custom, setCustom] = useState<Rule[]>(loadInitial)

  const save = (list: Rule[]) => {
    setCustom(list)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list))
    } catch {}
  }

  const upsert = (rule: Rule) => {
    const r = { ...rule, builtIn: undefined }
    save(
      custom.some((c) => c.id === r.id)
        ? custom.map((c) => (c.id === r.id ? r : c))
        : [...custom, r],
    )
  }

  const remove = (id: string) => save(custom.filter((c) => c.id !== id))

  return { rules: [...BUILT_IN_RULES, ...custom], upsert, remove }
}
