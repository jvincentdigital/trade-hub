// Harmonic study (docs/harmonic-study.md, Order of work; Amendment 1 point 6;
// Amendment 3 point 15): the steps before the single check reads any bar.
// The runner (scripts/lab/harmonic-study.ts) calls them. Node only.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HarmonicMarket } from './harmonicFind'

/** The real check's one marker. No option moves it, so the check cannot run twice. */
export const DEFAULT_MARKER = join(
  homedir(),
  '.local/share/trade-hub/harmonic-check/CHECK-RAN.json',
)

/** The marker of a check: the fixed one for the real check, one in its output folder for the rehearsal. */
export const markerPath = (rehearsal: boolean, out: string) =>
  rehearsal ? join(out, 'CHECK-RAN.json') : DEFAULT_MARKER

export type Git = (...args: string[]) => string

/** The real check's git test: a clean tree, HEAD is `sha`, and HEAD is on a remote branch. */
export function gitTest(
  sha: string,
  git: Git,
): { refuse: string } | { head: string; remote: string[] } {
  if (git('status', '--porcelain') !== '')
    return { refuse: 'the git tree is not clean: commit first' }
  const head = git('rev-parse', 'HEAD')
  let want: string
  try {
    want = git('rev-parse', '--verify', `${sha}^{commit}`)
  } catch {
    return { refuse: `${sha} is not a commit` }
  }
  if (head !== want) return { refuse: `HEAD is ${head}, not ${want}` }
  const remote = git('branch', '-r', '--contains', head)
  if (!remote) return { refuse: `${head} is not on a remote branch: push first` }
  return { head, remote: remote.split('\n').map((s) => s.trim()) }
}

export interface CheckGate {
  rehearsal: boolean
  marker: string
  /** HEAD after the git test; null in the rehearsal, which does not test git. */
  head: string | null
  /** choose.json's commit (null: chosen on an uncommitted tree) and its markets used. */
  chooseCommit: string | null
  chooseMarkets: HarmonicMarket[]
  /** The markets whose files are in --data. */
  used: HarmonicMarket[]
  /** What the marker records. */
  content: unknown
}

/**
 * Refuse (the reason), or write the marker, never over an existing one, and
 * return null. Nothing may read a price file before this returns null. The
 * real check needs the candidates chosen by the code it runs (HEAD), and
 * every check the markets the choosing run used.
 */
export function openCheck(g: CheckGate): string | null {
  if (existsSync(g.marker)) return `the check already ran: ${g.marker} exists`
  if (!g.rehearsal && (g.chooseCommit === null || g.chooseCommit !== g.head))
    return `choose.json was made by ${g.chooseCommit ?? 'an uncommitted tree'}, not by HEAD ${g.head}: run choose again from this commit`
  const want = [...g.chooseMarkets].sort().join(', ')
  const have = [...g.used].sort().join(', ')
  if (want !== have)
    return `the files in --data are for ${have || 'no market'}, but the choosing run used ${want}`
  mkdirSync(dirname(g.marker), { recursive: true })
  writeFileSync(g.marker, JSON.stringify(g.content, null, 2), { flag: 'wx' })
  return null
}
