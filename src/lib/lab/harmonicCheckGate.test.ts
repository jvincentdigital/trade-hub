// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKER,
  gitTest,
  markerPath,
  openCheck,
  type CheckGate,
  type Git,
} from './harmonicCheckGate'
import { firstStampAtOrAfter, readMarket } from './harmonicLoad'

const dir = mkdtempSync(join(tmpdir(), 'harmonic-gate-'))
const Y2019 = Date.UTC(2019, 0, 1) / 1000
const H = 'time,open,high,low,close,volume\n'
const row = (t: number) => `${t},1,1,1,1,0\n`
const gz = (name: string, text: string) => {
  const f = join(dir, name)
  writeFileSync(f, gzipSync(text))
  return f
}

describe('the period guards on the price files', () => {
  const end2018 = gz('end2018.csv.gz', H + row(Y2019 - 120) + row(Y2019 - 60))
  const into2019 = gz('into2019.csv.gz', H + row(Y2019 - 60) + row(Y2019) + row(Y2019 + 60))
  const noNewline = gz('nonl.csv.gz', H + row(Y2019 - 60) + `${Y2019},1,1,1,1,0`)

  it('firstStampAtOrAfter finds the first bar stamped 2019-01-01 00:00 or later, or none', async () => {
    expect(await firstStampAtOrAfter(end2018, Y2019)).toBeNull()
    expect(await firstStampAtOrAfter(into2019, Y2019)).toBe(Y2019)
    expect(await firstStampAtOrAfter(noNewline, Y2019)).toBe(Y2019)
  })
  it('a choosing read refuses a file with a 2019 bar before parsing it', async () => {
    expect(await readMarket(into2019, Y2019, Y2019)).toEqual({ refusedAt: Y2019 })
    const ok = await readMarket(end2018, Y2019, Y2019)
    expect('bars' in ok && ok.bars.n).toBe(2)
  })
  it('readBefore never returns a bar at or after it', async () => {
    const r = await readMarket(into2019, null, Y2019)
    if (!('bars' in r)) throw new Error('refused')
    expect([...r.bars.time]).toEqual([Y2019 - 60])
    const whole = await readMarket(into2019, null, null)
    expect('bars' in whole && whole.bars.n).toBe(3)
  })
})

describe('the check gate', () => {
  const gate = (over: Partial<CheckGate>): CheckGate => ({
    rehearsal: false,
    marker: join(mkdtempSync(join(dir, 'm-')), 'sub', 'CHECK-RAN.json'),
    head: 'abc',
    chooseCommit: 'abc',
    chooseMarkets: ['EURUSD', 'XAUUSD'],
    used: ['XAUUSD', 'EURUSD'],
    content: { label: 'test' },
    ...over,
  })

  it('the real check always uses the fixed marker; only the rehearsal puts it in its folder', () => {
    expect(markerPath(false, '/anywhere')).toBe(DEFAULT_MARKER)
    expect(markerPath(true, '/out')).toBe('/out/CHECK-RAN.json')
  })
  it('writes the marker when nothing refuses, and refuses to repeat', () => {
    const g = gate({})
    expect(openCheck(g)).toBeNull()
    expect(JSON.parse(readFileSync(g.marker, 'utf8'))).toEqual({ label: 'test' })
    expect(openCheck(g)).toMatch(/already ran/)
  })
  it("the real check refuses a choose.json not made by HEAD's commit, and writes no marker", () => {
    for (const chooseCommit of [null, 'old']) {
      const g = gate({ chooseCommit })
      expect(openCheck(g)).toMatch(/run choose again/)
      expect(existsSync(g.marker)).toBe(false)
    }
    // The rehearsal does not test git.
    expect(openCheck(gate({ rehearsal: true, head: null, chooseCommit: null }))).toBeNull()
  })
  it('refuses market files that differ from the markets the choosing run used', () => {
    for (const used of [['EURUSD'], ['EURUSD', 'XAUUSD', 'GBPUSD']] as CheckGate['used'][]) {
      const g = gate({ used })
      expect(openCheck(g)).toMatch(/choosing run used EURUSD, XAUUSD/)
      expect(existsSync(g.marker)).toBe(false)
    }
  })
  it('the git test: a clean tree, HEAD is the commit, and HEAD is pushed', () => {
    const fake =
      (over: Record<string, string | Error>): Git =>
      (...a) => {
        const key = a[0] === 'rev-parse' && a[1] === '--verify' ? 'verify' : a[0]
        const all: Record<string, string | Error> = {
          status: '',
          'rev-parse': 'abc',
          verify: 'abc',
          branch: 'origin/x',
          ...over,
        }
        const v = all[key]
        if (v instanceof Error) throw v
        return v
      }
    expect(gitTest('abc', fake({}))).toEqual({ head: 'abc', remote: ['origin/x'] })
    expect(gitTest('abc', fake({ status: ' M a.ts' }))).toEqual({
      refuse: 'the git tree is not clean: commit first',
    })
    expect(gitTest('abc', fake({ verify: new Error('bad') }))).toEqual({
      refuse: 'abc is not a commit',
    })
    expect(gitTest('abc', fake({ verify: 'def' }))).toEqual({ refuse: 'HEAD is abc, not def' })
    expect(gitTest('abc', fake({ branch: '' }))).toEqual({
      refuse: 'abc is not on a remote branch: push first',
    })
  })
})
