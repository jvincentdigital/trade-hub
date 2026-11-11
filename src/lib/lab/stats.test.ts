import { describe, expect, it } from 'vitest'
import {
  bonferroniZ,
  bootstrapCi,
  directionTest,
  holm,
  meanSe,
  normalTail,
  signTest,
} from './stats'

describe('lab stats', () => {
  it('mean, standard error and t', () => {
    expect(meanSe([1, 2, 3])).toMatchObject({ n: 3, mean: 2, t: 2 / (1 / Math.sqrt(3)) })
    expect(meanSe([])).toMatchObject({ n: 0, mean: null })
  })
  it('normal tail', () => {
    expect(normalTail(0)).toBeCloseTo(0.5, 6)
    expect(normalTail(1.96)).toBeCloseTo(0.025, 3)
    expect(normalTail(-1.96)).toBeCloseTo(0.975, 3)
  })
  it('random-direction test: no edge when real and flipped are mirror images', () => {
    expect(directionTest([1, -1, 1, -1], [-1, 1, -1, 1]).z).toBeCloseTo(0, 9)
    const r = directionTest(Array(30).fill(1), Array(30).fill(-1))
    expect(r.z).toBeCloseTo(Math.sqrt(30), 6)
    expect(r.p).toBeLessThan(1e-6)
  })
  it('Holm keeps only what passes the stepped bar', () => {
    expect(holm([0.001, 0.03, 0.04, null])).toEqual([true, false, false, false])
    expect(holm([0.01, 0.012, 0.3])).toEqual([true, true, false])
  })
  it('Bonferroni z for 164 tests is about 3.4', () => {
    expect(bonferroniZ(164)).toBeCloseTo(3.43, 1)
  })
  it('bootstrap interval contains the mean, sign test is exact', () => {
    const ci = bootstrapCi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!
    expect(ci[0]).toBeLessThan(5.5)
    expect(ci[1]).toBeGreaterThan(5.5)
    expect(signTest(5, 10)).toBeCloseTo(1, 9)
    expect(signTest(0, 10)).toBeCloseTo(2 / 1024, 9)
  })
})
